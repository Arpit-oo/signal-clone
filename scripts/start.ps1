param([switch]$Production, [ValidateRange(1024, 65535)][int]$FrontendPort = 3000)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.runtime'
$statePath = Join-Path $runtimeDir 'services.json'
$pythonPath = Join-Path $projectRoot 'backend\.venv\Scripts\python.exe'
$nextPath = Join-Path $projectRoot 'frontend\node_modules\next\dist\bin\next'
$env:UV_CACHE_DIR = Join-Path $projectRoot '.cache\uv'
$env:npm_config_cache = Join-Path $projectRoot '.cache\npm'
if (-not (Test-Path -LiteralPath $pythonPath) -or -not (Test-Path -LiteralPath $nextPath) -or -not (Test-Path -LiteralPath (Join-Path $projectRoot 'backend\.env')) -or -not (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend\.env.local'))) {
    & (Join-Path $PSScriptRoot 'setup.ps1')
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required.' }

if (Test-Path -LiteralPath $statePath) {
    $previous = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    foreach ($entry in $previous.services) {
        $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
        if ($process -and $process.StartTime.ToUniversalTime().ToString('o') -eq $entry.started) {
            throw 'Project services are already running. Run scripts\stop.ps1 before restarting.'
        }
    }
}
foreach ($port in @($FrontendPort, 8000)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Stop its owner before launching the project."
    }
}
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
if ($Production) {
    Push-Location (Join-Path $projectRoot 'frontend')
    try {
        npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    } finally { Pop-Location }
}

$startedServices = @()
try {
    $api = Start-Process -FilePath $pythonPath -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000', '--no-access-log') -WorkingDirectory (Join-Path $projectRoot 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'backend.log') -RedirectStandardError (Join-Path $runtimeDir 'backend.err.log')
    $startedServices += $api
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $api.Refresh()
        if ($api.HasExited) { throw 'Backend exited. Check .runtime\backend.err.log.' }
        try { $ready = (Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2).status -eq 'ok' } catch { }
        if ($ready) { break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Backend did not become healthy. Check .runtime\backend.err.log.' }
    $mode = if ($Production) { 'start' } else { 'dev' }
    $nodePath = (Get-Command node).Source
    $nextArguments = '"{0}" {1} --hostname 127.0.0.1 --port {2}' -f $nextPath, $mode, $FrontendPort
    $web = Start-Process -FilePath $nodePath -ArgumentList $nextArguments -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'frontend.log') -RedirectStandardError (Join-Path $runtimeDir 'frontend.err.log')
    $startedServices += $web
    $services = @($startedServices | ForEach-Object { @{ pid = $_.Id; started = $_.StartTime.ToUniversalTime().ToString('o') } })
    @{ root = $projectRoot; mode = $mode; frontendPort = $FrontendPort; services = $services } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding utf8
    $ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        $web.Refresh()
        if ($web.HasExited) { throw 'Frontend exited. Check .runtime\frontend.err.log.' }
        try { $ready = (Invoke-WebRequest -Uri "http://127.0.0.1:$FrontendPort/login" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { }
        if ($ready) { break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Frontend did not become healthy. Check .runtime\frontend.err.log.' }
    Write-Host "Signal is running at http://127.0.0.1:$FrontendPort"
    Write-Host 'API docs: http://127.0.0.1:8000/docs'
    Write-Host 'Logs: .runtime\     Stop: .\scripts\stop.ps1'
} catch {
    if (Test-Path -LiteralPath $statePath) {
        & (Join-Path $PSScriptRoot 'stop.ps1')
    } else {
        foreach ($service in $startedServices) { Stop-Process -Id $service.Id -ErrorAction SilentlyContinue }
    }
    throw
}
