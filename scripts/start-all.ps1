<#
.SYNOPSIS
    AntigravityTheme Unified Launcher (Daemon + System Tray).
.DESCRIPTION
    Launches both AntigravityTheme background daemon and the Windows System Tray host.
    With -OpenDashboard, opens the browser after the daemon answers its status endpoint.
    With -WaitForTheme, also waits for a renderer to confirm the saved theme.
#>

[CmdletBinding()]
param([switch]$OpenDashboard, [switch]$WaitForTheme)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$TrayScript = Join-Path $PSScriptRoot 'tray.ps1'

& (Join-Path $PSScriptRoot 'start-daemon.ps1')
Start-Process powershell.exe -ArgumentList "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$TrayScript`"" -WorkingDirectory $RepoRoot -WindowStyle Hidden

if (-not $OpenDashboard -and -not $WaitForTheme) {
    return
}

$portFile = Join-Path $RepoRoot 'daemon.webport'
$pidFile = Join-Path $RepoRoot 'daemon.pid'
$expectedTheme = ''
$configFile = Join-Path $RepoRoot 'theme_config.json'
if ($WaitForTheme -and (Test-Path -LiteralPath $configFile)) {
    $savedConfig = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($savedConfig.themeName -is [string]) { $expectedTheme = $savedConfig.themeName }
}
$timeoutSeconds = if ($WaitForTheme) { 30 } else { 10 }
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
            if (-not $WaitForTheme -or ($status.sessionsCount -gt 0 -and $status.appliedTheme -and
                (-not $expectedTheme -or $status.appliedTheme -ceq $expectedTheme))) {
                if ($OpenDashboard) { Start-Process $url }
                if ($WaitForTheme) { Write-Output "Theme applied: $($status.appliedTheme)" }
                return
            }
        }
    }
    Start-Sleep -Milliseconds 200
} while ($timer.Elapsed.TotalSeconds -lt $timeoutSeconds)

if ($WaitForTheme) {
    throw "Theme was not confirmed by Antigravity. Quit Antigravity completely, then run scripts\restore-theme.ps1. Check $RepoRoot\daemon.log."
}
throw "Theme Dashboard did not become ready. Check $RepoRoot\daemon.log."
