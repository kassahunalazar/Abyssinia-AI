$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.action -eq 'list') {
    $session = (Get-Process -Id $PID).SessionId
    $windows = @(Get-Process | Where-Object { $_.SessionId -eq $session -and $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First 60 | ForEach-Object {
        try { @{ pid=$_.Id; handle=$_.MainWindowHandle.ToInt64().ToString(); title=$_.MainWindowTitle; process=$_.ProcessName; started=$_.StartTime.ToUniversalTime().Ticks.ToString() } } catch {}
    })
    [Console]::Write((ConvertTo-Json -InputObject $windows -Compress))
    exit
}
$p = Get-Process -Id ([int]$request.window.pid)
if ($p.SessionId -ne (Get-Process -Id $PID).SessionId -or $p.StartTime.ToUniversalTime().Ticks.ToString() -ne $request.window.started -or
    $p.MainWindowHandle.ToInt64().ToString() -ne $request.window.handle -or !$p.MainWindowTitle -or $p.MainWindowTitle -cne $request.window.title) { throw 'Window changed.' }
if ($request.action -eq 'focus') {
    Add-Type 'using System;using System.Runtime.InteropServices;public static class AbyssiniaWindow{[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();}'
    $null=[AbyssiniaWindow]::SetForegroundWindow($p.MainWindowHandle)
    if ([AbyssiniaWindow]::GetForegroundWindow() -ne $p.MainWindowHandle) { throw 'Windows declined focus.' }
} elseif ($request.action -eq 'scrollDown' -or $request.action -eq 'scrollUp') {
    Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
    $root = [Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
    $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty, $true)
    $view = $root.FindFirst([Windows.Automation.TreeScope]::Subtree, $condition)
    if (!$view -or $view.Current.ProcessId -ne $p.Id) { throw 'No scroll view.' }
    $pattern = $view.GetCurrentPattern([Windows.Automation.ScrollPattern]::Pattern)
    if (!$pattern.Current.VerticallyScrollable) { throw 'No vertical scroll.' }
    $direction = if ($request.action -eq 'scrollDown') { [Windows.Automation.ScrollAmount]::LargeIncrement } else { [Windows.Automation.ScrollAmount]::LargeDecrement }
    $pattern.Scroll([Windows.Automation.ScrollAmount]::NoAmount, $direction)
} else { throw 'Unsupported action.' }
[Console]::Write('{"ok":true}')
