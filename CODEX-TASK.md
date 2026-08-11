# Codex task: finish GenOffice Codex V1 integration

Work ONLY on branch `codex-v1` of `liustar2011-afk/genoffice`. Do not modify `main`.

## Critical completion condition
The task is NOT complete until the verified source changes are committed and pushed to `origin/codex-v1`, and a fresh remote check confirms the pushed commit contains the Codex integration. Do not stop after changing files only in the Codex workspace.

Before starting, run:

```bash
git fetch origin
git checkout codex-v1
git reset --hard origin/codex-v1
git status --short --branch
```

## Goal
Finish the prepared GenOffice V1 migration so the core AI/agent runtime uses official OpenAI Codex `app-server` + ChatGPT login instead of Genspark for core LLM/agent execution, while preserving GenOffice Office editing skills/tools.

## Prepared migration payload
The exact migration script is stored as Base64 chunks under the ACTUAL repository path:

`tools/codex-v1-b64/*.b64`

Reconstruct it in lexical order and decode it to `/tmp/apply-codex-v1.mjs`:

```bash
cat tools/codex-v1-b64/*.b64 | base64 -d > /tmp/apply-codex-v1.mjs
node --check /tmp/apply-codex-v1.mjs
```

If GNU `base64 -d` is unavailable, decode with Node.js instead. Do not use the obsolete path `tools/codex-v1-parts-b64`; it does not exist.

## Execute
1. Confirm current branch is `codex-v1`.
2. Reconstruct `/tmp/apply-codex-v1.mjs` from `tools/codex-v1-b64/*.b64`.
3. Run:

```bash
node /tmp/apply-codex-v1.mjs .
```

4. Install/update dependencies and lockfile:

```bash
npm install --ignore-scripts
```

5. Verify the project-local Codex binary exists and reports the prepared compatibility baseline:

```bash
./node_modules/.bin/codex --version
```

6. Run:

```bash
npm run typecheck
npm run test -w @genoffice/codex-bridge
```

7. If typecheck/tests fail, FIX the actual source code until they pass. Do not bypass tests and do not delete existing GenOffice functionality merely to make typecheck pass.

## Required architecture
- One shared `@genoffice/codex-bridge` package.
- Electron main process spawns official Codex `app-server` over stdio JSON-RPC.
- Managed ChatGPT login through Codex account RPC (`account/login/start`, `account/read`, logout); do not scrape/copy Codex access tokens.
- Codex is the core LLM/agent runtime for Docs, Sheets, Slides, PDF and Markdown in the unified shell.
- Existing GenOffice `AgentSkill` Office tools remain local and are exposed to Codex as Dynamic Tools.
- Codex `item/tool/call` requests must be executed by existing local Office tool handlers and the result returned within the same Codex turn.
- Keep Genspark-only external capabilities (legacy image/media/cloud conversion/project services where V1 has no equivalent) isolated; they must not remain the core LLM provider.
- Pin protocol/runtime compatibility to the prepared V1 baseline (`rust-v0.146.0` / npm `@openai/codex` 0.146.0) unless a concrete build issue requires a narrowly justified update.
- Windows x64 and macOS Apple Silicon packaging must include the compatible Codex runtime so packaged GenOffice does not depend on system PATH/global Codex.
- Source development should prefer the project-local Codex binary.

## Clean up before final commit
After the migration succeeds and verification passes, remove only migration scaffolding:

```bash
rm -rf tools/codex-v1-parts
rm -rf tools/codex-v1-b64
rm -f .github/workflows/apply-codex-v1.yml
rm -f CODEX-TASK.md
```

Do not remove real source code introduced by the migration.

## Final verification after cleanup
Run again:

```bash
npm run typecheck
npm run test -w @genoffice/codex-bridge
```

Then verify expected files/changes exist, at minimum:

```bash
test -f packages/codex-bridge/package.json
grep -n '"@openai/codex"' package.json
git status --short
git diff --stat origin/main...HEAD
```

Review the diff for accidental changes and secrets.

## Commit and push — mandatory
Commit all verified source and lockfile changes to `codex-v1`:

```bash
git add -A
git commit -m 'feat: integrate Codex app-server with ChatGPT login'
git push origin HEAD:codex-v1
```

If push is rejected because the remote branch moved, fetch/rebase or otherwise resolve it safely without touching `main`, then push again.

## Remote push verification — mandatory
After push, prove the remote branch actually contains the work:

```bash
git fetch origin
git rev-parse HEAD
git rev-parse origin/codex-v1
git diff --quiet HEAD origin/codex-v1

git show origin/codex-v1:packages/codex-bridge/package.json >/dev/null
git show origin/codex-v1:package.json | grep '"@openai/codex"'
```

Do not report completion unless all remote verification commands succeed.

At the end, report:
- files changed,
- typecheck result,
- Codex bridge test result,
- intentionally retained Genspark-only external services,
- exact pushed commit SHA,
- confirmation that `HEAD == origin/codex-v1`,
- any remaining limitation needing Windows/macOS real-device validation.
