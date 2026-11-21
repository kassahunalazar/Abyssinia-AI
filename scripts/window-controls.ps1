function Get-WindowControls($Window, [int]$ProcessId) {
    $root = [Windows.Automation.AutomationElement]::FromHandle($Window)
    $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
    $element = $walker.GetFirstChild($root)
    $visited = 0
    $found = 0
    while ($null -ne $element -and $visited -lt 400 -and $found -lt 50) {
        $visited++
        $current = $element.Current
        if ($current.ProcessId -eq $ProcessId -and $current.IsEnabled -and !$current.IsOffscreen -and !$current.IsPassword) {
            $type = $current.ControlType.ProgrammaticName
            $pattern = $null
            $operation = $null
            if ($type -eq 'ControlType.Edit' -and $element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern) -and !$pattern.Current.IsReadOnly) {
                $operation = 'setText'
            } elseif ($type -in @('ControlType.Button','ControlType.Hyperlink','ControlType.MenuItem') -and $element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
                $operation = 'invoke'
            }
            if ($operation) {
                $runtime = $element.GetRuntimeId() -join ','
                if ($runtime -and $current.Name.Length -le 160 -and $current.AutomationId.Length -le 160 -and $current.ClassName.Length -le 160) {
                    $found++
                    [pscustomobject]@{runtime=$runtime; name=$current.Name; id=$current.AutomationId; class=$current.ClassName; type=$type; operation=$operation; pattern=$pattern}
                }
            }
        }
        $child = $walker.GetFirstChild($element)
        if ($child) { $element = $child; continue }
        while ($element -and !$element.Equals($root)) {
            $sibling = $walker.GetNextSibling($element)
            if ($sibling) { break }
            $element = $walker.GetParent($element)
        }
        $element = if ($element -and !$element.Equals($root)) { $sibling } else { $null }
    }
}
