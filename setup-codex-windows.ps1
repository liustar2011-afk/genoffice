$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = (Resolve-Path '.').Path
$windowsRoot = ([System.IO.Path]::GetFullPath($env:SystemRoot)).TrimEnd('\') + '\'
if ($repo.StartsWith($windowsRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Do not run GenOffice from $env:SystemRoot or System32. Clone it under your user directory."
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
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -ne 22) {
  Write-Warning "This repository pins Node 22 in .nvmrc; current Node is $(node --version). Codex source verification may still work, but use Node 22 before Electron runtime validation."
}

Write-Host "npm registry: $(npm config get registry)"
Assert-NativeSuccess 'npm config get registry'
Write-Host '[0/6] Checking npm registry connectivity...'
npm ping --registry=https://registry.npmjs.org/ --loglevel=notice
Assert-NativeSuccess 'npm ping'

Write-Host '[1/6] Installing/updating npm packages WITHOUT lifecycle scripts...'
Write-Host 'Electron binary download is intentionally skipped here so GitHub Releases cannot block Codex finalization.'
$installArgs = @(
  'install',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--loglevel=notice',
  '--progress=true',
  '--fetch-retries=5',
  '--fetch-timeout=60000',
  '--fetch-retry-mintimeout=2000',
  '--fetch-retry-maxtimeout=120000'
)
& npm @installArgs
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'npm install --ignore-scripts failed. Verifying cache, then retrying once...'
  npm cache verify
  Assert-NativeSuccess 'npm cache verify'
  & npm install --ignore-scripts --no-audit --no-fund --loglevel=notice --progress=true --fetch-retries=5 --fetch-timeout=120000 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=180000
  Assert-NativeSuccess 'npm install --ignore-scripts (retry)'
}

Write-Host '[2/6] Applying readable Codex source migration...'
node tools/codex-v1/bootstrap.mjs .
Assert-NativeSuccess 'Codex migration bootstrap'

Write-Host '[3/6] Syntax-checking release packaging configuration...'
node --check apps/shell/electron-builder.cjs
Assert-NativeSuccess 'electron-builder.cjs syntax check'

Write-Host '[4/6] Checking project-local Codex runtime...'
$codex = Join-Path $repo 'node_modules\.bin\codex.cmd'
if (-not (Test-Path $codex)) {
  throw "Project-local Codex runtime was not installed: $codex"
}
& $codex --version
Assert-NativeSuccess 'codex --version'

Write-Host '[5/6] Type checking GenOffice...'
npm run typecheck
Assert-NativeSuccess 'npm run typecheck'

Write-Host '[6/6] Testing Codex bridge...'
npm run test -w @genoffice/codex-bridge
Assert-NativeSuccess 'Codex bridge tests'

Write-Host ''
Write-Host 'Codex V1 source integration verified.'
Write-Host 'Electron binary installation was intentionally deferred and will be validated separately.'
