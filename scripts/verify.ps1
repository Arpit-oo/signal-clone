param([switch]$BrowserTests)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:UV_CACHE_DIR = Join-Path $projectRoot '.cache\uv'
$env:npm_config_cache = Join-Path $projectRoot '.cache\npm'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.cache\playwright'
Push-Location (Join-Path $projectRoot 'backend')
try {
    uv run --locked ruff check .
    if ($LASTEXITCODE -ne 0) { throw 'Backend lint failed.' }
    uv run --locked pytest -q
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
} finally { Pop-Location }
Push-Location (Join-Path $projectRoot 'frontend')
try {
    npm.cmd run lint
    if ($LASTEXITCODE -ne 0) { throw 'Frontend lint failed.' }
    npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Type checking failed.' }
    npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    if ($BrowserTests) {
        npm.cmd run test:e2e
        if ($LASTEXITCODE -ne 0) { throw 'Browser tests failed.' }
    }
} finally { Pop-Location }
Write-Host 'All requested checks passed.'
