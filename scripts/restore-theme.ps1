<#
.SYNOPSIS
    Restores the saved theme after an Antigravity update without patching app files.
.DESCRIPTION
    Starts a closed Antigravity with loopback debugging and confirms renderer readiness.
    An already running instance without debugging must be quit by the user first.
#>
[CmdletBinding()]
param([switch]$OpenDashboard)

$ErrorActionPreference = 'Stop'
$AppExe = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'
if (-not (Test-Path -LiteralPath $AppExe -PathType Leaf)) {
    throw "Antigravity.exe was not found at $AppExe. Install Antigravity before restoring the theme."
}

$processes = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'Antigravity.exe' OR Name = 'Antigravity-x64.exe'" -ErrorAction Stop)
if ($processes | Where-Object { $_.Name -ieq 'Antigravity-x64.exe' }) {
    throw 'Wait for the Antigravity installer to finish before restoring the theme.'
}

$mainApps = @($processes | Where-Object {
    $_.Name -ieq 'Antigravity.exe' -and $_.ExecutablePath -and
    [IO.Path]::GetFullPath($_.ExecutablePath) -ieq [IO.Path]::GetFullPath($AppExe) -and
    $_.CommandLine -notmatch '(?i)(?:^|\s)--type(?:=|\s)' -and
    $_.CommandLine -notmatch '(?i)sidecar_sdk[/\\]'
})

foreach ($app in $mainApps) {
    $portFlag = [regex]::Match([string]$app.CommandLine, '(?i)(?:^|\s)"?--remote-debugging-port(?:=|\s+)(\d+)"?(?=\s|$)')
    $debugPort = -1
    if (-not $portFlag.Success -or -not [int]::TryParse($portFlag.Groups[1].Value, [ref]$debugPort) -or
        $debugPort -lt 0 -or $debugPort -gt 65535) {
        throw 'Quit Antigravity completely using its Quit/Exit command, then run scripts\restore-theme.ps1 again. The running instance has no usable debug port; it will not be forcibly closed.'
    }
    $addressFlag = [regex]::Match([string]$app.CommandLine, '(?i)(?:^|\s)"?--remote-debugging-address(?:=|\s+)([^\s"]+)"?(?=\s|$)')
    if ($app.CommandLine -match '(?i)--remote-debugging-address' -and
        (-not $addressFlag.Success -or $addressFlag.Groups[1].Value -notin @('127.0.0.1', 'localhost', '::1', '[::1]'))) {
        throw 'The running Antigravity debug address must be loopback. Quit Antigravity and run scripts\restore-theme.ps1 again.'
    }
}

if ($mainApps.Count -eq 0) {
    Start-Process -FilePath $AppExe -ArgumentList @('--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0') -WorkingDirectory (Split-Path -Parent $AppExe) -ErrorAction Stop
}

& (Join-Path $PSScriptRoot 'start-all.ps1') -WaitForTheme -OpenDashboard:$OpenDashboard
