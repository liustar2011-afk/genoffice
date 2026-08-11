#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const repo = resolve(process.argv[2] || process.cwd())
const payloadDir = join(repo, 'tools', 'codex-v1-b64')
const runtimeDir = join(repo, 'tools', 'codex-v1', '.runtime')
const scriptDir = join(runtimeDir, 'scripts')
const overlayDir = join(runtimeDir, 'overlay')
const scriptPath = join(scriptDir, 'apply.mjs')

rmSync(runtimeDir, { recursive: true, force: true })
mkdirSync(scriptDir, { recursive: true })
mkdirSync(join(overlayDir, 'packages'), { recursive: true })
mkdirSync(join(overlayDir, 'apps', 'docs', 'src', 'main'), { recursive: true })

const chunks = readdirSync(payloadDir)
  .filter((name) => name.endsWith('.b64'))
  .sort()
if (!chunks.length) throw new Error(`No Codex migration payload found in ${payloadDir}`)

const encoded = chunks
  .map((name) => readFileSync(join(payloadDir, name), 'utf8'))
  .join('')
  .replace(/\s+/g, '')
writeFileSync(scriptPath, Buffer.from(encoded, 'base64'))

// The exact migration script expects an overlay next to itself. Build that overlay
// from the real bridge/adapter files committed in this branch, then discard it.
cpSync(join(repo, 'packages', 'codex-bridge'), join(overlayDir, 'packages', 'codex-bridge'), {
  recursive: true,
})
cpSync(
  join(repo, 'apps', 'docs', 'src', 'main', 'codex-ai-ipc.ts'),
  join(overlayDir, 'apps', 'docs', 'src', 'main', 'codex-ai-ipc.ts'),
)

const run = spawnSync(process.execPath, [scriptPath, repo], {
  stdio: 'inherit',
  env: process.env,
})
rmSync(runtimeDir, { recursive: true, force: true })
if (run.error) throw run.error
if (run.status !== 0) process.exit(run.status ?? 1)
