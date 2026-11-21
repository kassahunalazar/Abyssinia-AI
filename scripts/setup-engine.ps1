param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$commit = '2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19'
$hash = '44BB5B021498C0BBA95F77AC30B6C4676F3FFB7AA92EA48C731CD0940E941CDC'
$deps = Join-Path $env:LOCALAPPDATA 'AbyssiniaAI\hermes-deps'
$target = Join-Path ([IO.Path]::GetTempPath()) ('abyssinia-hermes-' + [guid]::NewGuid() + '.ps1')
try {
  Invoke-WebRequest -UseBasicParsing -Uri ("https://raw.githubusercontent.com/NousResearch/hermes-agent/" + $commit + "/scripts/install.ps1") -OutFile $target
  if ((Get-FileHash -LiteralPath $target).Hash -ne $hash) { throw 'Hermes installer integrity check failed.' }
  if ($VerifyOnly) { Write-Output "Verified Hermes $commit installer"; return }
  & $target -Commit $commit -HermesHome $deps -InstallDir (Join-Path $deps 'hermes-agent') -NonInteractive -SkipSetup -SkipBrowser -SkipComputerUse
  if ($LASTEXITCODE -ne 0) { throw 'Hermes dependency installation failed.' }
} finally {
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
}
