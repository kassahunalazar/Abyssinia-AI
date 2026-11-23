param([string]$Zip = (Join-Path $PSScriptRoot '../.runtime/Abyssinia-AI-Windows.zip'))
$ErrorActionPreference = 'Stop'
$zipPath = (Resolve-Path -LiteralPath $Zip).Path
$output = Join-Path (Split-Path $zipPath) 'Abyssinia-AI-Setup.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe /platform:anycpu /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:System.Windows.Forms.dll "/resource:$zipPath,distribution.zip" "/out:$output" (Join-Path $PSScriptRoot '../packaging/windows/Setup.cs')
if ($LASTEXITCODE) { throw 'Installer build failed' }
Write-Output $output
