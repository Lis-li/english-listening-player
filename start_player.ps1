$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://127.0.0.1:8765"
$venvPython = Join-Path $root ".venv\Scripts\python.exe"

Set-Location -LiteralPath $root

if ($env:ENGLISH_PLAYER_PYTHON -and (Test-Path -LiteralPath $env:ENGLISH_PLAYER_PYTHON)) {
    $python = $env:ENGLISH_PLAYER_PYTHON
} elseif (Test-Path -LiteralPath $venvPython) {
    $python = $venvPython
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        throw "Python was not found. Install Python 3.10+ or create .venv first. See README.md."
    }
    $python = $pythonCommand.Source
}

$listener = netstat -ano | Select-String "127.0.0.1:8765\s+.*LISTENING"
if (-not $listener) {
    $process = Start-Process -FilePath $python `
        -ArgumentList @("server.py", "--port", "8765") `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $root "server.stdout.log") `
        -RedirectStandardError (Join-Path $root "server.stderr.log") `
        -PassThru

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 300
        if ($process.HasExited) {
            throw "The server stopped during startup. Check server.stderr.log."
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 1
            if ($response.StatusCode -eq 200) { break }
        } catch {
            if ($attempt -eq 29) {
                throw "The server did not start in time. Check server.stderr.log."
            }
        }
    }
}

Start-Process $url
