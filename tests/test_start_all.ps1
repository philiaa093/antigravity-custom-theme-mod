$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('agy-launcher-' + [guid]::NewGuid().ToString('N'))
$scripts = Join-Path $root 'scripts'
$launcher = Join-Path $scripts 'start-all.ps1'
$probe = @{ checks = 0; uri = $null; opened = @() }

function Invoke-RestMethod {
    param($Uri, [switch]$UseBasicParsing, $TimeoutSec, $MaximumRedirection)
    $probe.uri = $Uri
    $probe.checks++
    if ($probe.checks -eq 1) { throw 'Connection refused' }
    $replyId = if ($probe.checks -eq 2) { 4243 } else { 4242 }
    @{ running = $true; pid = $replyId; port = 47991 }
}

function Start-Process {
    param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle)
    if ($FilePath -eq 'powershell.exe' -and $ArgumentList -match ' -STA ') { return }
    $probe.opened += "$FilePath after $($probe.checks) checks"
}

New-Item -Path $scripts -ItemType Directory | Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\scripts\start-all.ps1') -Destination $launcher
    @'
$root = Split-Path -Parent $PSScriptRoot
Set-Content -LiteralPath (Join-Path $root 'daemon.pid') -Value '4242'
Set-Content -LiteralPath (Join-Path $root 'daemon.webport') -Value '47991'
'@ | Set-Content -LiteralPath (Join-Path $scripts 'start-daemon.ps1') -Encoding Ascii

    & $launcher
    if ($probe.checks -ne 0 -or $probe.opened.Count -ne 0) { throw 'Silent startup contacted or opened the dashboard.' }

    & $launcher -OpenDashboard
    if ($probe.uri -ne 'http://127.0.0.1:47991/api/status' -or $probe.opened.Count -ne 1 -or
        $probe.opened[0] -ne 'http://127.0.0.1:47991 after 3 checks') {
        throw 'Expected the browser to open the fallback port only after the correct daemon responded.'
    }
    Write-Output 'Launcher readiness check passed.'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
