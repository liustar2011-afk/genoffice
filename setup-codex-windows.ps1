$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.12+ is required.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm 10+ is required.' }

Write-Host '[1/4] Installing dependencies and applying Codex integration...'
npm install

Write-Host '[2/4] Checking project-local Codex runtime...'
& .\node_modules\.bin\codex.cmd --version

Write-Host '[3/4] Type checking GenOffice...'
npm run typecheck

Write-Host '[4/4] Testing Codex bridge...'
npm run test -w @genoffice/codex-bridge

Write-Host ''
Write-Host 'Codex V1 setup completed. Start GenOffice with: npm run dev'
