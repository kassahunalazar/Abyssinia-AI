param(
    [Parameter(Mandatory)][string]$Python,
    [Parameter(Mandatory)][string]$HermesSource,
    [Parameter(Mandatory)][string]$ModelUrl,
    [Parameter(Mandatory)][string]$Model
)
$ErrorActionPreference = 'Stop'
$uri = [Uri]$ModelUrl
if ($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and $uri.Host -eq '127.0.0.1')) {
    throw 'Use an HTTPS endpoint or HTTP at 127.0.0.1.'
}
if ($uri.UserInfo -or $uri.Query -or $uri.Fragment) {
    throw 'Supply a model base URL without credentials, query strings or fragments.'
}
$project = Split-Path -Parent $PSScriptRoot
$env:ASSISTANT_PYTHON = (Resolve-Path -LiteralPath $Python).Path
$env:ASSISTANT_HERMES_SOURCE = (Resolve-Path -LiteralPath $HermesSource).Path
$env:ASSISTANT_MODEL_URL = $ModelUrl.TrimEnd('/')
$env:ASSISTANT_MODEL_ID = $Model
New-Item -ItemType Directory -Force -Path (Join-Path $project '.runtime') | Out-Null
node (Join-Path $project 'server.mjs')
