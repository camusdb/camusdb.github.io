# camus-cli interactive shell. capture.mjs runs this tape from the raw output folder.
# Sizes are doubled so the image is sharp at a device scale factor of 2.
Output cli.gif

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
Type "camus-cli shop --no-history"
Enter
Sleep 3s
# The shell's own clear command puts the first prompt at the top of the window.
Type "clear"
Enter
Sleep 500ms
Show

Type "DESC orders;"
Enter
Sleep 1.5s

# Ctrl+O starts a continuation line; Enter runs the statement.
Type "SELECT o.id, c.name, o.status, o.total FROM orders o"
Ctrl+O
Type "JOIN customers c ON c.id = o.customer_id"
Ctrl+O
Type "WHERE o.status = 'paid' ORDER BY o.total DESC;"
Enter
Sleep 2s

Screenshot cli.png
Sleep 500ms
