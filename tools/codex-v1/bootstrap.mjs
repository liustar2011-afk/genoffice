#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const repo = resolve(process.argv[2] || process.cwd())
const rawDir = join(repo, 'tools', 'codex-v1-raw')
const runtimeDir = join(repo, 'tools', 'codex-v1', '.runtime')
const scriptDir = join(runtimeDir, 'scripts')
const scriptPath = join(scriptDir, 'apply.mjs')

rmSync(runtimeDir, { recursive: true, force: true })
mkdirSync(scriptDir, { recursive: true })

const parts = readdirSync(rawDir)
  .filter((name) => name.endsWith('.part'))
  .sort()
if (!parts.length) throw new Error(`No readable Codex migration parts found in ${rawDir}`)

const script = parts.map((name) => readFileSync(join(rawDir, name), 'utf8')).join('')
writeFileSync(scriptPath, script)

const syntax = spawnSync(process.execPath, ['--check', scriptPath], { stdio: 'inherit' })
if (syntax.error) throw syntax.error
if (syntax.status !== 0) {
  rmSync(runtimeDir, { recursive: true, force: true })
  process.exit(syntax.status ?? 1)
}

const run = spawnSync(process.execPath, [scriptPath, repo], {
  stdio: 'inherit',
  env: process.env,
})
rmSync(runtimeDir, { recursive: true, force: true })
if (run.error) throw run.error
if (run.status !== 0) process.exit(run.status ?? 1)
