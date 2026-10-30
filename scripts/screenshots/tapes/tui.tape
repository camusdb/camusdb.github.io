# camus-cli full-screen TUI. capture.mjs runs this tape from the raw output folder.
# Sizes are doubled so the image is sharp at a device scale factor of 2.
Output tui.gif

Set Shell "bash"
Set FontFamily "JetBrains Mono, Menlo, monospace"
Set FontSize 36
Set LineHeight 1.25
Set Width 2880
Set Height 1800
Set Padding 56
Set Theme "TokyoNight"
Set TypingSpeed 35ms
Set CursorBlink false

Hide
Type "clear && camus-cli shop --tui --no-history"
Enter
Sleep 4s
Show

# The editor opens with the query that capture.mjs wrote to the TUI scratch file.
Ctrl+R
Sleep 2s
Shift+Tab
Sleep 300ms
Down
Down
Right
Sleep 1s
Screenshot tui.png
Sleep 500ms
