$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = (Resolve-Path '.').Path
$windowsRoot = ([System.IO.Path]::GetFullPath($env:SystemRoot)).TrimEnd('\') + '\'
if ($repo.StartsWith($windowsRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Do not run GenOffice from $env:SystemRoot or System32. Clone it under your user directory, for example: $HOME\source\genoffice"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.12+ is required.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm 10+ is required.' }

function Assert-NativeSuccess([string]$label) {
  if ($LASTEXITCODE -ne 0) {
    throw "$label failed with exit code $LASTEXITCODE. Stop here; later steps were not run."
  }
}

Write-Host "Repository: $repo"
Write-Host "Node: $(node --version)"
Assert-NativeSuccess 'node --version'
Write-Host "npm:  $(npm --version)"
Assert-NativeSuccess 'npm --version'

Write-Host '[1/4] Installing dependencies and applying Codex integration...'
# npm supports fetch retry controls. Use generous retry windows for unstable links/VPNs.
npm install --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=120000
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'npm install failed. Verifying the npm cache, then retrying once...'
  npm cache verify
  Assert-NativeSuccess 'npm cache verify'
  npm install --fetch-retries=5 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=180000
  Assert-NativeSuccess 'npm install (retry)'
}

Write-Host '[2/4] Checking project-local Codex runtime...'
$codex = Join-Path $repo 'node_modules\.bin\codex.cmd'
if (-not (Test-Path $codex)) {
  throw "Project-local Codex runtime was not installed: $codex"
}
& $codex --version
Assert-NativeSuccess 'codex --version'

Write-Host '[3/4] Type checking GenOffice...'
npm run typecheck
Assert-NativeSuccess 'npm run typecheck'

Write-Host '[4/4] Testing Codex bridge...'
npm run test -w @genoffice/codex-bridge
Assert-NativeSuccess 'Codex bridge tests'

Write-Host ''
Write-Host 'Codex V1 setup completed. Start GenOffice with: npm run dev'
