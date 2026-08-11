$ErrorActionPreference = 'Stop'

$branch = (git branch --show-current).Trim()
if ($branch -ne 'codex-v1') { throw "Run this from branch codex-v1 (current: $branch)." }
if ((git status --porcelain).Length -ne 0) { throw 'Working tree must be clean before finalizing Codex V1.' }

powershell -ExecutionPolicy Bypass -File .\setup-codex-windows.ps1

git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host 'No generated Codex changes to commit.'
  exit 0
}

git commit -m 'feat: flatten Codex V1 integration'
git push origin codex-v1

Write-Host 'Codex V1 source changes were committed and pushed to origin/codex-v1.'
