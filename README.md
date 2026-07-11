# English Listening Player

[**中文说明 / Chinese documentation**](README.zh-CN.md)

> ## 🎧 [Open the Live Online Demo](https://lis-li.github.io/english-listening-player/)
>
> Try four original listening articles with American female and male voices. No installation is required.

A local-first English listening practice web app. Import English text or a `.docx` document, generate natural speech, practise sentence by sentence, take notes, and save listening progress.

## Online demo

The GitHub Pages edition is a safe, server-free showcase that works directly in a modern browser.

- Four original English listening articles
- American female and male voice switching
- Full-article and sentence-by-sentence playback
- Playback speed controls and dictation practice
- Browser-local notes, dictation, and learning progress

The hosted demo does not upload documents or generate new speech. Those features require the local Python edition below.

## Local edition features

- Import pasted English text or Word `.docx` files.
- Generate full-article and sentence-level audio with Microsoft Edge online TTS.
- Switch voices, change playback speed, practise dictation, and replay selections.
- Save articles, notes, dictation, and progress locally in the `generated/` directory.

## Requirements

- Python 3.10 or newer
- Internet access when generating speech
- A modern browser

## Quick start

### Windows

Open PowerShell in this folder and run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python server.py --build-sample
.\start_player.ps1
```

You can also double-click `Open English Player.bat` after installing the dependencies.

### macOS or Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python server.py --build-sample
python server.py
```

Then open [http://127.0.0.1:8765](http://127.0.0.1:8765).

## Project files

| Path | Purpose | Commit to Git? |
| --- | --- | --- |
| `index.html` | Web page structure | Yes |
| `styles.css` | Page styling | Yes |
| `app.js` | Browser interactions, API calls, and static demo adapter | Yes |
| `server.py` | Local HTTP API, document parsing, TTS, and storage | Yes |
| `requirements.txt` | Python dependency list | Yes |
| `sample/` | Original redistributable source texts | Yes |
| `demo-content/` | Public demo catalog and pre-generated voice assets | Yes |
| `generated/original-sample/` | Bundled local sample | Yes |
| `generated/` (other content) | Private imports, generated audio, notes, and progress | **No** |
| `*.log`, `__pycache__/`, `.venv/` | Runtime output, caches, and local environment | **No** |

## Privacy

Imported documents, notes, dictation text, and generated audio are stored under `generated/`. They are ignored by Git except for the bundled local sample. Before sharing a fork, always review `git status` and never commit `.env` files, API keys, private documents, or personal learning data.

Text is sent to Microsoft Edge's online text-to-speech service when audio is generated. Do not submit confidential content unless that usage is acceptable to you.

The online demo stores learning state only in the visitor's browser and does not send it to this repository.

## License

Code and bundled original demo texts are released under the [MIT License](LICENSE).
