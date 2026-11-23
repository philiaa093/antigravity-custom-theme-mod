<#
.SYNOPSIS
    AntigravityTheme Native Windows System Tray Host.
.DESCRIPTION
    Pure PowerShell 5.1 & .NET WinForms NotifyIcon tray application.
    Provides instant access to Web Dashboard, dynamic theme preset switching,
    daemon restart, and clean lifecycle shutdown with zero zombie processes.
#>

[CmdletBinding()]
param()

# Ensure single-thread apartment for WinForms
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture
[System.Threading.Thread]::CurrentThread.CurrentUICulture = [System.Globalization.CultureInfo]::InvariantCulture

# Load WinForms and Drawing assemblies
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

# -----------------------------------------------------------------------------
# Single-Instance Mutex Guard
# -----------------------------------------------------------------------------
$mutexName = "AntigravityTheme_Tray_Mutex"
$createdNew = $false
try {
    $mutex = New-Object System.Threading.Mutex($true, "Global\$mutexName", [ref]$createdNew)
} catch {
    try {
        $mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
    } catch {
        $createdNew = $true
    }
}

if (-not $createdNew) {
    Write-Host "[AntigravityTheme Tray] Another tray instance is already running. Exiting."
    exit 0
}

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------
function Get-TrayIcon {
    param([string]$Root)

    # 1. Antigravity Application Executable
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\antigravity\Antigravity.exe"
    )
    foreach ($exe in $candidates) {
        if ($exe -and (Test-Path $exe)) {
            try {
                $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
                if ($icon) { return $icon }
            } catch {}
        }
    }

    # 2. Assets / Web assets ico files
    $icoCandidates = @(
        (Join-Path $Root "assets\tray.ico"),
        (Join-Path $Root "assets\icon.ico"),
        (Join-Path $Root "web\assets\tray.ico"),
        (Join-Path $Root "web\assets\icon.ico"),
        (Join-Path $Root "web\favicon.ico")
    )
    foreach ($ico in $icoCandidates) {
        if ($ico -and (Test-Path $ico)) {
            try {
                $icon = New-Object System.Drawing.Icon($ico)
                if ($icon) { return $icon }
            } catch {}
        }
    }

    # 3. Fallback to Windows System Application Icon
    return [System.Drawing.SystemIcons]::Application
}

function Get-DashboardPort {
    param([string]$Root)
    $portFile = Join-Path $Root "daemon.webport"
    if (Test-Path $portFile) {
        try {
            $val = (Get-Content $portFile -ErrorAction SilentlyContinue | Select-Object -First 1)
            if ($val) {
                $val = $val.Trim()
                $p = 0
                if ([int]::TryParse($val, [ref]$p) -and $p -gt 0 -and $p -le 65535) {
                    return $p
                }
            }
        } catch {}
    }
    return 47990
}

function Open-WebDashboard {
    param([string]$Root)
    $port = Get-DashboardPort -Root $Root
    $url = "http://localhost:$port"
    try {
        [System.Diagnostics.Process]::Start($url) | Out-Null
    } catch {
        Start-Process $url
    }
}

function Switch-ThemePreset {
    param(
        [string]$Root,
        [string]$ThemeName,
        [System.Windows.Forms.NotifyIcon]$Tray
    )
    $port = Get-DashboardPort -Root $Root
    $url = "http://localhost:$port/api/presets/activate"
    $body = @{ themeName = $ThemeName } | ConvertTo-Json -Compress

    $activated = $false
    try {
        # Attempt REST API call to active daemon
        $res = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 3 -ErrorAction Stop
        if ($res -and $res.success) {
            $activated = $true
        }
    } catch {
        # Fallback to direct theme_config.json update if web server is unreachable
        try {
            $cfgPath = Join-Path $Root "theme_config.json"
            if (Test-Path $cfgPath) {
                $raw = Get-Content $cfgPath -Raw -Encoding UTF8 -ErrorAction Stop
                $cfg = $raw | ConvertFrom-Json
                $cfg.themeName = $ThemeName
                $cfg.bubbleName = $ThemeName
                $cfg | ConvertTo-Json -Depth 5 | Set-Content $cfgPath -Encoding UTF8
                $activated = $true
            }
        } catch {}
    }

    if ($Tray) {
        $msg = if ($activated) { "Switched to '$ThemeName'" } else { "Failed to switch to '$ThemeName'" }
        $tipType = if ($activated) { [System.Windows.Forms.ToolTipIcon]::Info } else { [System.Windows.Forms.ToolTipIcon]::Warning }
        $Tray.ShowBalloonTip(2000, "Antigravity Theme", $msg, $tipType)
    }
}

function Update-PresetsMenu {
    param(
        [string]$Root,
        [System.Windows.Forms.ToolStripMenuItem]$PresetsItem,
        [System.Windows.Forms.NotifyIcon]$Tray
    )
    $PresetsItem.DropDownItems.Clear()

    $themesPath = Join-Path $Root "themes\themes.json"
    $localThemesPath = Join-Path $Root "themes\themes.local.json"
    if (Test-Path -LiteralPath $localThemesPath -PathType Leaf) { $themesPath = $localThemesPath }
    $configPath = Join-Path $Root "theme_config.json"

    $activeTheme = ""
    if (Test-Path $configPath) {
        try {
            $cfg = Get-Content $configPath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue | ConvertFrom-Json
            if ($cfg -and $cfg.themeName) {
                $activeTheme = $cfg.themeName
            }
        } catch {}
    }

    $count = 0
    if (Test-Path $themesPath) {
        try {
            $themes = Get-Content $themesPath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue | ConvertFrom-Json
            if ($themes) {
                foreach ($prop in $themes.psobject.Properties) {
                    $name = $prop.Name
                    $item = New-Object System.Windows.Forms.ToolStripMenuItem($name)
                    $item.Checked = ($name -eq $activeTheme)

                    # Capture variable with closure for click event
                    $targetTheme = $name
                    $item.add_Click({
                        Switch-ThemePreset -Root $Root -ThemeName $targetTheme -Tray $Tray
                    }.GetNewClosure())

                    $PresetsItem.DropDownItems.Add($item) | Out-Null
                    $count++
                }
            }
        } catch {}
    }

    if ($count -eq 0) {
        $empty = New-Object System.Windows.Forms.ToolStripMenuItem("(No presets available)")
        $empty.Enabled = $false
        $PresetsItem.DropDownItems.Add($empty) | Out-Null
    }
}

function Restart-Daemon {
    param(
        [string]$Root,
        [System.Windows.Forms.NotifyIcon]$Tray
    )
    $pidFile = Join-Path $Root "daemon.pid"
    if (Test-Path $pidFile) {
        try {
            $dPid = [int](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
            if ($dPid -gt 0) {
                $proc = Get-Process -Id $dPid -ErrorAction SilentlyContinue
                if ($proc) {
                    Stop-Process -Id $dPid -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Milliseconds 400
                }
            }
        } catch {}
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }

    $startScript = Join-Path $Root "scripts\start-daemon.ps1"
    if (Test-Path $startScript) {
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`"" -WorkingDirectory $Root -WindowStyle Hidden
    }

    if ($Tray) {
        $Tray.ShowBalloonTip(2000, "Antigravity Theme", "Theme Daemon restarted.", [System.Windows.Forms.ToolTipIcon]::Info)
    }
}

function Exit-TrayApp {
    param(
        [string]$Root,
        [System.Windows.Forms.NotifyIcon]$Tray,
        [System.Windows.Forms.ContextMenuStrip]$Menu,
        [System.Threading.Mutex]$AppMutex
    )
    # Stop daemon process cleanly
    $pidFile = Join-Path $Root "daemon.pid"
    if (Test-Path $pidFile) {
        try {
            $dPid = [int](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
            if ($dPid -gt 0) {
                $proc = Get-Process -Id $dPid -ErrorAction SilentlyContinue
                if ($proc) {
                    Stop-Process -Id $dPid -Force -ErrorAction SilentlyContinue
                }
            }
        } catch {}
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }

    # Clean up webport file
    $portFile = Join-Path $Root "daemon.webport"
    if (Test-Path $portFile) {
        Remove-Item $portFile -Force -ErrorAction SilentlyContinue
    }

    # Dispose UI resources immediately to remove icon from taskbar
    if ($Tray) {
        $Tray.Visible = $false
        $Tray.Dispose()
    }
    if ($Menu) {
        $Menu.Dispose()
    }

    # Release mutex
    if ($AppMutex) {
        try { $AppMutex.ReleaseMutex() } catch {}
        $AppMutex.Dispose()
    }

    [System.Windows.Forms.Application]::Exit()
    exit 0
}

# -----------------------------------------------------------------------------
# Tray Icon & Context Menu Assembly
# -----------------------------------------------------------------------------
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = Get-TrayIcon -Root $RepoRoot
$tray.Text = "Antigravity Theme Manager"

$menu = New-Object System.Windows.Forms.ContextMenuStrip

# 1. Open Web Dashboard (Bold)
$itemDash = New-Object System.Windows.Forms.ToolStripMenuItem("Open Web Dashboard")
$itemDash.Font = New-Object System.Drawing.Font($menu.Font, [System.Drawing.FontStyle]::Bold)
$itemDash.add_Click({
    Open-WebDashboard -Root $RepoRoot
})
$menu.Items.Add($itemDash) | Out-Null

# 2. Separator
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# 3. Theme Presets Submenu
$itemPresets = New-Object System.Windows.Forms.ToolStripMenuItem("Theme Presets")
# Populate initially
Update-PresetsMenu -Root $RepoRoot -PresetsItem $itemPresets -Tray $tray
# Refresh dynamically on context menu opening
$menu.add_Opening({
    param($s, $e)
    Update-PresetsMenu -Root $RepoRoot -PresetsItem $itemPresets -Tray $tray
})
$menu.Items.Add($itemPresets) | Out-Null

# 4. Restart Daemon
$itemRestart = New-Object System.Windows.Forms.ToolStripMenuItem("Restart Daemon")
$itemRestart.add_Click({
    Restart-Daemon -Root $RepoRoot -Tray $tray
})
$menu.Items.Add($itemRestart) | Out-Null

# 5. Separator
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# 6. Exit
$itemExit = New-Object System.Windows.Forms.ToolStripMenuItem("Exit")
$itemExit.add_Click({
    Exit-TrayApp -Root $RepoRoot -Tray $tray -Menu $menu -AppMutex $mutex
})
$menu.Items.Add($itemExit) | Out-Null

# Attach Context Menu to Tray
$tray.ContextMenuStrip = $menu

# Left-click opens Web Dashboard
$tray.add_MouseClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Open-WebDashboard -Root $RepoRoot
    }
})

# Make visible and start message loop
$tray.Visible = $true
$tray.ShowBalloonTip(3000, "Antigravity Theme", "Giao diện và Khay hệ thống đã sẵn sàng! Bấm vào đây để mở Web Dashboard.", [System.Windows.Forms.ToolTipIcon]::Info)

# Register exit event for clean teardown on PowerShell termination
$cleanTeardown = {
    if ($tray) {
        $tray.Visible = $false
        $tray.Dispose()
    }
    if ($mutex) {
        try { $mutex.ReleaseMutex() } catch {}
        $mutex.Dispose()
    }
}
Register-EngineEvent -SourceIdentifier ([System.Management.Automation.PsEngineEvent]::Exiting) -Action $cleanTeardown -ErrorAction SilentlyContinue | Out-Null

try {
    [System.Windows.Forms.Application]::Run()
} finally {
    if ($tray) {
        $tray.Visible = $false
        $tray.Dispose()
    }
    if ($mutex) {
        try { $mutex.ReleaseMutex() } catch {}
        $mutex.Dispose()
    }
}
