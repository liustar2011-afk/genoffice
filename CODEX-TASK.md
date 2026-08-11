# Codex task: finish GenOffice Codex V1 integration

Work ONLY on branch `codex-v1` of `liustar2011-afk/genoffice`. Do not modify `main`.

## Goal
Finish the prepared GenOffice V1 migration so the core AI/agent runtime uses official OpenAI Codex `app-server` + ChatGPT login instead of Genspark for core LLM/agent execution, while preserving GenOffice Office editing skills/tools.

## Prepared migration payload
The exact migration script is stored as Base64 chunks under:

`tools/codex-v1-parts-b64/*.b64`

Reconstruct it in lexical order and decode it to `/tmp/apply-codex-v1.mjs`:

```bash
cat tools/codex-v1-parts-b64/*.b64 | base64 -d > /tmp/apply-codex-v1.mjs
node --check /tmp/apply-codex-v1.mjs
```

If GNU `base64 -d` is unavailable, decode with Node.js instead.

## Execute
1. Confirm current branch is `codex-v1` and repository is clean except for the prepared migration files.
2. Reconstruct `/tmp/apply-codex-v1.mjs` from the Base64 chunks.
3. Run:

```bash
node /tmp/apply-codex-v1.mjs .
```

4. Install/update dependencies and lockfile:

```bash
npm install --ignore-scripts
```

5. Verify the project-local Codex binary exists and reports version 0.146.0 (or the exact compatible package version pinned by the migration):

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
- Keep Genspark-only external capabilities (such as legacy image/media/cloud conversion/project services) isolated where V1 has no equivalent; they must not remain the core LLM provider.
- Pin the Codex protocol/runtime compatibility to the prepared V1 baseline (`rust-v0.146.0` / npm `@openai/codex` 0.146.0) unless a concrete build issue requires a narrowly justified update.
- Windows x64 and macOS Apple Silicon packaging must include the compatible Codex runtime so packaged GenOffice does not depend on system PATH/global Codex.
- Source development should prefer the project-local Codex binary.

## Clean up before final commit
Remove migration scaffolding after the migration has been successfully applied and verified:

```bash
rm -rf tools/codex-v1-parts tools/codex-v1-parts-b64
rm -f .github/workflows/apply-codex-v1.yml
rm -f CODEX-TASK.md
```

Do not remove real source code introduced by the migration.

## Final verification
Run again after cleanup:

```bash
npm run typecheck
npm run test -w @genoffice/codex-bridge
```

Review `git diff` for accidental changes and secrets.

## Commit and push
Commit all verified source/lockfile changes to `codex-v1` with:

`feat: integrate Codex app-server with ChatGPT login`

Push to `origin/codex-v1`.

At the end, report:
- files changed,
- tests/typecheck results,
- any intentionally retained Genspark-only external services,
- exact commit SHA,
- any remaining limitation that needs Windows/macOS real-device validation.
