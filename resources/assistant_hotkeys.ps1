# Only observe the shortcut keys; never record or log typed text.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AstronShortcutKeys {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int key);
}
'@
function Down([int]$key) { return ([AstronShortcutKeys]::GetAsyncKeyState($key) -band 0x8000) -ne 0 }
function Emit([string]$state) { [Console]::WriteLine($state); [Console]::Out.Flush() }
$assistantDown = $false
Emit 'LISTENER_READY'
while ($true) {
    # Ctrl + Win (either Windows key) + A is the voice-task chord.
    $assistant = (Down 0x11) -and ((Down 0x5B) -or (Down 0x5C)) -and (Down 0x41)
    if ($assistant -and -not $assistantDown) { Emit 'ASSISTANT_PRESS' }
    if (-not $assistant -and $assistantDown) { Emit 'ASSISTANT_RELEASE' }
    $assistantDown = $assistant
    Start-Sleep -Milliseconds 15
}
