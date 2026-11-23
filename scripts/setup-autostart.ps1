<#
.SYNOPSIS
    Configures AntigravityTheme auto-start integration on Windows.
.DESCRIPTION
    1. Updates Windows Startup (shell:startup) to silently launch Theme Daemon & System Tray on Windows boot.
    2. Updates Antigravity desktop & start menu shortcuts to launch Antigravity seamlessly alongside Daemon & System Tray.
    3. Preserves original Antigravity icon and creates backups for easy restoration.
#>

[CmdletBinding()]
param(
    [switch]$Restore
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$SilentStartAllVbs = Join-Path $RepoRoot "silent-start-all.vbs"
$LaunchAntigravityVbs = Join-Path $RepoRoot "launch-antigravity.vbs"

$AntigravityExe = Join-Path $env:LOCALAPPDATA "Programs\antigravity\Antigravity.exe"
if (-not (Test-Path $AntigravityExe)) {
    $AntigravityExe = (Get-Command Antigravity.exe -ErrorAction SilentlyContinue).Source
}

$WshShell = New-Object -ComObject WScript.Shell
$StartupDir = [Environment]::GetFolderPath('Startup')
$DesktopDir = [Environment]::GetFolderPath('DesktopDirectory')
$ProgramsDir = [Environment]::GetFolderPath('Programs')
$TaskbarDir = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'

if ($Restore) {
    Write-Host "[setup-autostart] Restoring original shortcuts..."
    
    # Restore Desktop
    $DesktopLnk = Join-Path $DesktopDir "Antigravity.lnk"
    $DesktopBak = Join-Path $DesktopDir "Antigravity.lnk.bak"
    if (Test-Path $DesktopBak) {
        Copy-Item -Path $DesktopBak -Destination $DesktopLnk -Force
        Remove-Item -Path $DesktopBak -Force
        Write-Host "  -> Restored Desktop shortcut from backup."
    }
    
    # Restore Start Menu
    $StartMenuLnk = Join-Path $ProgramsDir "Antigravity.lnk"
    $StartMenuBak = Join-Path $ProgramsDir "Antigravity.lnk.bak"
    if (Test-Path $StartMenuBak) {
        Copy-Item -Path $StartMenuBak -Destination $StartMenuLnk -Force
        Remove-Item -Path $StartMenuBak -Force
        Write-Host "  -> Restored Start Menu shortcut from backup."
    }
    
    # Restore Startup to daemon only
    $StartupLnk = Join-Path $StartupDir "AntigravityCustomTheme.lnk"
    if (Test-Path $StartupLnk) {
        $Sc = $WshShell.CreateShortcut($StartupLnk)
        $DaemonVbs = Join-Path $RepoRoot "silent-start.vbs"
        $Sc.TargetPath = "wscript.exe"
        $Sc.Arguments = "`"$DaemonVbs`""
        $Sc.WorkingDirectory = $RepoRoot
        $Sc.Save()
        Write-Host "  -> Reverted Startup shortcut."
    }
    
    Write-Host "[setup-autostart] Restoration complete."
    exit 0
}

Write-Host "=========================================================="
Write-Host " AntigravityTheme - Auto-Launch Configuration"
Write-Host "=========================================================="

# 1. Configure Windows Startup to launch both Daemon & System Tray
$StartupLnk = Join-Path $StartupDir "AntigravityCustomTheme.lnk"
$ScStartup = $WshShell.CreateShortcut($StartupLnk)
$ScStartup.TargetPath = "wscript.exe"
$ScStartup.Arguments = "`"$SilentStartAllVbs`""
$ScStartup.WorkingDirectory = $RepoRoot
$ScStartup.WindowStyle = 7 # Minimized
$ScStartup.Description = "Antigravity Theme Daemon & System Tray"
$ScStartup.Save()
Write-Host "[1/2] Windows Startup shortcut configured:"
Write-Host "      Location: $StartupLnk"
Write-Host "      Target:   wscript.exe `"$SilentStartAllVbs`""

# 2. Hook Antigravity Shortcuts (Desktop & Start Menu)
$TargetShortcuts = @(
    (Join-Path $DesktopDir "Antigravity.lnk"),
    (Join-Path $ProgramsDir "Antigravity.lnk")
)
if (Test-Path $TaskbarDir) {
    $TargetShortcuts += (Join-Path $TaskbarDir "Antigravity.lnk")
}

Write-Host "`n[2/2] Hooking Antigravity Application Shortcuts..."
foreach ($LnkPath in $TargetShortcuts) {
    if (-not (Test-Path $LnkPath)) {
        continue
    }
    
    # Create backup if not already present
    $BakPath = "$LnkPath.bak"
    if (-not (Test-Path $BakPath)) {
        Copy-Item -Path $LnkPath -Destination $BakPath -Force
        Write-Host "      Backup created: $BakPath"
    }
    
    $Sc = $WshShell.CreateShortcut($LnkPath)
    $OriginalIcon = $Sc.IconLocation
    if (-not $OriginalIcon -or $OriginalIcon -notmatch "Antigravity\.exe") {
        if ($AntigravityExe -and (Test-Path $AntigravityExe)) {
            $OriginalIcon = "$AntigravityExe,0"
        }
    }
    
    $Sc.TargetPath = "wscript.exe"
    $Sc.Arguments = "`"$LaunchAntigravityVbs`""
    $Sc.WorkingDirectory = $RepoRoot
    if ($OriginalIcon) {
        $Sc.IconLocation = $OriginalIcon
    }
    $Sc.Description = "Open Antigravity (with Custom Theme & System Tray)"
    $Sc.Save()
    Write-Host "      Updated: $LnkPath -> launch-antigravity.vbs (Icon: $OriginalIcon)"
}

Write-Host "`n[PASS] Auto-launch configuration completed successfully!"
Write-Host "From now on, opening Antigravity will automatically start the Theme Daemon & System Tray."
