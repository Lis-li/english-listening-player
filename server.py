import argparse
import asyncio
import hashlib
import json
import random
import re
import shutil
import sys
import threading
import unicodedata
import uuid
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
TTS_TOOLS = ROOT.parent / ".tts-tools"
if TTS_TOOLS.exists():
    sys.path.insert(0, str(TTS_TOOLS))

import edge_tts
from docx import Document


HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_VOICE = "en-US-AriaNeural"
AVAILABLE_VOICES = {
    "en-US-AriaNeural": "美式女声",
    "en-US-GuyNeural": "美式男声",
}
GENERATED = ROOT / "generated"
SAMPLE_ID = "original-sample"
SAMPLE_SOURCE = ROOT / "sample" / "original-listening-sample.txt"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_TEXT_CHARS = 60000
TTS_MAX_ATTEMPTS = 6
TTS_CONCURRENCY = 3
SELECTION_MAX_WORDS = 300
STATE_LOCK = threading.Lock()

WORD_RE = re.compile(r"\b[A-Za-z]+(?:[’'-][A-Za-z]+)*\b")
DATE_RE = re.compile(
    r"^(?:\d{1,2}\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|"
    r"May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|"
    r"Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}(?:,\s*\d{1,2}:\d{2}\s+\w+)?$",
    re.IGNORECASE,
)
TIME_RE = re.compile(r"^\d{1,2}(?::\d{2})?\s*(?:minutes?|hours?|days?)\s+ago$", re.IGNORECASE)
COMMENT_RE = re.compile(r"^\d[\d,]*\s+comments?$", re.IGNORECASE)
BYLINE_RE = re.compile(r"^by\s*[A-Z]", re.IGNORECASE)
MEDIA_LABELS = ("image source", "image caption", "figure caption")
END_LABELS = ("related", "relate", "more on this story")


def normalize_text(text):
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\u200c", "").replace("\u200b", "").replace("\ufeff", "")
    text = text.replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def count_words(text):
    return len(WORD_RE.findall(text))


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def content_hash(data):
    return hashlib.sha256(data).hexdigest()


def normalize_voice(voice):
    voice = str(voice or "").strip()
    return voice if voice in AVAILABLE_VOICES else DEFAULT_VOICE


def is_metadata(text):
    lowered = text.lower().strip(" ,:")
    if not text:
        return True
    if lowered.startswith(MEDIA_LABELS):
        return True
    if lowered.startswith(END_LABELS):
        return True
    if lowered in {"published", "updated", "business reporter", "technology reporter"}:
        return True
    if BYLINE_RE.match(text) or DATE_RE.match(text) or TIME_RE.match(text) or COMMENT_RE.match(text):
        return True
    if re.fullmatch(r"\d{1,2}:\d{2}", text):
        return True
    if lowered.startswith("watch:"):
        return True
    return False


def extract_article(docx_path):
    paragraphs = [normalize_text(p.text) for p in Document(docx_path).paragraphs]
    paragraphs = [p for p in paragraphs if p]
    if not paragraphs:
        raise ValueError("文档中没有可读取的文字")

    title = paragraphs[0]
    body = []
    removed = 0
    body_started = False
    skip_caption = False

    for text in paragraphs[1:]:
        lowered = text.lower().strip(" ,:")

        if lowered.startswith(("image caption", "figure caption")):
            removed += 1
            skip_caption = True
            continue
        if lowered.startswith("image source"):
            removed += 1
            continue
        if skip_caption:
            removed += 1
            skip_caption = False
            continue

        if is_metadata(text):
            removed += 1
            continue

        words = count_words(text)
        if not body_started:
            if words >= 15 and re.search(r"[.!?][\"”’]?$", text):
                body_started = True
                body.append(text)
            else:
                removed += 1
            continue

        if lowered.startswith(END_LABELS):
            removed += 1
            break
        if words >= 4:
            body.append(text)
        else:
            removed += 1

    if not body:
        raise ValueError("未能识别新闻正文，请确认文件是包含正文的 .docx")
    return title, body, removed


def canonical_text_source(raw_text):
    text = unicodedata.normalize("NFKC", str(raw_text or ""))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [normalize_text(line) for line in text.split("\n")]
    lines = [line for line in lines if line]
    return "\n".join(lines)


def title_from_text(text):
    protected, placeholder = protect_abbreviations(text)
    first_sentence = re.split(r'[.!?](?:["”’])?\s+', protected, maxsplit=1)[0]
    first_sentence = first_sentence.replace(placeholder, ".").strip()
    words = first_sentence.split()
    if len(words) > 14:
        return " ".join(words[:14]) + "..."
    return first_sentence[:110] or "Pasted English Text"


def extract_text_article(text_path):
    source = canonical_text_source(text_path.read_text(encoding="utf-8"))
    if not source:
        raise ValueError("请先粘贴英文内容")
    if len(source) > MAX_TEXT_CHARS:
        raise ValueError("粘贴文本不能超过 60000 个字符")

    lines = source.split("\n")
    first_line = lines[0]
    first_line_words = count_words(first_line)
    first_line_looks_like_title = (
        len(lines) > 1
        and first_line_words <= 16
        and not re.search(r'[.!?]["”’]?$', first_line)
    )
    if first_line_looks_like_title:
        title = first_line
        body = lines[1:]
    else:
        title = title_from_text(source)
        body = lines

    body = [line for line in body if count_words(line) >= 3]
    if sum(count_words(line) for line in body) < 8:
        raise ValueError("粘贴文本太短，请至少提供一小段完整英文内容")
    return title, body, 0


def protect_abbreviations(text):
    placeholder = "\ue000"
    patterns = [
        r"\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|No|vs|etc)\.",
        r"\b(?:e\.g|i\.e)\.",
        r"\b(?:[A-Z]\.){2,}",
    ]
    for pattern in patterns:
        text = re.sub(
            pattern,
            lambda match: match.group(0).replace(".", placeholder),
            text,
            flags=re.IGNORECASE,
        )
    return text, placeholder


def split_sentences(paragraphs):
    sentences = []
    for paragraph in paragraphs:
        protected, placeholder = protect_abbreviations(paragraph)
        marked = re.sub(
            r'([.!?](?:["”’])?)\s+(?=["“‘\']?[A-Z0-9])',
            r"\1<SENTENCE_BREAK>",
            protected,
        )
        parts = marked.split("<SENTENCE_BREAK>")
        for part in parts:
            sentence = part.replace(placeholder, ".").strip()
            if count_words(sentence) >= 3:
                sentences.append(sentence)
    if not sentences:
        raise ValueError("未能从正文中划分出完整句子")
    return sentences


def tts_text(text):
    replacements = {
        r"\bAI\b": "A.I.",
        r"\bRTX\b": "R.T.X.",
        r"\bUS\b": "United States",
        r"\bUK\b": "United Kingdom",
        r"\bPCs\b": "personal computers",
        r"\bPC\b": "personal computer",
        r"\bHP\b": "H.P.",
        r"\bMSI\b": "M.S.I.",
    }
    output = text.replace("subsididiaries", "subsidiaries")
    for pattern, replacement in replacements.items():
        output = re.sub(pattern, replacement, output)
    return output


class SpeechServiceError(RuntimeError):
    pass


async def synthesize_with_retry(text, destination, voice=DEFAULT_VOICE):
    temporary = destination.with_name(f"{destination.stem}.part{destination.suffix}")
    last_error = None
    voice = normalize_voice(voice)

    for attempt in range(1, TTS_MAX_ATTEMPTS + 1):
        temporary.unlink(missing_ok=True)
        try:
            communicator = edge_tts.Communicate(
                text=tts_text(text),
                voice=voice,
                rate="+0%",
                pitch="-2Hz",
            )
            await communicator.save(str(temporary))
            if temporary.stat().st_size < 1024:
                raise RuntimeError("语音文件不完整")
            temporary.replace(destination)
            return
        except Exception as exc:
            last_error = exc
            if attempt == TTS_MAX_ATTEMPTS:
                break
            delay = min(20, (2 ** (attempt - 1)) + random.random())
            await asyncio.sleep(delay)

    temporary.unlink(missing_ok=True)
    raise SpeechServiceError(
        f"神经语音服务连续 {TTS_MAX_ATTEMPTS} 次未响应"
    ) from last_error


async def generate_audio(sentences, audio_dir, voice=DEFAULT_VOICE):
    audio_dir.mkdir(parents=True, exist_ok=True)
    voice = normalize_voice(voice)
    semaphore = asyncio.Semaphore(TTS_CONCURRENCY)

    async def synthesize_limited(text, destination):
        async with semaphore:
            await synthesize_with_retry(text, destination, voice=voice)

    jobs = [
        synthesize_limited(" ".join(sentences), audio_dir / "full-article.mp3")
    ]
    jobs.extend(
        synthesize_limited(sentence, audio_dir / f"sentence-{index:03d}.mp3")
        for index, sentence in enumerate(sentences, start=1)
    )
    await asyncio.gather(*jobs)


def article_payload(article_id, title, sentences, removed_count, source_hash=None, voice=DEFAULT_VOICE):
    voice = normalize_voice(voice)
    base = f"/generated/{article_id}/audio"
    return {
        "id": article_id,
        "title": title,
        "voice": voice,
        "voice_label": AVAILABLE_VOICES[voice],
        "source_hash": source_hash,
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "word_count": sum(count_words(sentence) for sentence in sentences),
        "removed_count": removed_count,
        "full_text": " ".join(sentences),
        "full_audio": f"{base}/full-article.mp3",
        "sentences": [
            {
                "text": sentence,
                "audio": f"{base}/sentence-{index:03d}.mp3",
            }
            for index, sentence in enumerate(sentences, start=1)
        ],
    }


def build_article(docx_path, article_id=None, source_hash=None, voice=DEFAULT_VOICE):
    article_id = article_id or uuid.uuid4().hex[:12]
    voice = normalize_voice(voice)
    article_dir = GENERATED / article_id
    title, paragraphs, removed_count = extract_article(docx_path)
    sentences = split_sentences(paragraphs)

    article_dir.mkdir(parents=True, exist_ok=True)
    audio_dir = article_dir / "audio"
    if audio_dir.exists():
        shutil.rmtree(audio_dir)
    try:
        asyncio.run(generate_audio(sentences, audio_dir, voice=voice))
    except Exception:
        shutil.rmtree(article_dir, ignore_errors=True)
        raise

    payload = article_payload(
        article_id,
        title,
        sentences,
        removed_count,
        source_hash=source_hash,
        voice=voice,
    )
    (article_dir / "manifest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return payload


def build_text_article(text_path, article_id=None, source_hash=None, voice=DEFAULT_VOICE):
    article_id = article_id or uuid.uuid4().hex[:12]
    voice = normalize_voice(voice)
    article_dir = GENERATED / article_id
    title, paragraphs, removed_count = extract_text_article(text_path)
    sentences = split_sentences(paragraphs)

    article_dir.mkdir(parents=True, exist_ok=True)
    audio_dir = article_dir / "audio"
    if audio_dir.exists():
        shutil.rmtree(audio_dir)
    try:
        asyncio.run(generate_audio(sentences, audio_dir, voice=voice))
    except Exception:
        shutil.rmtree(article_dir, ignore_errors=True)
        raise

    payload = article_payload(
        article_id,
        title,
        sentences,
        removed_count,
        source_hash=source_hash,
        voice=voice,
    )
    write_json(article_dir / "manifest.json", payload)
    return payload


def source_for_article(article_id):
    source = GENERATED / article_id / "source.docx"
    if source.exists():
        return source
    source = GENERATED / article_id / "source.txt"
    if source.exists():
        return source
    if article_id == SAMPLE_ID:
        return find_sample_source()
    raise FileNotFoundError("找不到这篇文章的原始来源文件，无法切换发音")


def article_with_voice(article_id, voice):
    voice = normalize_voice(voice)
    payload = read_manifest(article_id)
    if payload is None or not manifest_is_complete(payload):
        raise FileNotFoundError("文章不存在")
    if normalize_voice(payload.get("voice")) == voice:
        payload["state"] = read_state(article_id)
        payload["cached"] = True
        return payload

    source = source_for_article(article_id)
    source_digest = payload.get("source_hash") or content_hash(source.read_bytes())
    existing = find_article_by_hash(source_digest, voice=voice)
    if existing is not None:
        existing["state"] = read_state(existing["id"])
        existing["cached"] = True
        return existing

    next_id = uuid.uuid4().hex[:12]
    next_dir = GENERATED / next_id
    next_dir.mkdir(parents=True, exist_ok=True)
    next_source = next_dir / source.name
    if source.resolve() != next_source.resolve():
        shutil.copy2(source, next_source)
    if next_source.suffix.lower() == ".txt":
        next_payload = build_text_article(
            next_source,
            next_id,
            source_hash=source_digest,
            voice=voice,
        )
    else:
        next_payload = build_article(
            next_source,
            next_id,
            source_hash=source_digest,
            voice=voice,
        )
    next_payload["state"] = default_state()
    next_payload["cached"] = False
    return next_payload


def read_manifest(article_id):
    path = GENERATED / article_id / "manifest.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, payload):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(path)


def state_path(article_id):
    return GENERATED / article_id / "state.json"


def default_state():
    return {
        "progress": {
            "mode": "sentence",
            "sentence_index": 0,
            "time": 0,
            "speed": 0.75,
        },
        "notes": [],
        "dictation": {},
        "last_opened_at": None,
    }


def read_state(article_id):
    path = state_path(article_id)
    if not path.exists():
        return default_state()
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default_state()
    merged = default_state()
    merged.update(state)
    merged["progress"] = {**default_state()["progress"], **state.get("progress", {})}
    merged["notes"] = state.get("notes", [])
    merged["dictation"] = state.get("dictation", {})
    return merged


def save_state(article_id, state):
    article_dir = GENERATED / article_id
    if not (article_dir / "manifest.json").exists():
        raise FileNotFoundError("文章不存在")
    clean = default_state()
    progress = state.get("progress", {})
    clean["progress"] = {
        "mode": progress.get("mode", "sentence"),
        "sentence_index": max(0, int(progress.get("sentence_index", 0))),
        "time": max(0, float(progress.get("time", 0))),
        "speed": float(progress.get("speed", 0.75)),
    }
    if clean["progress"]["mode"] not in {"sentence", "full"}:
        clean["progress"]["mode"] = "sentence"
    if clean["progress"]["speed"] not in {0.5, 0.75, 1.0, 1.25}:
        clean["progress"]["speed"] = 0.75

    notes = []
    for raw_note in state.get("notes", []):
        text = normalize_text(str(raw_note.get("text", "")))
        if not text:
            continue
        notes.append({
            "id": str(raw_note.get("id") or uuid.uuid4().hex[:12]),
            "text": text[:3000],
            "sentence_index": max(0, int(raw_note.get("sentence_index", 0))),
            "context": normalize_text(str(raw_note.get("context", "")))[:5000],
            "comment": str(raw_note.get("comment", "")).strip()[:1000],
            "mastered": bool(raw_note.get("mastered", False)),
            "created_at": str(raw_note.get("created_at") or utc_now()),
        })
    clean["notes"] = notes
    dictation = {}
    raw_dictation = state.get("dictation", {})
    if isinstance(raw_dictation, dict):
        for key, value in raw_dictation.items():
            if not re.fullmatch(r"\d{1,4}", str(key)):
                continue
            dictation[str(key)] = str(value)[:5000]
    clean["dictation"] = dictation
    clean["last_opened_at"] = state.get("last_opened_at") or utc_now()
    with STATE_LOCK:
        write_json(state_path(article_id), clean)
    return clean


def manifest_is_complete(payload):
    article_id = payload.get("id")
    if not article_id:
        return False
    article_dir = GENERATED / article_id
    expected = [article_dir / "audio" / "full-article.mp3"]
    expected.extend(
        article_dir / "audio" / f"sentence-{index:03d}.mp3"
        for index in range(1, len(payload.get("sentences", [])) + 1)
    )
    return all(path.exists() and path.stat().st_size > 1024 for path in expected)


def list_articles():
    variants = []
    if not GENERATED.exists():
        return []
    for directory in GENERATED.iterdir():
        if not directory.is_dir() or directory.name == SAMPLE_ID:
            continue
        payload = read_manifest(directory.name)
        if not payload or not manifest_is_complete(payload):
            continue
        changed = False
        source = directory / "source.docx"
        if not payload.get("source_hash") and source.exists():
            payload["source_hash"] = content_hash(source.read_bytes())
            changed = True
        if not payload.get("created_at"):
            payload["created_at"] = datetime.fromtimestamp(
                (directory / "manifest.json").stat().st_mtime,
                tz=timezone.utc,
            ).isoformat(timespec="seconds")
            changed = True
        if not payload.get("updated_at"):
            payload["updated_at"] = payload["created_at"]
            changed = True
        if changed:
            write_json(directory / "manifest.json", payload)
        state = read_state(directory.name)
        variants.append({
            "id": payload["id"],
            "title": payload.get("title", "Untitled"),
            "voice": normalize_voice(payload.get("voice")),
            "voice_label": AVAILABLE_VOICES[normalize_voice(payload.get("voice"))],
            "source_hash": payload.get("source_hash"),
            "word_count": payload.get("word_count", 0),
            "sentence_count": len(payload.get("sentences", [])),
            "created_at": payload.get("created_at"),
            "updated_at": payload.get("updated_at"),
            "last_opened_at": state.get("last_opened_at"),
            "note_count": len(state.get("notes", [])),
            "progress": state.get("progress", {}),
        })
    variants.sort(
        key=lambda item: item.get("last_opened_at") or item.get("created_at") or "",
        reverse=True,
    )
    grouped = {}
    for item in variants:
        identity = item.get("source_hash") or item["id"]
        if identity not in grouped:
            grouped[identity] = {**item, "available_voices": []}
        grouped_item = grouped[identity]
        grouped_item["available_voices"].append({
            "id": item["id"],
            "voice": item["voice"],
            "voice_label": item["voice_label"],
        })
        grouped_item["note_count"] = max(grouped_item.get("note_count", 0), item.get("note_count", 0))
        if item.get("last_opened_at") and (
            not grouped_item.get("last_opened_at")
            or item["last_opened_at"] > grouped_item["last_opened_at"]
        ):
            grouped_item.update({
                "id": item["id"],
                "voice": item["voice"],
                "voice_label": item["voice_label"],
                "last_opened_at": item["last_opened_at"],
                "progress": item.get("progress", {}),
            })
    return list(grouped.values())


def list_note_groups():
    grouped = {}
    if not GENERATED.exists():
        return []
    for directory in GENERATED.iterdir():
        if not directory.is_dir() or directory.name == SAMPLE_ID:
            continue
        payload = read_manifest(directory.name)
        if not payload or not manifest_is_complete(payload):
            continue
        state = read_state(directory.name)
        notes = state.get("notes", [])
        if not notes:
            continue
        identity = payload.get("source_hash") or payload.get("id")
        last_opened = state.get("last_opened_at") or payload.get("created_at") or ""
        group = grouped.get(identity)
        should_replace = (
            group is None
            or len(notes) > group.get("note_count", 0)
            or (
                len(notes) == group.get("note_count", 0)
                and last_opened > group.get("last_opened_at", "")
            )
        )
        if should_replace:
            grouped[identity] = {
                "id": payload["id"],
                "title": payload.get("title", "Untitled"),
                "source_hash": payload.get("source_hash"),
                "word_count": payload.get("word_count", 0),
                "sentence_count": len(payload.get("sentences", [])),
                "note_count": len(notes),
                "last_opened_at": last_opened,
                "notes": notes,
            }
    groups = list(grouped.values())
    groups.sort(key=lambda item: item.get("last_opened_at") or "", reverse=True)
    return groups


def find_article_by_hash(source_hash, voice=DEFAULT_VOICE):
    if not source_hash:
        return None
    voice = normalize_voice(voice)
    if not GENERATED.exists():
        return None
    for directory in GENERATED.iterdir():
        if not directory.is_dir():
            continue
        manifest = read_manifest(directory.name)
        if (
            manifest
            and manifest.get("source_hash") == source_hash
            and normalize_voice(manifest.get("voice")) == voice
            and manifest_is_complete(manifest)
        ):
            return manifest
    return None


def selection_audio(article_id, text, voice=DEFAULT_VOICE):
    if read_manifest(article_id) is None:
        raise FileNotFoundError("文章不存在")
    voice = normalize_voice(voice)
    normalized = normalize_text(text)
    words = count_words(normalized)
    if words < 1:
        raise ValueError("请先选择需要播放的英文内容")
    if words > SELECTION_MAX_WORDS:
        raise ValueError(f"选中文字不能超过 {SELECTION_MAX_WORDS} 词")
    digest = hashlib.sha256(f"{voice}\n{normalized}".encode("utf-8")).hexdigest()[:20]
    selection_dir = GENERATED / article_id / "selections"
    destination = selection_dir / f"{digest}.mp3"
    if not destination.exists() or destination.stat().st_size < 1024:
        selection_dir.mkdir(parents=True, exist_ok=True)
        asyncio.run(synthesize_with_retry(normalized, destination, voice=voice))
    return {
        "text": normalized,
        "audio": f"/generated/{article_id}/selections/{destination.name}",
        "voice": voice,
        "voice_label": AVAILABLE_VOICES[voice],
    }


class PlayerHandler(SimpleHTTPRequestHandler):
    server_version = "EnglishListeningPlayer/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        print(f"[player] {self.address_string()} - {format % args}")

    def send_json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0 or content_length > 2 * 1024 * 1024:
            raise ValueError("请求内容无效")
        return json.loads(self.rfile.read(content_length).decode("utf-8"))

    def serve_generated_audio(self, request_path):
        relative = request_path.lstrip("/")
        file_path = (ROOT / relative).resolve()
        generated_root = GENERATED.resolve()
        if (
            generated_root not in file_path.parents
            or file_path.suffix.lower() != ".mp3"
            or not file_path.exists()
        ):
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        file_size = file_path.stat().st_size
        range_header = self.headers.get("Range")
        start = 0
        end = file_size - 1
        status = HTTPStatus.OK
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            if not match:
                self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                return
            if match.group(1):
                start = int(match.group(1))
            if match.group(2):
                end = min(int(match.group(2)), file_size - 1)
            if start >= file_size or start > end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.end_headers()
                return
            status = HTTPStatus.PARTIAL_CONTENT

        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()
        try:
            with file_path.open("rb") as handle:
                handle.seek(start)
                remaining = length
                while remaining:
                    chunk = handle.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/generated/") and path.lower().endswith(".mp3"):
            self.serve_generated_audio(path)
            return
        if path == "/api/articles":
            self.send_json({"articles": list_articles()})
            return
        if path == "/api/notes":
            self.send_json({"groups": list_note_groups()})
            return
        match = re.fullmatch(r"/api/articles/([A-Za-z0-9_-]+)", path)
        if match:
            article_id = match.group(1)
            payload = read_manifest(article_id)
            if payload is None or not manifest_is_complete(payload):
                self.send_json({"error": "文章不存在"}, HTTPStatus.NOT_FOUND)
                return
            payload["state"] = read_state(article_id)
            self.send_json(payload)
            return
        if path == "/api/sample":
            payload = read_manifest(SAMPLE_ID)
            if payload is None:
                self.send_json({"error": "示例文章尚未生成"}, HTTPStatus.NOT_FOUND)
            else:
                self.send_json(payload)
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        state_match = re.fullmatch(r"/api/articles/([A-Za-z0-9_-]+)/state", path)
        if state_match:
            try:
                state = save_state(state_match.group(1), self.read_json_body())
                self.send_json(state)
            except FileNotFoundError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        notes_match = re.fullmatch(r"/api/articles/([A-Za-z0-9_-]+)/notes", path)
        if notes_match:
            try:
                article_id = notes_match.group(1)
                current_state = read_state(article_id)
                current_state["notes"] = self.read_json_body().get("notes", [])
                state = save_state(article_id, current_state)
                self.send_json({
                    "notes": state.get("notes", []),
                    "note_count": len(state.get("notes", [])),
                })
            except FileNotFoundError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        voice_match = re.fullmatch(r"/api/articles/([A-Za-z0-9_-]+)/voice", path)
        if voice_match:
            try:
                body = self.read_json_body()
                payload = article_with_voice(
                    voice_match.group(1),
                    str(body.get("voice", DEFAULT_VOICE)),
                )
                self.send_json(payload)
            except FileNotFoundError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            except SpeechServiceError:
                self.send_json(
                    {"error": "在线美式语音服务暂时繁忙，请稍后再试"},
                    HTTPStatus.SERVICE_UNAVAILABLE,
                )
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        if path == "/api/selection":
            try:
                body = self.read_json_body()
                payload = selection_audio(
                    str(body.get("article_id", "")),
                    str(body.get("text", "")),
                    str(body.get("voice", DEFAULT_VOICE)),
                )
                self.send_json(payload)
            except FileNotFoundError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except SpeechServiceError:
                self.send_json(
                    {"error": "在线美式语音服务暂时繁忙，请稍后再试"},
                    HTTPStatus.SERVICE_UNAVAILABLE,
                )
            return

        if path == "/api/import-text":
            try:
                body = self.read_json_body()
                voice = normalize_voice(str(body.get("voice", DEFAULT_VOICE)))
                source_text = canonical_text_source(body.get("text", ""))
                if not source_text:
                    raise ValueError("请先粘贴英文内容")
                if len(source_text) > MAX_TEXT_CHARS:
                    raise ValueError("粘贴文本不能超过 60000 个字符")

                source_bytes = source_text.encode("utf-8")
                source_digest = content_hash(source_bytes)
                existing = find_article_by_hash(source_digest, voice=voice)
                if existing is not None:
                    existing["state"] = read_state(existing["id"])
                    existing["cached"] = True
                    self.send_json(existing)
                    return

                article_id = uuid.uuid4().hex[:12]
                article_dir = GENERATED / article_id
                article_dir.mkdir(parents=True, exist_ok=True)
                source = article_dir / "source.txt"
                source.write_text(source_text, encoding="utf-8")

                payload = build_text_article(source, article_id, source_hash=source_digest, voice=voice)
                payload["state"] = default_state()
                payload["cached"] = False
                self.send_json(payload)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except SpeechServiceError as exc:
                print(f"Speech service failed: {exc}", file=sys.stderr, flush=True)
                self.send_json(
                    {"error": "在线美式语音服务暂时繁忙，请稍后再试"},
                    HTTPStatus.SERVICE_UNAVAILABLE,
                )
            except Exception as exc:
                print(f"Text import failed: {exc}", file=sys.stderr, flush=True)
                self.send_json(
                    {"error": "处理失败，请确认粘贴内容后重试"},
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
            return

        if path != "/api/import":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0 or content_length > MAX_UPLOAD_BYTES:
            self.send_json({"error": "文件不能为空且不能超过 20 MB"}, HTTPStatus.BAD_REQUEST)
            return

        try:
            content_type = self.headers.get("Content-Type", "")
            raw_body = self.rfile.read(content_length)
            message = BytesParser(policy=policy.default).parsebytes(
                b"Content-Type: "
                + content_type.encode("utf-8")
                + b"\r\nMIME-Version: 1.0\r\n\r\n"
                + raw_body
            )
            file_part = next(
                (
                    part
                    for part in message.iter_parts()
                    if part.get_param("name", header="content-disposition") == "file"
                ),
                None,
            )
            voice_part = next(
                (
                    part
                    for part in message.iter_parts()
                    if part.get_param("name", header="content-disposition") == "voice"
                ),
                None,
            )
            voice = DEFAULT_VOICE
            if voice_part is not None:
                voice = normalize_voice((voice_part.get_payload(decode=True) or b"").decode("utf-8", "ignore"))
            if file_part is None:
                raise ValueError("没有收到 Word 文件")

            filename = Path(file_part.get_filename() or "").name
            if Path(filename).suffix.lower() != ".docx":
                raise ValueError("请选择 .docx 格式的 Word 文件")

            source_bytes = file_part.get_payload(decode=True)
            source_digest = content_hash(source_bytes)
            existing = find_article_by_hash(source_digest, voice=voice)
            if existing is not None:
                existing["state"] = read_state(existing["id"])
                existing["cached"] = True
                self.send_json(existing)
                return

            article_id = uuid.uuid4().hex[:12]
            article_dir = GENERATED / article_id
            article_dir.mkdir(parents=True, exist_ok=True)
            source = article_dir / "source.docx"
            source.write_bytes(source_bytes)

            payload = build_article(source, article_id, source_hash=source_digest, voice=voice)
            payload["state"] = default_state()
            payload["cached"] = False
            self.send_json(payload)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except SpeechServiceError as exc:
            print(f"Speech service failed: {exc}", file=sys.stderr, flush=True)
            self.send_json(
                {"error": "在线美式语音服务暂时繁忙，请稍后再试"},
                HTTPStatus.SERVICE_UNAVAILABLE,
            )
        except Exception as exc:
            print(f"Import failed: {exc}", file=sys.stderr, flush=True)
            self.send_json(
                {"error": "处理失败，请确认 Word 文件内容后重试"},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def do_DELETE(self):
        path = urlparse(self.path).path
        match = re.fullmatch(r"/api/articles/([A-Za-z0-9_-]+)", path)
        if not match:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        article_id = match.group(1)
        article_dir = (GENERATED / article_id).resolve()
        if article_dir.parent != GENERATED.resolve() or not article_dir.exists():
            self.send_json({"error": "文章不存在"}, HTTPStatus.NOT_FOUND)
            return
        if article_id == SAMPLE_ID:
            self.send_json({"error": "示例文章不能删除"}, HTTPStatus.BAD_REQUEST)
            return
        payload = read_manifest(article_id) or {}
        source_hash = payload.get("source_hash")
        deleted = []
        for directory in GENERATED.iterdir():
            if not directory.is_dir() or directory.name == SAMPLE_ID:
                continue
            manifest = read_manifest(directory.name) or {}
            same_article = source_hash and manifest.get("source_hash") == source_hash
            if directory.name == article_id or same_article:
                shutil.rmtree(directory, ignore_errors=True)
                deleted.append(directory.name)
        self.send_json({"deleted": deleted or [article_id]})


def find_sample_source():
    candidate = SAMPLE_SOURCE
    if candidate.exists():
        return candidate
    raise FileNotFoundError("找不到原创示例文本")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--build-sample", action="store_true")
    parser.add_argument("--inspect", type=Path)
    args = parser.parse_args()

    if args.inspect:
        title, paragraphs, removed = extract_article(args.inspect)
        sentences = split_sentences(paragraphs)
        print(json.dumps({
            "title": title,
            "paragraphs": len(paragraphs),
            "sentences": len(sentences),
            "words": sum(count_words(item) for item in sentences),
            "removed": removed,
        }, ensure_ascii=False, indent=2))
        return

    GENERATED.mkdir(exist_ok=True)

    if args.build_sample:
        payload = build_text_article(find_sample_source(), SAMPLE_ID)
        print(json.dumps({
            "title": payload["title"],
            "sentences": len(payload["sentences"]),
            "words": payload["word_count"],
        }, ensure_ascii=False, indent=2))
        return

    server = ThreadingHTTPServer((HOST, args.port), PlayerHandler)
    print(f"English listening player: http://{HOST}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
