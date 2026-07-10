# English Listening Player / 英语听力播放器

A local-first English listening practice web app. Import English text or a `.docx` document, generate natural speech, practise sentence by sentence, take notes, and save listening progress.

一个在本地运行的英语听力练习网页。你可以导入英文文本或 `.docx` 文档，生成自然语音，逐句练习，记录笔记和学习进度。

## Online demo / 在线演示

Open the [GitHub Pages demo](https://lis-li.github.io/english-listening-player/) to try the bundled original sample directly in your browser.

打开 [GitHub Pages 在线 Demo](https://lis-li.github.io/english-listening-player/) 即可试听原创示例、逐句练习和保存浏览器本地进度。GitHub Pages 不运行 Python 后端，因此导入 Word、粘贴新文本和生成新语音需使用下方的本地完整版。

## Features / 功能

- Import pasted English text or Word `.docx` files.
- Generate full-article and sentence-level audio with Microsoft Edge online TTS.
- Switch voices, change playback speed, practise dictation, and replay selections.
- Save articles, notes, dictation, and progress locally in the `generated/` directory.
- Includes an original English sample that is safe to redistribute.

## Requirements / 运行要求

- Python 3.10 or newer
- Internet access when generating speech
- A modern browser

## Quick start / 快速开始

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

首次运行时，先执行 `python server.py --build-sample` 生成原创示例的语音。语音生成需要联网。

## Project files / 项目文件

| Path | Purpose | Commit to Git? |
| --- | --- | --- |
| `index.html` | Web page structure | Yes |
| `styles.css` | Page styling | Yes |
| `app.js` | Browser interactions and API calls | Yes |
| `server.py` | Local HTTP API, document parsing, TTS, and storage | Yes |
| `requirements.txt` | Reproducible Python dependency list | Yes |
| `sample/` | Original redistributable sample text | Yes |
| `generated/original-sample/` | Bundled sample manifest and audio | Yes |
| `generated/` (other content) | Imported documents, generated audio, notes, and progress | **No** |
| `*.log`, `__pycache__/`, `.venv/` | Runtime output, caches, and local environment | **No** |

## Privacy / 隐私

Imported documents, notes, dictation text, and generated audio are stored under `generated/`. They are intentionally ignored by Git, except for the bundled original sample. Before sharing a fork, always review `git status` and never commit `.env` files, API keys, private documents, or personal learning data.

Text is sent to Microsoft Edge's online text-to-speech service when audio is generated. Do not submit confidential content unless that usage is acceptable to you.

## Limitations / 限制

This project includes a Python backend and cannot run as a complete application on GitHub Pages alone. The GitHub repository distributes the source code; users run it on their own computer. A public hosted version would require a separate backend hosting service and additional security work.

## License

Code is released under the [MIT License](LICENSE). The bundled sample text was written specifically for this project and is distributed under the same license.
