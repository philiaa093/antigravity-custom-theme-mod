' Antigravity Unified Launcher
' Starts Antigravity with --remote-debugging-port=0 alongside the Theme Dashboard.

Option Explicit

Dim fso, WshShell, scriptDir, startAllScript, antigravityExe, argsStr, i, arg

Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' Locate Antigravity.exe
antigravityExe = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe")

' Collect any command-line arguments passed to this script
argsStr = ""
For i = 0 To WScript.Arguments.Count - 1
    arg = WScript.Arguments(i)
    If InStr(arg, " ") > 0 Then
        arg = """" & arg & """"
    End If
    argsStr = argsStr & " " & arg
Next

' Ensure --remote-debugging-port=0 is included
If InStr(argsStr, "--remote-debugging-port") = 0 Then
    argsStr = " --remote-debugging-port=0" & argsStr
End If

' Launch Antigravity
If fso.FileExists(antigravityExe) Then
    WshShell.Run """" & antigravityExe & """" & argsStr, 1, False
Else
    MsgBox "Could not find Antigravity at: " & antigravityExe, 16, "Antigravity Launcher Error"
End If

' Start the daemon and tray, then open the dashboard once it responds.
startAllScript = scriptDir & "\scripts\start-all.ps1"
If WshShell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & startAllScript & """ -OpenDashboard -WaitForTheme", 0, True) <> 0 Then
    MsgBox "Antigravity did not confirm the saved theme. Quit Antigravity completely, then open this shortcut again or run scripts\restore-theme.ps1. Check " & scriptDir & "\daemon.log", 16, "Antigravity Launcher Error"
End If
