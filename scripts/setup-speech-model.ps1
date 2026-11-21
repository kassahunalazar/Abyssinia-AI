param()
$ErrorActionPreference = 'Stop'
$revision = 'ebbaefd91a5b7d45e4caabfe597636d3891228d2'
$base = "https://huggingface.co/Yaredoffice/hohe-asr-amharic-onnx-int8/resolve/$revision/"
$modelDir = Join-Path $env:LOCALAPPDATA 'AbyssiniaAI\models\hohe-int8'
$hashes = [ordered]@{
  'assets/frontend.npz' = '8735122e2e7fd43fff61fe95b82b985bf466c2a0d26cde0d44f0babe663020e7'
  'assets/meta.json' = '380a112c73c731ed34b1d4c59c82b0f0e325bda2a920378ad77e2d3ba6c90192'
  'model.onnx' = 'f408c0b8a361647d05b33433a7b2e61a687133fa4120ce07457097bf966a8f89'
}
foreach ($entry in $hashes.GetEnumerator()) {
  $target = Join-Path $modelDir $entry.Key
  if ((Test-Path $target) -and (Get-FileHash -LiteralPath $target).Hash -eq $entry.Value) { continue }
  New-Item ([IO.Path]::GetDirectoryName($target)) -ItemType Directory -Force | Out-Null
  $part = "$target.part"
  & curl.exe --fail --location --continue-at - --output $part ($base + $entry.Key)
  if ($LASTEXITCODE -ne 0) { throw 'Transfer interrupted. Run setup again to resume.' }
  if ((Get-FileHash -LiteralPath $part).Hash -ne $entry.Value) { throw 'Downloaded model failed integrity validation.' }
  Move-Item -LiteralPath $part -Destination $target -Force
}
Write-Output 'Hohe benchmark weights verified.'
