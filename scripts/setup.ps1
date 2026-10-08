param([switch]$BrowserTests)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:UV_CACHE_DIR = Join-Path $projectRoot '.cache\uv'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $projectRoot '.cache\python'
$env:npm_config_cache = Join-Path $projectRoot '.cache\npm'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.cache\playwright'
foreach ($tool in @('uv', 'node', 'npm.cmd')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Install $tool before running setup." }
}

Push-Location (Join-Path $projectRoot 'backend')
try {
    uv sync --locked
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
    if (-not (Test-Path -LiteralPath '.env')) {
        $secretBytes = New-Object byte[] 48
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($secretBytes) } finally { $random.Dispose() }
        $secret = [Convert]::ToBase64String($secretBytes)
        @("JWT_SECRET=$secret", 'SEED_ON_STARTUP=true', 'AUTO_MIGRATE_ON_STARTUP=true') | Set-Content -LiteralPath '.env' -Encoding ascii
    }
} finally { Pop-Location }

Push-Location (Join-Path $projectRoot 'frontend')
try {
    npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    if (-not (Test-Path -LiteralPath '.env.local')) { Copy-Item -LiteralPath '.env.example' -Destination '.env.local' }
    if ($BrowserTests) {
        npx.cmd playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw 'Browser installation failed.' }
    }
} finally { Pop-Location }
Write-Host 'Setup complete. Run .\scripts\start.ps1 to launch Signal.'
