# GenOffice × Codex V1

This branch replaces GenOffice's **core LLM/agent runtime** with the official OpenAI Codex `app-server` flow and ChatGPT account login, while retaining GenOffice's existing local Office skills/tools.

## Recommended: one-command finalize

Use this on a **fresh, clean checkout of branch `codex-v1`**. It installs dependencies, applies the migration, runs type checks/tests, commits the generated source changes, and pushes them back to `origin/codex-v1`.

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\finalize-codex-windows.ps1
```

### macOS

```bash
bash ./finalize-codex-macos.sh
```

Git authentication must already be available locally for the final push. If the push step cannot authenticate, the verified source changes remain in the local checkout and can be pushed later.

## Setup without automatic Git commit/push

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-codex-windows.ps1
```

### macOS

```bash
bash ./setup-codex-macos.sh
```

The setup runs `npm install`. The root `postinstall` hook applies the Codex integration patches to the checked-out GenOffice source, followed by workspace type checking and the Codex bridge tests.

## What is integrated

- `@genoffice/codex-bridge` is a real workspace package committed in this branch.
- Electron main launches official Codex `app-server` over stdio.
- ChatGPT login uses Codex account RPC; the integration does not copy or scrape Codex access tokens.
- Docs, Sheets, Slides, PDF and Markdown share the Codex runtime through the existing GenOffice AI IPC layer.
- Existing `AgentSkill` Office tools are exposed to Codex as Dynamic Tools and execute locally.
- Windows x64 and macOS Apple Silicon release packaging includes the compatible Codex native runtime.
- Codex runtime compatibility is pinned to `@openai/codex` `0.146.0` for V1.

## Intentionally retained Genspark services

V1 does **not** remove external Genspark-only services that have no direct Codex equivalent, such as legacy image/media/cloud conversion/project services. They are no longer the core LLM/agent provider.

## Source layout

The bridge and Docs adapter are committed directly. The remaining upstream files are patched idempotently by:

```bash
npm run codex:apply
```

`npm install` runs the same patch automatically via `postinstall`. The exact migration source is retained as six Base64 chunks under `tools/codex-v1-b64/`; `tools/codex-v1/bootstrap.mjs` reconstructs and executes it in a temporary runtime directory.
