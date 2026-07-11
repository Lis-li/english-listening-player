# 英语听力播放器

[**English documentation / 英文说明**](README.md)

> ## 🎧 [点击打开在线 Demo](https://lis-li.github.io/english-listening-player/)
>
> 内含 4 篇原创英语听力文章，支持美式女声和男声，无需安装即可体验。

这是一个在本地运行的英语听力练习网页。你可以导入英文文本或 `.docx` 文档，生成自然语音，逐句练习，记录笔记和学习进度。

## 在线 Demo

GitHub Pages 版本是一个可以直接在现代浏览器中运行的安全静态体验版。

- 4 篇原创英语听力文章
- 美式女声和男声切换
- 整篇和逐句播放
- 倍速控制和听写练习
- 笔记、听写和学习进度保存在访客自己的浏览器中

在线版不会上传文档，也不会为新文章生成语音。这些功能需要使用下方的 Python 本地完整版。

## 本地完整版功能

- 导入粘贴的英文文本或 Word `.docx` 文件。
- 使用 Microsoft Edge 在线 TTS 生成整篇和逐句音频。
- 切换发音、调整速度、进行听写和选中内容回放。
- 在本地 `generated/` 目录中保存文章、笔记、听写和进度。

## 运行要求

- Python 3.10 或更高版本
- 生成语音时需要联网
- 现代浏览器

## Windows 快速开始

在项目文件夹中打开 PowerShell，然后执行：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python server.py --build-sample
.\start_player.ps1
```

安装完依赖后，也可以双击 `Open English Player.bat`。

## macOS 或 Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python server.py --build-sample
python server.py
```

然后打开 [http://127.0.0.1:8765](http://127.0.0.1:8765)。

## 项目文件

| 路径 | 用途 | 是否上传 Git |
| --- | --- | --- |
| `index.html` | 网页结构 | 是 |
| `styles.css` | 页面样式 | 是 |
| `app.js` | 浏览器交互、API 调用和静态 Demo 适配 | 是 |
| `server.py` | 本地 HTTP API、文档解析、TTS 和数据存储 | 是 |
| `requirements.txt` | Python 依赖清单 | 是 |
| `sample/` | 可公开的原创示例原文 | 是 |
| `demo-content/` | 在线资料库与预生成男女声 | 是 |
| `generated/` 其他内容 | 私人导入、生成音频、笔记和进度 | **否** |
| `*.log`、`__pycache__/`、`.venv/` | 运行输出、缓存和本地环境 | **否** |

## 隐私

导入的文档、笔记、听写文本和生成音频保存在 `generated/` 目录中。除项目自带示例外，该目录已被 Git 忽略。分享派生仓库前，请检查 `git status`，不要提交 `.env`、API 密钥、私人文档或个人学习数据。

生成语音时，文本会发送至 Microsoft Edge 在线文本转语音服务。如果内容涉密，请不要提交。

在线 Demo 只会把学习状态保存在访客自己的浏览器中，不会上传到仓库。

## 许可证

代码和项目内置原创文章使用 [MIT License](LICENSE)。
