param([string]$Python = $env:ASSISTANT_STT_PYTHON)
$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:LOCALAPPDATA 'AbyssiniaAI/models/mms-amharic'
if (!$Python) { $Python = Join-Path $env:LOCALAPPDATA 'Programs/Python/Python313/python.exe' }
if (!(Test-Path -LiteralPath $Python)) {
  $environment = Get-ChildItem "$env:LOCALAPPDATA/AbyssiniaAI/hermes-deps/installs/*/environments/*" -Directory |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $Python = Join-Path $environment.FullName 'venv/Scripts/python.exe'
}
if (!(Test-Path -LiteralPath $Python)) { throw 'Install the Abyssinia engine first.' }
New-Item -ItemType Directory -Force $directory | Out-Null
$revision = '99a12b073f21bcf3872d16ef597bd8bb2ecf5e20'
$base = "https://huggingface.co/hadamard-2/mms-tts-amh-onnx/resolve/$revision"
$hashes = @{
  'model.onnx'='ff00164b59d45167c025f1e76085b173a6e55a2da365f65bdfce0a86e4bd1aaf'
  'tokens.txt'='bda8a05dfcdd287ae4c9f7fea9a9dac1eb205757f781d3eb3a6a602cd5d8af1c'
}
Write-Output 'MMS Amharic by Meta, ONNX conversion by hadamard-2. For noncommercial use under CC BY-NC 4.0.'
foreach ($name in $hashes.Keys) {
  $path = Join-Path $directory $name
  if ((Test-Path -LiteralPath $path) -and (Get-FileHash -LiteralPath $path).Hash -eq $hashes[$name]) { continue }
  curl.exe --fail --location --retry 2 --continue-at - --output "$path.part" "$base/$name"
  if ($LASTEXITCODE -or (Get-FileHash -LiteralPath "$path.part").Hash -ne $hashes[$name]) { throw 'Voice model verification failed.' }
  Move-Item -LiteralPath "$path.part" -Destination $path -Force
}
& $Python -m pip install --no-cache-dir --only-binary=:all: --upgrade --target (Join-Path $directory 'dependencies') 'uroman==1.3.1.1' 'onnxruntime==1.23.2' 'numpy==2.2.6'
if ($LASTEXITCODE) { throw 'Local voice dependencies could not be installed.' }
Set-Content -LiteralPath (Join-Path $directory 'verified') -Value $revision
Write-Output 'Local Amharic voice is ready for evaluation in Settings.'

