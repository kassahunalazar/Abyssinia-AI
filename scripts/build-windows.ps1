param([string]$Destination = (Join-Path $PSScriptRoot '..\.runtime\Abyssinia-AI-Windows.zip'))
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (git -C $project rev-parse --short=12 HEAD).Trim()
$stage = Join-Path ([IO.Path]::GetTempPath()) ('abyssinia-package-' + [guid]::NewGuid())
$app = Join-Path $stage ('Abyssinia AI\app-' + $version)
New-Item $app -ItemType Directory -Force | Out-Null
$files = git -C $project ls-tree --name-only -r HEAD
foreach ($relative in $files) {
  if ($relative -match '^(test/|http-fixture\.mjs$|scripts/build-windows\.ps1$)') { continue }
  $to = Join-Path $app $relative
  New-Item ([IO.Path]::GetDirectoryName($to)) -ItemType Directory -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $project $relative) -Destination $to
}
$node = (Get-Command node.exe).Source
Copy-Item -LiteralPath $node -Destination $app
$nodeVersion = (& $node --version).Trim()
Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/nodejs/node/' + $nodeVersion + '/LICENSE') -OutFile (Join-Path $app 'Node-LICENSE.txt')
$entry = @"
@echo off
setlocal
cd /d "%~dp0app-$version"
set "ASSISTANT_RUNTIME_DIR=%LOCALAPPDATA%\AbyssiniaAI\data"
node.exe launch.mjs --open
if errorlevel 1 pause
"@
Set-Content -LiteralPath (Join-Path $stage 'Abyssinia AI\Open Abyssinia AI.cmd') -Value $entry -Encoding ASCII
Add-Type -AssemblyName System.IO.Compression.FileSystem
$artifact = [IO.Path]::GetFullPath($Destination)
New-Item ([IO.Path]::GetDirectoryName($artifact)) -ItemType Directory -Force | Out-Null
$tempZip = Join-Path $stage 'package.zip'
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $stage 'Abyssinia AI'),$tempZip)
Copy-Item -LiteralPath $tempZip -Destination $artifact -Force
Write-Output $artifact
