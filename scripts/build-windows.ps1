param([string]$Destination = (Join-Path $PSScriptRoot '..\.runtime\Abyssinia-AI-Windows.zip'))
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (git -C $project rev-parse --short=12 HEAD).Trim()
$buildRoot = Join-Path $project '.runtime'
$stage = Join-Path $buildRoot ('abyssinia-package-' + [guid]::NewGuid())
$app = Join-Path $stage ('Abyssinia AI\app-' + $version)
New-Item $app -ItemType Directory -Force | Out-Null
$sourceArchive = Join-Path $stage 'source.zip'
git -C $project archive --format=zip "--output=$sourceArchive" HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot read committed sources' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = Join-Path $stage 'source'
[IO.Compression.ZipFile]::ExtractToDirectory($sourceArchive,$source)
$files = git -C $project ls-tree --name-only -r HEAD
foreach ($relative in $files) {
  if ($relative -match '^(test/|http-fixture\.mjs$|scripts/build-windows\.ps1$)') { continue }
  $to = Join-Path $app $relative
  New-Item ([IO.Path]::GetDirectoryName($to)) -ItemType Directory -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $source $relative) -Destination $to
}
$node = (Get-Command node.exe).Source
$supportedHashes=@('3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5','49a54c103f4919ce64199a043ef5cd309507de491d718085edee089cd8e87543')
if((Get-FileHash -LiteralPath $node).Hash -notin $supportedHashes){throw 'Build requires the official x64 or ARM64 Node v24.15.0 binary.'}
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
$setup = @"
@echo off
echo This installs the Abyssinia engine into your local Windows account and updates your user PATH.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app-$version\scripts\setup-engine.ps1"
pause
"@
Set-Content -LiteralPath (Join-Path $stage 'Abyssinia AI\Setup Abyssinia Engine.cmd') -Value $setup -Encoding ASCII
Add-Type -AssemblyName System.IO.Compression.FileSystem
$artifact = [IO.Path]::GetFullPath($Destination)
New-Item ([IO.Path]::GetDirectoryName($artifact)) -ItemType Directory -Force | Out-Null
$tempZip = Join-Path $stage 'package.zip'
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $stage 'Abyssinia AI'),$tempZip)
Copy-Item -LiteralPath $tempZip -Destination $artifact -Force
Write-Output $artifact
$stagingPath=(Resolve-Path -LiteralPath $stage).Path
if(([IO.Path]::GetDirectoryName($stagingPath) -eq $buildRoot) -and ([IO.Path]::GetFileName($stagingPath) -match '^abyssinia-package-[a-f0-9-]{36}$')){
  Remove-Item -LiteralPath $stagingPath -Recurse -Force
}

