#!/usr/bin/env bash
set -euo pipefail

command -v node >/dev/null || { echo 'Node.js 22.12+ is required.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'npm 10+ is required.' >&2; exit 1; }

echo '[1/4] Installing dependencies and applying Codex integration...'
npm install

echo '[2/4] Checking project-local Codex runtime...'
./node_modules/.bin/codex --version

echo '[3/4] Type checking GenOffice...'
npm run typecheck

echo '[4/4] Testing Codex bridge...'
npm run test -w @genoffice/codex-bridge

echo
echo 'Codex V1 setup completed. Start GenOffice with: npm run dev'
