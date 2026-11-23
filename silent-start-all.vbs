' AntigravityTheme Silent Unified Launcher
' Launches both Theme Daemon and System Tray without popping console windows.

Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

startAllScript = scriptDir & "\scripts\start-all.ps1"
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & startAllScript & """", 0, False
