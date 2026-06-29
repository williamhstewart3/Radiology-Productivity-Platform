; ============================================================================
; PowerScribe_Watcher.ahk
;
; PURPOSE:
;   Capture the active window or full screen as a PNG screenshot and save it
;   to the wRVU Tracker watch folder.  The wRVU Tracker desktop app will
;   detect the new file automatically, run Tesseract OCR on it, and import
;   matching studies into your productivity log.
;
; HOTKEY:  Win + Shift + P
;
; SETUP:
;   1. Install AutoHotkey v1.1+ from https://www.autohotkey.com
;   2. Edit WATCH_FOLDER below to match the folder you selected in
;      wRVU Tracker → Settings → PowerScribe Watcher.
;   3. Double-click this script to run it in the system tray, OR add it to
;      your Windows startup folder to run it automatically on login.
;
; ============================================================================
; ⚠  PHI WARNING — HIPAA COMPLIANCE REQUIRED
;
;   Screenshots captured by this script may contain Protected Health
;   Information (PHI) including patient names, MRNs, dates of service, and
;   procedure descriptions.
;
;   • Use ONLY on institution-approved, HIPAA-compliant, encrypted devices.
;   • Do NOT use on shared, public, or personally-owned computers.
;   • Ensure your institution's policies permit local screenshot capture of
;     the PowerScribe reporting interface.
;   • Screenshots are stored locally and processed entirely on-device.
;     No data is transmitted externally.
;
;   Unauthorized capture or storage of PHI may violate HIPAA, your
;   institution's policies, and applicable state law.
; ============================================================================

#NoEnv
#SingleInstance, Force
SendMode Input
SetWorkingDir, %A_ScriptDir%

; ── Configuration ────────────────────────────────────────────────────────────
;
; Set this to the same path you entered in wRVU Tracker → Settings → Watcher.
; Use double backslashes or a forward slash as the path separator.
;
WATCH_FOLDER := A_MyDocuments . "\wRVU_Screenshots"

; ── Hotkey: Win + Shift + P ──────────────────────────────────────────────────

#+p::
    ; Build a timestamped filename: PS_20240615_143022.png
    FormatTime, stamp,, yyyyMMdd_HHmmss
    fileName := "PS_" . stamp . ".png"
    filePath := WATCH_FOLDER . "\" . fileName

    ; Ensure the watch folder exists
    IfNotExist, %WATCH_FOLDER%
        FileCreateDir, %WATCH_FOLDER%

    ; ── Capture screenshot ───────────────────────────────────────────────────
    ; Captures the ACTIVE WINDOW only (best for PowerScribe — excludes other
    ; monitors and background windows so OCR sees only the report text).
    ;
    ; If you prefer a full-screen capture, replace the WinGetPos block below
    ; with:
    ;   xPos := 0, yPos := 0
    ;   xSize := A_ScreenWidth, ySize := A_ScreenHeight
    ;
    WinGetPos, xPos, yPos, xSize, ySize, A

    ; Clamp to visible screen area
    if (xPos < 0)
        xPos := 0
    if (yPos < 0)
        yPos := 0

    ; PowerShell capture — no extra dependencies required. Avoid conditional
    ; #Include here because AutoHotkey resolves includes before runtime.
    psCmd := "Add-Type -AssemblyName System.Windows.Forms; "
           . "$bmp = New-Object System.Drawing.Bitmap(" . xSize . "," . ySize . "); "
           . "$g = [System.Drawing.Graphics]::FromImage($bmp); "
           . "$g.CopyFromScreen(" . xPos . "," . yPos . ",0,0,[System.Drawing.Size]::new(" . xSize . "," . ySize . ")); "
           . "$bmp.Save('" . filePath . "'); "
           . "$g.Dispose(); $bmp.Dispose()"
    RunWait, powershell.exe -NoProfile -NonInteractive -Command "%psCmd%",, Hide

    ; Brief visual confirmation (tray tip)
    TrayTip, wRVU Watcher, Captured: %fileName%, 2, 1
return

; ── Tray menu ────────────────────────────────────────────────────────────────

#Persistent
Menu, Tray, Tip, wRVU PowerScribe Watcher (Win+Shift+P)
Menu, Tray, Add, Open Watch Folder, OpenFolder
Menu, Tray, Add            ; separator
Menu, Tray, Add, Exit, ExitScript

OpenFolder:
    Run, explorer.exe "%WATCH_FOLDER%"
return

ExitScript:
    ExitApp
return
