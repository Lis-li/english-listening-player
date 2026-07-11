const $ = (selector) => document.querySelector(selector);
const audio = $("#audio");
const pageNav = $("#pageNav");
const topbar = $(".topbar");
const voiceRow = $(".voice-row");
const articleTitle = $("#articleTitle");
const articleStats = $("#articleStats");
const playButton = $("#playButton");
const previousButton = $("#previousButton");
const nextButton = $("#nextButton");
const replayButton = $("#replayButton");
const backFiveButton = $("#backFiveButton");
const forwardFiveButton = $("#forwardFiveButton");
const transcriptButton = $("#transcriptButton");
const sentenceMode = $("#sentenceMode");
const fullMode = $("#fullMode");
const controlBand = $(".control-band");
const sentenceCounter = $("#sentenceCounter");
const currentSentence = $("#currentSentence");
const currentMilestones = $("#currentMilestones");
const dictationPanel = $("#dictationPanel");
const dictationInput = $("#dictationInput");
const dictationStatus = $("#dictationStatus");
const clearDictationButton = $("#clearDictationButton");
const dictationReview = $("#dictationReview");
const dictationReviewStatus = $("#dictationReviewStatus");
const dictationAnswer = $("#dictationAnswer");
const dictationOriginal = $("#dictationOriginal");
const playerHeading = $("#player-heading");
const progress = $("#progress");
const currentTime = $("#currentTime");
const duration = $("#duration");
const sentenceList = $("#sentenceList");
const sentenceSection = $("#sentenceSection");
const backButton = $("#backButton");
const homeButton = $("#homeButton");
const importButton = $("#importButton");
const pasteButton = $("#pasteButton");
const fileInput = $("#fileInput");
const statusBar = $("#statusBar");
const statusText = $("#statusText");
const libraryButton = $("#libraryButton");
const notesButton = $("#notesButton");
const libraryPanel = $("#libraryPanel");
const notesPanel = $("#notesPanel");
const libraryList = $("#libraryList");
const notesList = $("#notesList");
const notesEmpty = $("#notesEmpty");
const saveSentenceButton = $("#saveSentenceButton");
const selectionToolbar = $("#selectionToolbar");
const selectionPreview = $("#selectionPreview");
const playSelectionButton = $("#playSelectionButton");
const saveSelectionButton = $("#saveSelectionButton");
const returnArticleButton = $("#returnArticleButton");
const noteDialog = $("#noteDialog");
const noteTextPreview = $("#noteTextPreview");
const noteComment = $("#noteComment");
const confirmNoteButton = $("#confirmNoteButton");
const pasteDialog = $("#pasteDialog");
const pasteTextInput = $("#pasteTextInput");
const confirmPasteButton = $("#confirmPasteButton");
const playerPanel = $(".player-panel");
const speedButtons = [...document.querySelectorAll("[data-speed]")];
const voiceButtons = [...document.querySelectorAll("[data-voice]")];
const WORD_MILESTONE_INTERVAL = 100;
const DEFAULT_VOICE = "en-US-AriaNeural";
const IS_STATIC_DEMO = window.location.hostname.endsWith(".github.io")
  || new URLSearchParams(window.location.search).has("demo");
const DEMO_BASE_URL = new URL("./", window.location.href);
const DEMO_STATE_PREFIX = "english-listening-player-demo-state";

let demoCatalogPromise = null;
const demoManifestPromises = new Map();

function demoStateKey(articleId) {
  return `${DEMO_STATE_PREFIX}:${articleId}`;
}

function readDemoState(articleId) {
  try {
    return {
      ...defaultClientState(),
      ...JSON.parse(window.localStorage.getItem(demoStateKey(articleId)) || "{}")
    };
  } catch {
    return defaultClientState();
  }
}

function writeDemoState(articleId, state) {
  window.localStorage.setItem(demoStateKey(articleId), JSON.stringify(state));
  return state;
}

async function loadDemoCatalog() {
  if (!demoCatalogPromise) {
    demoCatalogPromise = fetch(new URL("demo-content/catalog.json", DEMO_BASE_URL))
      .then(async (response) => {
        if (!response.ok) throw new Error("在线资料库加载失败");
        return response.json();
      });
  }
  return demoCatalogPromise;
}

async function loadDemoArticle(articleId, voice = DEFAULT_VOICE) {
  const catalog = await loadDemoCatalog();
  const entry = catalog.articles.find((item) => item.id === articleId);
  if (!entry) throw new Error("在线文章不存在");

  const normalizedVoice = entry.variants[voice] ? voice : DEFAULT_VOICE;
  const manifestPath = entry.variants[normalizedVoice];
  if (!demoManifestPromises.has(manifestPath)) {
    const manifestUrl = new URL(manifestPath, DEMO_BASE_URL);
    demoManifestPromises.set(manifestPath, fetch(manifestUrl).then(async (response) => {
      if (!response.ok) throw new Error("在线音频清单加载失败");
      const payload = await response.json();
      const manifestDir = new URL("./", manifestUrl);
      payload.full_audio = new URL("audio/full-article.mp3", manifestDir).href;
      payload.sentences = payload.sentences.map((sentence) => ({
        ...sentence,
        audio: new URL(`audio/${String(sentence.audio).split("/").pop()}`, manifestDir).href
      }));
      return payload;
    }));
  }

  const payload = structuredClone(await demoManifestPromises.get(manifestPath));
  payload.id = entry.id;
  payload.source_hash = `demo-${entry.id}`;
  payload.voice = normalizedVoice;
  payload.state = readDemoState(entry.id);
  return payload;
}

async function demoApi(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const catalog = await loadDemoCatalog();

  if (method === "GET" && url === "/api/sample") {
    return loadDemoArticle(catalog.default_article);
  }
  if (method === "GET" && url === "/api/articles") {
    return {
      articles: catalog.articles.map((entry) => ({
        id: entry.id,
        title: entry.title,
        voice: DEFAULT_VOICE,
        source_hash: `demo-${entry.id}`,
        word_count: entry.word_count,
        sentence_count: entry.sentence_count,
        note_count: readDemoState(entry.id).notes?.length || 0
      }))
    };
  }
  if (method === "GET" && url === "/api/notes") {
    return {
      groups: catalog.articles.flatMap((entry) => {
        const notes = readDemoState(entry.id).notes || [];
        return notes.length ? [{
          id: entry.id,
          title: entry.title,
          source_hash: `demo-${entry.id}`,
          word_count: entry.word_count,
          sentence_count: entry.sentence_count,
          note_count: notes.length,
          notes
        }] : [];
      })
    };
  }

  const articleMatch = url.match(/^\/api\/articles\/([a-z0-9-]+)(?:\/(state|notes|voice))?$/i);
  if (!articleMatch) {
    throw new Error("此功能需要 Python 后端，在线 Demo 仅提供预生成的原创资料。");
  }

  const [, articleId, action] = articleMatch;
  if (method === "GET" && !action) {
    return loadDemoArticle(articleId);
  }
  if (method === "POST" && action === "voice") {
    const voice = JSON.parse(options.body || "{}").voice || DEFAULT_VOICE;
    return loadDemoArticle(articleId, voice);
  }
  if (method === "POST" && action === "state") {
    return writeDemoState(articleId, JSON.parse(options.body || "{}"));
  }
  if (method === "POST" && action === "notes") {
    const state = readDemoState(articleId);
    const notes = JSON.parse(options.body || "{}").notes || [];
    writeDemoState(articleId, { ...state, notes });
    return { notes, note_count: notes.length };
  }

  throw new Error("此功能需要 Python 后端，在线 Demo 仅提供预生成的原创资料。");
}

const articleControls = [
  sentenceMode,
  fullMode,
  previousButton,
  replayButton,
  backFiveButton,
  playButton,
  forwardFiveButton,
  nextButton,
  transcriptButton,
  progress,
  saveSentenceButton,
  ...speedButtons
];

let article = null;
let articleState = null;
let mode = "sentence";
let currentIndex = 0;
let playbackSpeed = 0.75;
let selectedVoice = DEFAULT_VOICE;
let sourceKind = "article";
let pendingSeek = 0;
let savedArticleTime = 0;
let selectionData = null;
let noteDraft = null;
let saveTimer = null;
let lastProgressSave = 0;
let currentView = "home";
let viewHistory = [];

function formatTime(value) {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function countEnglishWords(text) {
  return (text.match(/\b[A-Za-z]+(?:[’'-][A-Za-z]+)*\b/g) || []).length;
}

async function api(url, options = {}) {
  if (IS_STATIC_DEMO) return demoApi(url, options);
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function addWordMilestones(nextArticle) {
  let cumulativeWords = 0;
  let nextMilestone = WORD_MILESTONE_INTERVAL;
  nextArticle.sentences.forEach((sentence) => {
    const sentenceWords = countEnglishWords(sentence.text);
    cumulativeWords += sentenceWords;
    sentence.word_count = sentenceWords;
    sentence.cumulative_words = cumulativeWords;
    sentence.milestones = [];
    while (nextMilestone <= cumulativeWords) {
      sentence.milestones.push(nextMilestone);
      nextMilestone += WORD_MILESTONE_INTERVAL;
    }
  });
  nextArticle.milestone_count = Math.floor(cumulativeWords / WORD_MILESTONE_INTERVAL);
}

function createMilestoneBadge(value) {
  const badge = document.createElement("span");
  badge.className = "word-milestone";
  badge.textContent = `达到 ${value} 词`;
  return badge;
}

function setBusy(busy, message = "正在处理文档") {
  statusBar.hidden = !busy;
  statusText.textContent = message;
  importButton.disabled = busy;
  pasteButton.disabled = busy;
}

function setArticleControlsEnabled(enabled) {
  articleControls.forEach((control) => {
    control.disabled = !enabled;
  });
}

function applyPlaybackSpeed() {
  audio.defaultPlaybackRate = playbackSpeed;
  audio.playbackRate = playbackSpeed;
}

function defaultClientState() {
  return {
    progress: { mode: "sentence", sentence_index: 0, time: 0, speed: 0.75 },
    notes: [],
    dictation: {},
    last_opened_at: null
  };
}

function showEmptyState() {
  article = null;
  articleState = null;
  mode = "sentence";
  currentIndex = 0;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  articleTitle.textContent = "等待导入 Word 文档";
  articleStats.textContent = "";
  playerHeading.textContent = "尚未载入文章";
  sentenceCounter.textContent = "0 / 0";
  currentSentence.textContent = "从文章资料库打开文章，或在首页导入 Word / 粘贴文本。";
  currentSentence.classList.add("empty-message");
  currentMilestones.replaceChildren();
  currentMilestones.hidden = true;
  sentenceList.replaceChildren();
  progress.value = 0;
  currentTime.textContent = "0:00";
  duration.textContent = "0:00";
  notesList.replaceChildren();
  notesEmpty.hidden = false;
  dictationPanel.hidden = true;
  dictationReview.hidden = true;
  dictationInput.value = "";
  showHome({ remember: false, clearHistory: true });
  setArticleControlsEnabled(false);
}

function setTopbarHome(isHome) {
  topbar.hidden = false;
  topbar.classList.toggle("home-topbar", isHome);
  topbar.classList.toggle("article-topbar", !isHome);
  voiceRow.hidden = isHome;
  importButton.hidden = !isHome || IS_STATIC_DEMO;
  pasteButton.hidden = !isHome || IS_STATIC_DEMO;
  libraryButton.hidden = !isHome;
  notesButton.hidden = false;
  pageNav.hidden = true;
}

function hideWorkspacePanels() {
  libraryPanel.hidden = true;
  notesPanel.hidden = true;
  controlBand.hidden = true;
  playerPanel.hidden = true;
  sentenceSection.hidden = true;
}

function setView(nextView, { remember = true, clearHistory = false } = {}) {
  if (clearHistory) {
    viewHistory = [];
  }
  if (remember && currentView !== nextView) {
    viewHistory.push(currentView);
  }
  currentView = nextView;
}

function showHome(options = {}) {
  setView("home", options);
  setTopbarHome(true);
  articleTitle.textContent = "英语听力训练";
  articleStats.textContent = "导入 Word、粘贴英文文本、打开资料库，或查看学习笔记";
  hideWorkspacePanels();
}

function showArticleWorkspace(options = {}) {
  if (!article) return;
  setView("article", options);
  setTopbarHome(false);
  pageNav.hidden = false;
  articleTitle.textContent = article.title;
  articleStats.textContent =
    `${article.word_count} 词 · ${article.sentences.length} 句 · ${article.milestone_count} 个 100 词节点 · ${articleState.notes.length} 条笔记`;
  libraryPanel.hidden = true;
  notesPanel.hidden = true;
  controlBand.hidden = false;
  playerPanel.hidden = false;
  sentenceSection.hidden = mode !== "sentence";
}

function showLibraryOnly(options = {}) {
  setView("library", options);
  pageNav.hidden = false;
  topbar.hidden = true;
  libraryPanel.hidden = false;
  notesPanel.hidden = true;
  controlBand.hidden = true;
  playerPanel.hidden = true;
  sentenceSection.hidden = true;
}

function showNotesOnly(options = {}) {
  setView("notes", options);
  pageNav.hidden = false;
  topbar.hidden = true;
  libraryPanel.hidden = true;
  notesPanel.hidden = false;
  controlBand.hidden = true;
  playerPanel.hidden = true;
  sentenceSection.hidden = true;
  refreshNotesPage();
}

function navigateToView(target) {
  if (target === "article" && article) {
    showArticleWorkspace({ remember: false });
  } else if (target === "library") {
    showLibraryOnly({ remember: false });
    refreshLibrary();
  } else if (target === "notes") {
    showNotesOnly({ remember: false });
  } else {
    showHome({ remember: false, clearHistory: true });
  }
}

function goBack() {
  while (viewHistory.length) {
    const target = viewHistory.pop();
    if (target !== currentView) {
      navigateToView(target);
      return;
    }
  }
  showHome({ remember: false, clearHistory: true });
}

function setSource(source, { autoplay = false, seek = 0, kind = "article" } = {}) {
  audio.pause();
  sourceKind = kind;
  audio.loop = false;
  returnArticleButton.hidden = kind !== "selection";
  pendingSeek = Math.max(0, seek || 0);
  audio.src = source;
  applyPlaybackSpeed();
  audio.load();
  applyPlaybackSpeed();
  progress.value = 0;
  currentTime.textContent = "0:00";
  duration.textContent = "0:00";
  playButton.textContent = "▶";
  if (autoplay) {
    audio.addEventListener("canplay", () => {
      applyPlaybackSpeed();
      audio.play().catch(() => {});
    }, { once: true });
  }
}

function articleAudioSource() {
  if (!article) return null;
  return mode === "sentence"
    ? article.sentences[currentIndex].audio
    : article.full_audio;
}

function updateSentenceView({ autoplay = false, seek = 0 } = {}) {
  if (!article) return;
  const sentence = article.sentences[currentIndex];
  playerHeading.textContent = "当前句子";
  currentSentence.textContent = sentence.text;
  sentenceCounter.textContent = `${currentIndex + 1} / ${article.sentences.length}`;
  currentMilestones.replaceChildren(...sentence.milestones.map(createMilestoneBadge));
  currentMilestones.hidden = sentence.milestones.length === 0;
  previousButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === article.sentences.length - 1;
  saveSentenceButton.hidden = false;
  document.querySelectorAll(".sentence-select").forEach((button, index) => {
    button.classList.toggle("active", index === currentIndex);
    button.setAttribute("aria-current", index === currentIndex ? "true" : "false");
  });
  setSource(sentence.audio, { autoplay, seek, kind: "article" });
  renderDictationPractice();
}

function setMode(nextMode, { autoplay = false, seek = 0 } = {}) {
  if (!article) return;
  mode = nextMode;
  const isSentence = mode === "sentence";
  sentenceMode.classList.toggle("active", isSentence);
  fullMode.classList.toggle("active", !isSentence);
  previousButton.hidden = !isSentence;
  nextButton.hidden = !isSentence;
  saveSentenceButton.hidden = !isSentence;
  sentenceSection.hidden = !isSentence;

  if (isSentence) {
    updateSentenceView({ autoplay, seek });
  } else {
    playerHeading.textContent = "整篇文章";
    sentenceCounter.textContent = `${article.sentences.length} 个句子`;
    currentSentence.textContent = article.full_text;
    currentMilestones.replaceChildren();
    currentMilestones.hidden = true;
    setSource(article.full_audio, { autoplay, seek, kind: "article" });
    renderDictationPractice();
  }
}

function buildSentenceList() {
  sentenceList.replaceChildren();
  article.sentences.forEach((sentence, index) => {
    const item = document.createElement("li");
    item.className = "sentence-item";
    const button = document.createElement("button");
    button.className = "sentence-select";
    button.type = "button";
    button.dataset.index = String(index);
    button.setAttribute("aria-label", `播放第 ${index + 1} 句`);

    const content = document.createElement("span");
    content.className = "sentence-content";
    const copy = document.createElement("span");
    copy.className = "sentence-copy";
    copy.textContent = sentence.text;
    content.append(copy);

    if (sentence.milestones.length) {
      const markers = document.createElement("span");
      markers.className = "milestone-row";
      sentence.milestones.forEach((value) => markers.append(createMilestoneBadge(value)));
      content.append(markers);
    }
    button.append(content);
    button.addEventListener("click", () => {
      currentIndex = index;
      mode = "sentence";
      updateSentenceView({ autoplay: true });
      scheduleStateSave();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    item.append(button);
    sentenceList.append(item);
  });
}

function statePayload() {
  return {
    progress: {
      mode,
      sentence_index: currentIndex,
      time: sourceKind === "article" ? audio.currentTime || 0 : savedArticleTime,
      speed: playbackSpeed
    },
    notes: articleState?.notes || [],
    dictation: articleState?.dictation || {},
    last_opened_at: new Date().toISOString()
  };
}

async function saveState() {
  if (!article) return;
  articleState = await api(`/api/articles/${article.id}/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(statePayload())
  });
}

function scheduleStateSave(delay = 500) {
  if (!article) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState().catch(() => {}), delay);
}

function dictationKey() {
  return String(currentIndex);
}

function dictationText() {
  return articleState?.dictation?.[dictationKey()] || "";
}

function wordTokens(text) {
  return text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)?|\d+(?:\.\d+)?|[^\s]/g) || [];
}

function normalizedWord(token) {
  return token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

function renderDictationAnswer(text, original) {
  dictationAnswer.replaceChildren();
  const originalWords = wordTokens(original).map(normalizedWord).filter(Boolean);
  let wordIndex = 0;
  wordTokens(text).forEach((token) => {
    const span = document.createElement("span");
    span.textContent = token;
    const normalized = normalizedWord(token);
    if (normalized) {
      span.className = normalized === originalWords[wordIndex] ? "diff-token match" : "diff-token miss";
      wordIndex += 1;
    }
    dictationAnswer.append(span, document.createTextNode(" "));
  });
}

function renderDictationPractice() {
  const hasSentence = article && mode === "sentence" && sourceKind === "article";
  const transcriptHidden = document.body.classList.contains("transcript-hidden");
  const savedText = hasSentence ? dictationText() : "";
  const savedWords = countEnglishWords(savedText);

  dictationPanel.hidden = !(hasSentence && transcriptHidden);
  dictationReview.hidden = !(hasSentence && !transcriptHidden && savedText.trim());

  if (!dictationPanel.hidden) {
    if (dictationInput.value !== savedText) dictationInput.value = savedText;
    dictationStatus.textContent = `${savedWords} 个词`;
  }

  if (!dictationReview.hidden) {
    const original = article.sentences[currentIndex].text;
    renderDictationAnswer(savedText, original);
    dictationOriginal.textContent = original;
    dictationReviewStatus.textContent = `${savedWords} 个词`;
  }
}

function updateVoiceButtons() {
  voiceButtons.forEach((button) => {
    const active = button.dataset.voice === selectedVoice;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function loadArticle(nextArticle, { rememberView = true } = {}) {
  article = nextArticle;
  articleState = nextArticle.state || defaultClientState();
  articleState.dictation = articleState.dictation || {};
  selectedVoice = article.voice || selectedVoice || DEFAULT_VOICE;
  updateVoiceButtons();
  addWordMilestones(article);
  currentSentence.classList.remove("empty-message");
  setArticleControlsEnabled(true);
  articleTitle.textContent = article.title;
  articleStats.textContent =
    `${article.word_count} 词 · ${article.sentences.length} 句 · ${article.milestone_count} 个 100 词节点 · ${articleState.notes.length} 条笔记`;
  document.body.classList.remove("transcript-hidden");
  transcriptButton.textContent = "隐藏原文";
  buildSentenceList();
  renderNotes();

  const restored = articleState.progress || {};
  currentIndex = Math.min(
    Math.max(0, Number(restored.sentence_index) || 0),
    article.sentences.length - 1
  );
  playbackSpeed = [0.5, 0.75, 1, 1.25].includes(Number(restored.speed))
    ? Number(restored.speed)
    : 0.75;
  updateSpeedButtons();
  setMode(restored.mode === "full" ? "full" : "sentence", {
    seek: Number(restored.time) || 0
  });
  articleState.last_opened_at = new Date().toISOString();
  showArticleWorkspace({ remember: rememberView });
  await refreshLibrary();
}

function mergeStateForVoiceSwitch(nextArticle, previousState) {
  const merged = nextArticle.state || defaultClientState();
  const carried = previousState || statePayload();
  merged.progress = {
    ...(merged.progress || {}),
    ...carried.progress,
    time: 0
  };
  merged.notes = (merged.notes && merged.notes.length) ? merged.notes : carried.notes;
  merged.dictation = {
    ...(carried.dictation || {}),
    ...(merged.dictation || {})
  };
  nextArticle.state = merged;
  return nextArticle;
}

async function switchArticleVoice(voice) {
  if (!article) return;
  const currentVoice = article.voice || DEFAULT_VOICE;
  if (currentVoice === voice) return;
  const previousState = statePayload();
  setBusy(true, `正在准备${voice === "en-US-GuyNeural" ? "男声" : "女声"}音频`);
  try {
    const payload = await api(`/api/articles/${article.id}/voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice })
    });
    await loadArticle(mergeStateForVoiceSwitch(payload, previousState), { rememberView: false });
    scheduleStateSave(50);
  } catch (error) {
    selectedVoice = currentVoice;
    updateVoiceButtons();
    window.alert(error.message);
  } finally {
    setBusy(false);
  }
}

async function loadArticleById(articleId, preferredVoice = selectedVoice) {
  setBusy(true, "正在打开已保存的文章");
  try {
    let payload = await api(`/api/articles/${articleId}`);
    const voice = preferredVoice || DEFAULT_VOICE;
    if ((payload.voice || DEFAULT_VOICE) !== voice) {
      payload = await api(`/api/articles/${articleId}/voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice })
      });
    }
    await loadArticle(payload);
  } catch (error) {
    window.alert(error.message);
  } finally {
    setBusy(false);
  }
}

function renderLibrary(items) {
  libraryList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "panel-empty";
    empty.textContent = "尚未保存文章。首次导入 Word 后会自动出现在这里。";
    libraryList.append(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "library-item";
    const open = document.createElement("button");
    open.className = "library-open";
    open.type = "button";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("span");
    meta.textContent = `${item.word_count} 词 · ${item.sentence_count} 句 · ${item.note_count} 条笔记`;
    open.append(title, meta);
    open.addEventListener("click", () => loadArticleById(item.id));
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "删除";
    remove.hidden = IS_STATIC_DEMO;
    remove.addEventListener("click", async () => {
      if (!window.confirm(`删除“${item.title}”及其音频和笔记？`)) return;
      await api(`/api/articles/${item.id}`, { method: "DELETE" });
      if (article?.id === item.id || (article?.source_hash && article.source_hash === item.source_hash)) {
        showEmptyState();
      }
      await refreshLibrary();
    });
    row.append(open, remove);
    libraryList.append(row);
  });
}

async function refreshLibrary() {
  try {
    const payload = await api("/api/articles");
    renderLibrary(payload.articles);
  } catch {
    libraryList.textContent = "资料库读取失败";
  }
}

async function importDocument(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("voice", selectedVoice);
  setBusy(true, "正在检查资料库并处理文档");
  let loadedFromCache = false;
  try {
    const payload = await api("/api/import", { method: "POST", body: formData });
    await loadArticle(payload);
    loadedFromCache = Boolean(payload.cached);
  } catch (error) {
    window.alert(error.message);
  } finally {
    setBusy(false);
    fileInput.value = "";
    if (loadedFromCache) {
      statusText.textContent = "已从资料库快速载入";
      statusBar.hidden = false;
      setTimeout(() => { statusBar.hidden = true; }, 1800);
    }
  }
}

async function importPastedText(text) {
  setBusy(true, "正在把粘贴文本生成听力文章");
  let loadedFromCache = false;
  try {
    const payload = await api("/api/import-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: selectedVoice })
    });
    await loadArticle(payload);
    loadedFromCache = Boolean(payload.cached);
    pasteTextInput.value = "";
    pasteDialog.close();
  } catch (error) {
    window.alert(error.message);
  } finally {
    setBusy(false);
    if (loadedFromCache) {
      statusText.textContent = "已从资料库快速载入";
      statusBar.hidden = false;
      setTimeout(() => { statusBar.hidden = true; }, 1800);
    }
  }
}

function openNoteDialog(draft) {
  noteDraft = draft;
  noteTextPreview.textContent = draft.text;
  noteComment.value = draft.comment || "";
  noteDialog.showModal();
}

function addNote(draft) {
  if (!article) return;
  articleState.notes.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
    text: draft.text,
    sentence_index: draft.sentence_index,
    context: draft.context,
    comment: noteComment.value.trim(),
    mastered: false,
    created_at: new Date().toISOString()
  });
  renderNotes();
  scheduleStateSave(50);
  refreshLibrary();
}

function renderNotes() {
  updateArticleNoteStats();
  if (currentView === "notes") refreshNotesPage();
}

function updateArticleNoteStats() {
  const notes = articleState?.notes || [];
  notesEmpty.hidden = notes.length > 0;
  if (article) {
    articleStats.textContent =
      `${article.word_count} 词 · ${article.sentences.length} 句 · ${article.milestone_count} 个 100 词节点 · ${notes.length} 条笔记`;
  }
}

async function refreshNotesPage() {
  try {
    const payload = await api("/api/notes");
    renderNoteGroups(payload.groups || []);
  } catch {
    notesList.textContent = "学习笔记读取失败";
  }
}

function renderNoteGroups(groups) {
  notesList.replaceChildren();
  notesEmpty.hidden = groups.length > 0;
  groups.forEach((group) => {
    const details = document.createElement("details");
    details.className = "note-group";
    const sameArticle = article && (
      article.id === group.id
      || (article.source_hash && article.source_hash === group.source_hash)
    );
    details.open = sameArticle || groups.length === 1;

    const summary = document.createElement("summary");
    const titleWrap = document.createElement("span");
    titleWrap.className = "note-group-title";
    const title = document.createElement("strong");
    title.textContent = group.title;
    const meta = document.createElement("span");
    meta.textContent = `${group.word_count} 词 · ${group.sentence_count} 句 · ${group.note_count} 条笔记`;
    titleWrap.append(title, meta);
    summary.append(titleWrap);

    const groupNotes = document.createElement("div");
    groupNotes.className = "note-group-list";
    group.notes.forEach((note) => {
      groupNotes.append(createNoteItem(note, group, groups));
    });

    details.append(summary, groupNotes);
    notesList.append(details);
  });
}

function createNoteItem(note, group, groups) {
    const item = document.createElement("div");
    item.className = `note-item${note.mastered ? " mastered" : ""}`;
    const text = document.createElement("button");
    text.className = "note-play";
    text.type = "button";
    text.textContent = note.text;
    text.addEventListener("click", () => playSavedNote(group, note));

    const comment = document.createElement("textarea");
    comment.rows = 2;
    comment.placeholder = "添加备注";
    comment.value = note.comment || "";
    comment.addEventListener("change", () => {
      note.comment = comment.value.trim();
      saveNoteGroup(group);
    });

    const actions = document.createElement("div");
    actions.className = "note-actions";
    const masteredLabel = document.createElement("label");
    masteredLabel.className = "mastered-toggle";
    const mastered = document.createElement("input");
    mastered.type = "checkbox";
    mastered.id = `mastered-${note.id}`;
    mastered.checked = note.mastered;
    mastered.addEventListener("change", () => {
      note.mastered = mastered.checked;
      item.classList.toggle("mastered", note.mastered);
      saveNoteGroup(group);
    });
    masteredLabel.append(mastered, document.createTextNode(" 已掌握"));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", () => {
      group.notes = group.notes.filter((itemNote) => itemNote.id !== note.id);
      group.note_count = group.notes.length;
      renderNoteGroups(groups.filter((itemGroup) => itemGroup.notes.length > 0));
      saveNoteGroup(group);
    });
    actions.append(masteredLabel, remove);
    item.append(text, comment, actions);
    return item;
}

async function saveNoteGroup(group) {
  try {
    const payload = await api(`/api/articles/${group.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: group.notes })
    });
    group.notes = payload.notes || [];
    group.note_count = payload.note_count || group.notes.length;
    if (article && (article.id === group.id || (article.source_hash && article.source_hash === group.source_hash))) {
      articleState.notes = group.notes;
      updateArticleNoteStats();
    }
    refreshLibrary();
  } catch (error) {
    window.alert(error.message);
  }
}

async function playSavedNote(group, note) {
  if (!article || (article.id !== group.id && article.source_hash !== group.source_hash)) {
    await loadArticleById(group.id);
  }
  playText(note.text);
}

async function playText(text) {
  if (!article) return;
  setBusy(true, "正在准备选中内容的发音");
  try {
    savedArticleTime = sourceKind === "article" ? audio.currentTime : savedArticleTime;
    const payload = await api("/api/selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article_id: article.id, text, voice: selectedVoice })
    });
    playerHeading.textContent = "选中内容";
    currentSentence.textContent = payload.text;
    setSource(payload.audio, { autoplay: true, kind: "selection" });
    renderDictationPractice();
  } catch (error) {
    window.alert(error.message);
  } finally {
    setBusy(false);
  }
}

function restoreArticleAudio() {
  if (!article) return;
  audio.loop = false;
  returnArticleButton.hidden = true;
  if (mode === "sentence") updateSentenceView({ seek: savedArticleTime });
  else setMode("full", { seek: savedArticleTime });
}

function captureSelection(event) {
  if (!article || document.body.classList.contains("transcript-hidden")) return;
  const selection = window.getSelection();
  const text = selection.toString().trim();
  if (!text || countEnglishWords(text) < 1) {
    selectionToolbar.hidden = true;
    selectionData = null;
    return;
  }
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!container.closest(".current-sentence, .sentence-copy")) return;
  const sentenceButton = container.closest(".sentence-select");
  const sentenceIndex = sentenceButton
    ? Number(sentenceButton.dataset.index)
    : currentIndex;
  selectionData = {
    text,
    sentence_index: sentenceIndex,
    context: article.sentences[sentenceIndex]?.text || text
  };
  selectionPreview.textContent = text.length > 55 ? `${text.slice(0, 55)}…` : text;
  selectionToolbar.hidden = false;
  selectionToolbar.style.left = `${Math.min(window.innerWidth - 330, Math.max(12, event.clientX - 90))}px`;
  selectionToolbar.style.top = `${Math.max(12, event.clientY + 14)}px`;
}

function updateSpeedButtons() {
  speedButtons.forEach((button) => {
    const active = Number(button.dataset.speed) === playbackSpeed;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

backButton.addEventListener("click", goBack);
homeButton.addEventListener("click", () => showHome({ clearHistory: true }));
importButton.addEventListener("click", () => {
  libraryPanel.hidden = true;
  notesPanel.hidden = true;
  fileInput.click();
});
pasteButton.addEventListener("click", () => {
  pasteDialog.showModal();
  pasteTextInput.focus();
});
fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (file) importDocument(file);
});

libraryButton.addEventListener("click", () => {
  showLibraryOnly();
  refreshLibrary();
});
notesButton.addEventListener("click", () => {
  showNotesOnly();
});
playButton.addEventListener("click", () => {
  if (!article) return;
  if (audio.paused) {
    if (audio.ended || audio.currentTime >= audio.duration) audio.currentTime = 0;
    audio.play().catch(() => {});
  }
  else audio.pause();
});
previousButton.addEventListener("click", () => {
  if (currentIndex > 0) {
    currentIndex -= 1;
    updateSentenceView({ autoplay: true });
    scheduleStateSave();
  }
});
nextButton.addEventListener("click", () => {
  if (article && currentIndex < article.sentences.length - 1) {
    currentIndex += 1;
    updateSentenceView({ autoplay: true });
    scheduleStateSave();
  }
});
replayButton.addEventListener("click", () => {
  audio.currentTime = 0;
  audio.play().catch(() => {});
});
backFiveButton.addEventListener("click", () => {
  audio.currentTime = Math.max(0, audio.currentTime - 5);
});
forwardFiveButton.addEventListener("click", () => {
  audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
});
transcriptButton.addEventListener("click", () => {
  const hidden = document.body.classList.toggle("transcript-hidden");
  transcriptButton.textContent = hidden ? "显示原文" : "隐藏原文";
  renderDictationPractice();
});
sentenceMode.addEventListener("click", () => {
  setMode("sentence");
  scheduleStateSave();
});
fullMode.addEventListener("click", () => {
  setMode("full");
  scheduleStateSave();
});

speedButtons.forEach((button) => {
  button.addEventListener("click", () => {
    playbackSpeed = Number(button.dataset.speed);
    applyPlaybackSpeed();
    updateSpeedButtons();
    scheduleStateSave();
  });
});

voiceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedVoice = button.dataset.voice || DEFAULT_VOICE;
    updateVoiceButtons();
    if (article) switchArticleVoice(selectedVoice);
  });
});

dictationInput.addEventListener("input", () => {
  if (!article || mode !== "sentence") return;
  articleState.dictation = articleState.dictation || {};
  articleState.dictation[dictationKey()] = dictationInput.value;
  dictationStatus.textContent = `${countEnglishWords(dictationInput.value)} 个词`;
  scheduleStateSave(300);
});

clearDictationButton.addEventListener("click", () => {
  if (!article || mode !== "sentence") return;
  articleState.dictation = articleState.dictation || {};
  articleState.dictation[dictationKey()] = "";
  dictationInput.value = "";
  renderDictationPractice();
  scheduleStateSave(50);
});

saveSentenceButton.addEventListener("click", () => {
  if (!article) return;
  openNoteDialog({
    text: article.sentences[currentIndex].text,
    sentence_index: currentIndex,
    context: article.sentences[currentIndex].text
  });
});
confirmNoteButton.addEventListener("click", (event) => {
  event.preventDefault();
  if (noteDraft) addNote(noteDraft);
  noteDraft = null;
  noteDialog.close();
});
confirmPasteButton.addEventListener("click", (event) => {
  event.preventDefault();
  const text = pasteTextInput.value.trim();
  if (!text) {
    window.alert("请先粘贴英文内容");
    return;
  }
  importPastedText(text);
});

document.addEventListener("mouseup", captureSelection);
document.addEventListener("mousedown", (event) => {
  if (!event.target.closest("#selectionToolbar")) selectionToolbar.hidden = true;
});
playSelectionButton.addEventListener("click", () => {
  if (selectionData) playText(selectionData.text);
  selectionToolbar.hidden = true;
});
saveSelectionButton.addEventListener("click", () => {
  if (selectionData) openNoteDialog(selectionData);
  selectionToolbar.hidden = true;
});

audio.addEventListener("play", () => {
  applyPlaybackSpeed();
  playButton.textContent = "Ⅱ";
  playButton.setAttribute("aria-label", "暂停");
});
audio.addEventListener("pause", () => {
  playButton.textContent = "▶";
  playButton.setAttribute("aria-label", "播放");
  if (sourceKind === "article") scheduleStateSave();
});
audio.addEventListener("loadedmetadata", () => {
  applyPlaybackSpeed();
  if (pendingSeek) {
    audio.currentTime = Math.min(pendingSeek, Math.max(0, audio.duration - 0.05));
    pendingSeek = 0;
  }
  duration.textContent = formatTime(audio.duration);
  if (sourceKind === "article") scheduleStateSave(200);
});
audio.addEventListener("timeupdate", () => {
  currentTime.textContent = formatTime(audio.currentTime);
  if (!progress.matches(":active")) {
    progress.value = audio.duration
      ? Math.round((audio.currentTime / audio.duration) * 1000)
      : 0;
  }
  if (sourceKind === "article" && Date.now() - lastProgressSave > 4000) {
    lastProgressSave = Date.now();
    scheduleStateSave(200);
  }
});
returnArticleButton.addEventListener("click", restoreArticleAudio);

function seekFromProgress() {
  if (audio.duration) {
    audio.currentTime = (Number(progress.value) / 1000) * audio.duration;
    currentTime.textContent = formatTime(audio.currentTime);
    scheduleStateSave();
  }
}
progress.addEventListener("input", seekFromProgress);
progress.addEventListener("change", seekFromProgress);

window.addEventListener("beforeunload", () => {
  if (!article) return;
  if (IS_STATIC_DEMO) {
    writeDemoState(article.id, statePayload());
    return;
  }
  navigator.sendBeacon(
    `/api/articles/${article.id}/state`,
    new Blob([JSON.stringify(statePayload())], { type: "application/json" })
  );
});

document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !["BUTTON", "INPUT", "TEXTAREA"].includes(event.target.tagName)) {
    event.preventDefault();
    playButton.click();
  }
  if (mode === "sentence" && event.code === "ArrowRight") nextButton.click();
  if (mode === "sentence" && event.code === "ArrowLeft") previousButton.click();
});

async function bootstrap() {
  showEmptyState();
  if (!IS_STATIC_DEMO) {
    await refreshLibrary();
    return;
  }

  document.body.classList.add("static-demo");
  importButton.hidden = true;
  pasteButton.hidden = true;
  playSelectionButton.hidden = true;

  const banner = document.createElement("aside");
  banner.className = "demo-banner";
  banner.textContent = "在线 Demo：资料库内含 4 篇原创文章，可切换美式男声/女声，并在浏览器保存听写、笔记和进度。导入新文章需在电脑上运行完整版。";
  document.body.prepend(banner);

  try {
    await loadArticle(await api("/api/sample"), { rememberView: false });
  } catch (error) {
    window.alert(error.message);
  }
}

bootstrap();
