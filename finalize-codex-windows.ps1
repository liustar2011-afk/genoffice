$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-NativeSuccess([string]$label) {
  if ($LASTEXITCODE -ne 0) {
    throw "$label failed with exit code $LASTEXITCODE. Nothing was pushed."
  }
}

$branch = (git branch --show-current).Trim()
Assert-NativeSuccess 'git branch --show-current'
if ($branch -ne 'codex-v1') { throw "Run this from branch codex-v1 (current: $branch)." }
if ((git status --porcelain).Length -ne 0) { throw 'Working tree must be clean before finalizing Codex V1.' }

powershell -ExecutionPolicy Bypass -File .\setup-codex-windows.ps1
Assert-NativeSuccess 'setup-codex-windows.ps1'

git add -A
Assert-NativeSuccess 'git add'

git diff --cached --quiet
$diffExit = $LASTEXITCODE
if ($diffExit -eq 0) {
  Write-Host 'No generated Codex changes to commit. Setup and verification completed successfully.'
  exit 0
}
if ($diffExit -ne 1) { throw "git diff failed with exit code $diffExit." }

git commit -m 'feat: flatten Codex V1 integration'
Assert-NativeSuccess 'git commit'
git push origin codex-v1
Assert-NativeSuccess 'git push'

Write-Host 'Codex V1 source changes were committed and pushed to origin/codex-v1.'
