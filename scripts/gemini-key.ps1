Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object Windows.Forms.Form
$form.Text = 'Abyssinia AI - Gemini speech'
$form.ClientSize = New-Object Drawing.Size(425,145)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$label = New-Object Windows.Forms.Label
$label.Text = 'Gemini API key for this running session'
$label.SetBounds(14,12,385,24)
$field = New-Object Windows.Forms.TextBox
$field.UseSystemPasswordChar = $true
$field.MaxLength = 256
$field.SetBounds(14,42,395,28)
$ok = New-Object Windows.Forms.Button
$ok.Text = 'Connect'
$ok.DialogResult = 'OK'
$ok.SetBounds(220,92,90,31)
$cancel = New-Object Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.DialogResult = 'Cancel'
$cancel.SetBounds(320,92,90,31)
$form.Controls.AddRange(@($label,$field,$ok,$cancel))
$form.AcceptButton = $ok
$form.CancelButton = $cancel
try {
  if ($form.ShowDialog() -eq 'OK') { [Console]::Write($field.Text.Trim()) }
} finally { $field.Clear(); $form.Dispose() }
