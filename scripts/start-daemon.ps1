$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$DaemonJs = Join-Path $RepoRoot 'daemon\theme_daemon.js'
$PidFile = Join-Path $RepoRoot 'daemon.pid'
$NodeCmd = (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue).Source
if (-not $NodeCmd) {
    $NodeCmd = Join-Path $env:ProgramFiles 'nodejs\node.exe'
}
if (-not (Test-Path -LiteralPath $NodeCmd -PathType Leaf)) {
    throw 'Node.js not found. Install Node.js >= 22.'
}

if (Test-Path $PidFile) {
    $OldPidText = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $OldPid = 0
    if ([int]::TryParse(($OldPidText -as [string]), [ref]$OldPid) -and $OldPid -gt 0) {
        $ExistingProc = Get-Process -Id $OldPid -ErrorAction SilentlyContinue
        if ($ExistingProc -and $ExistingProc.ProcessName -eq 'node') {
            return
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

Start-Process -FilePath $NodeCmd -ArgumentList "`"$DaemonJs`"" -WorkingDirectory $RepoRoot -WindowStyle Hidden -ErrorAction Stop
