<#
.SYNOPSIS
    AntigravityTheme Unified Launcher (Daemon + System Tray).
.DESCRIPTION
    Launches both AntigravityTheme background daemon and the Windows System Tray host.
    With -OpenDashboard, opens the browser after the daemon answers its status endpoint.
#>

[CmdletBinding()]
param([switch]$OpenDashboard)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$TrayScript = Join-Path $PSScriptRoot 'tray.ps1'

& (Join-Path $PSScriptRoot 'start-daemon.ps1')
Start-Process powershell.exe -ArgumentList "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$TrayScript`"" -WorkingDirectory $RepoRoot -WindowStyle Hidden

if (-not $OpenDashboard) {
    return
}

$portFile = Join-Path $RepoRoot 'daemon.webport'
$pidFile = Join-Path $RepoRoot 'daemon.pid'
$timer = [Diagnostics.Stopwatch]::StartNew()
do {
    $port = 0
    $daemonId = 0
    $portText = Get-Content -LiteralPath $portFile -Raw -ErrorAction SilentlyContinue
    $pidText = Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue
    if ([int]::TryParse($portText, [ref]$port) -and $port -gt 0 -and $port -le 65535 -and
        [int]::TryParse($pidText, [ref]$daemonId) -and $daemonId -gt 0) {
        $url = "http://127.0.0.1:$port"
        $status = $null
        try {
            $status = Invoke-RestMethod -Uri "$url/api/status" -UseBasicParsing -TimeoutSec 1 -MaximumRedirection 0
        } catch {
            # The port file can outlive a stopped daemon.
        }
        if ($status.running -eq $true -and $status.pid -eq $daemonId -and $status.port -eq $port) {
            Start-Process $url
            return
        }
    }
    Start-Sleep -Milliseconds 200
} while ($timer.Elapsed.TotalSeconds -lt 10)

throw "Theme Dashboard did not become ready. Check $RepoRoot\daemon.log."
