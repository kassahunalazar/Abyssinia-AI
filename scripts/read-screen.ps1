$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter,Windows.Storage.Streams,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod -and
    $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Wait-Operation($operation, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    $task.GetAwaiter().GetResult()
}
$stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
$writer = [Windows.Storage.Streams.DataWriter]::new($stream)
try {
    $writer.WriteBytes([Convert]::FromBase64String([Console]::In.ReadToEnd()))
    $null = Wait-Operation $writer.StoreAsync() ([uint32])
    $null = $writer.DetachStream()
    $stream.Seek(0)
    $decoder = Wait-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Wait-Operation $decoder.GetSoftwareBitmapAsync() ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (!$engine) { throw 'OCR language unavailable' }
    $result = Wait-Operation $engine.RecognizeAsync($bitmap) ([Windows.Media.Ocr.OcrResult])
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    [Console]::Write((@{text=$result.Text;language=$engine.RecognizerLanguage.LanguageTag} | ConvertTo-Json -Compress))
} finally {
    $writer.Dispose()
    $stream.Dispose()
}
