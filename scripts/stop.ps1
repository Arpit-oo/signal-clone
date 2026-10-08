$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $projectRoot '.runtime\services.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Host 'No project services recorded.'; return }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($state.root -ne $projectRoot) { throw 'Service file belongs to a different project.' }

function Stop-ProjectProcessTree([int]$ProcessId) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId"
    foreach ($child in $children) { Stop-ProjectProcessTree -ProcessId $child.ProcessId }
    Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
}
foreach ($entry in $state.services) {
    $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    if ($process.StartTime.ToUniversalTime().ToString('o') -ne $entry.started) { throw 'Recorded process ID was reused; refusing to stop it.' }
    $details = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.pid)"
    if ($details.ExecutablePath -notlike "$projectRoot\*" -and $details.CommandLine -notlike "*$projectRoot*") {
        throw 'Recorded process does not belong to this project; refusing to stop it.'
    }
    Stop-ProjectProcessTree -ProcessId $entry.pid
}
Remove-Item -LiteralPath $statePath
Write-Host 'Project services stopped.'
