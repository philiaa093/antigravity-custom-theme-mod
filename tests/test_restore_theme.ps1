$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('agy-recovery-' + [guid]::NewGuid().ToString('N'))
$scripts = Join-Path $root 'scripts'
$oldLocalAppData = $env:LOCALAPPDATA
$probe = @{ processes = @(); launches = @(); daemonCalls = 0; waitForTheme = $false; dashboard = $false }

function Get-CimInstance {
    param($ClassName, $Filter, $ErrorAction)
    return $probe.processes
}

function Start-Process {
    param($FilePath, $ArgumentList, $WorkingDirectory, $ErrorAction)
    if ($FilePath -ine $script:appExe) { throw "Unexpected launched executable: $FilePath" }
    $probe.launches += @{ path = $FilePath; arguments = @($ArgumentList) }
}

function Stop-Process { throw 'Recovery must never terminate a running process.' }

function Assert-Refused {
    param($Launcher, $Expected)
    $before = $probe.daemonCalls
    $caught = $false
    try { & $Launcher }
    catch {
        if ($_.Exception.Message -notlike "*$Expected*") { throw }
        $caught = $true
    }
    if (-not $caught -or $probe.launches.Count -ne 0 -or $probe.daemonCalls -ne $before) {
        throw 'Unsafe recovery was not refused before any launch or daemon change.'
    }
}

New-Item -Path $scripts -ItemType Directory | Out-Null
try {
    $source = Join-Path $PSScriptRoot '..\scripts\restore-theme.ps1'
    if (-not (Test-Path -LiteralPath $source)) { throw 'Recovery launcher is not implemented.' }
    $launcher = Join-Path $scripts 'restore-theme.ps1'
    Copy-Item -LiteralPath $source -Destination $launcher
    @'
param([switch]$OpenDashboard, [switch]$WaitForTheme)
$probe.daemonCalls++
$probe.waitForTheme = [bool]$WaitForTheme
$probe.dashboard = [bool]$OpenDashboard
'@ | Set-Content -LiteralPath (Join-Path $scripts 'start-all.ps1') -Encoding Ascii
    $env:LOCALAPPDATA = Join-Path $root 'profile'
    $script:appExe = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'
    Assert-Refused $launcher 'Antigravity.exe was not found'
    New-Item -Path (Split-Path -Parent $script:appExe) -ItemType Directory -Force | Out-Null
    New-Item -Path $script:appExe -ItemType File | Out-Null

    $probe.processes = @(
        [pscustomobject]@{ Name = 'Antigravity.exe'; ExecutablePath = $script:appExe; ProcessId = 100;
            CommandLine = 'Antigravity.exe --import=file:///sidecar_sdk/register_loader.js main.mjs' },
        [pscustomobject]@{ Name = 'Antigravity.exe'; ExecutablePath = $script:appExe; ProcessId = 101;
            CommandLine = 'Antigravity.exe --type=renderer' }
    )
    & $launcher
    if ($probe.launches.Count -ne 1 -or -not $probe.waitForTheme -or $probe.dashboard -or
        $probe.launches[0].arguments -notcontains '--remote-debugging-port=0' -or
        $probe.launches[0].arguments -notcontains '--remote-debugging-address=127.0.0.1') {
        throw 'Recovery did not start the installed app with loopback debugging and renderer confirmation.'
    }

    $probe.launches = @()
    $probe.processes = @([pscustomobject]@{ Name = 'Antigravity.exe'; ExecutablePath = $script:appExe;
        ProcessId = 102; CommandLine = 'Antigravity.exe --updated' })
    Assert-Refused $launcher 'Quit Antigravity'

    $probe.processes[0].CommandLine = 'Antigravity.exe --remote-debugging-port=0 --remote-debugging-address=0.0.0.0'
    Assert-Refused $launcher 'loopback'

    $probe.processes[0].CommandLine = 'Antigravity.exe --remote-debugging-port=65536'
    Assert-Refused $launcher 'Quit Antigravity'

    $probe.processes[0].CommandLine = 'Antigravity.exe --remote-debugging-port=0'
    $before = $probe.daemonCalls
    & $launcher -OpenDashboard
    if ($probe.launches.Count -ne 0 -or $probe.daemonCalls -ne $before + 1 -or
        -not $probe.waitForTheme -or -not $probe.dashboard) {
        throw 'Recovery did not reuse the eligible app and confirm its existing theme.'
    }

    $probe.processes = @([pscustomobject]@{ Name = 'Antigravity-x64.exe'; ExecutablePath = (Join-Path $env:LOCALAPPDATA 'antigravity-updater\pending\Antigravity-x64.exe');
        ProcessId = 103; CommandLine = 'Antigravity-x64.exe --updated' })
    Assert-Refused $launcher 'installer'
    Write-Output 'Recovery launcher checks passed: sidecars, startup flags, safe reuse, installer guard, and no forced shutdown.'
} finally {
    $env:LOCALAPPDATA = $oldLocalAppData
    Remove-Item -LiteralPath $root -Recurse -Force
}
