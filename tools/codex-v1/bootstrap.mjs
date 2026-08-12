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

let script = parts.map((name) => readFileSync(join(rawDir, name), 'utf8')).join('')

// The historical readable migration was split at an unfortunate boundary in the
// electron-builder patch. Five target-runtime template expressions in 07.part
// were left unescaped, so the migration process tried to evaluate them itself
// (for example ${codexPlatformPackage}) before that variable exists. Normalize
// only those known generated-code expressions here; 08.part is already escaped.
const generatedTemplateFixes = [
  [
    'codexPlatformPackageByHost[\\`${process.platform}:${process.arch}\\`]',
    'codexPlatformPackageByHost[\\`\\${process.platform}:\\${process.arch}\\`]',
    'Codex platform lookup',
  ],
  [
    '\\`Unsupported Codex packaging host: ${process.platform}/${process.arch}\\`',
    '\\`Unsupported Codex packaging host: \\${process.platform}/\\${process.arch}\\`',
    'unsupported-host diagnostic',
  ],
  [
    '\\`../../node_modules/${codexPlatformPackage}\\`',
    '\\`../../node_modules/\\${codexPlatformPackage}\\`',
    'top-level Codex native package path',
  ],
  [
    '\\`../../node_modules/@openai/codex/node_modules/${codexPlatformPackage}\\`',
    '\\`../../node_modules/@openai/codex/node_modules/\\${codexPlatformPackage}\\`',
    'nested Codex native package path',
  ],
  [
    '\\`Codex native package is missing: ${codexPlatformPackage}. Run npm install before packaging.\\`',
    '\\`Codex native package is missing: \\${codexPlatformPackage}. Run npm install before packaging.\\`',
    'missing-package diagnostic',
  ],
]

for (const [before, after, label] of generatedTemplateFixes) {
  if (!script.includes(before)) {
    throw new Error(`Readable migration compatibility marker not found: ${label}`)
  }
  script = script.replaceAll(before, after)
}

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
if (run.error) {
  rmSync(runtimeDir, { recursive: true, force: true })
  throw run.error
}
if (run.status !== 0) {
  rmSync(runtimeDir, { recursive: true, force: true })
  process.exit(run.status ?? 1)
}

// The Codex account-status handler returns before the retained legacy Genspark
// fallback. TypeScript therefore treats that compatibility block as unreachable
// and no longer narrows `info` through the existing ternary guard. Keep the
// legacy source for easier upstream rebases, but make its already-guarded access
// explicit to the type checker. This does not alter runtime behavior.
const shellMainPath = join(repo, 'apps', 'shell', 'src', 'main', 'index.ts')
let shellMain = readFileSync(shellMainPath, 'utf8')
const legacyInfoAccess = '? { loggedIn: true, email: info.email, creditBalance: info.creditBalance }'
const narrowedLegacyInfoAccess = '? { loggedIn: true, email: info!.email, creditBalance: info!.creditBalance }'
if (shellMain.includes(legacyInfoAccess)) {
  shellMain = shellMain.replaceAll(legacyInfoAccess, narrowedLegacyInfoAccess)
  writeFileSync(shellMainPath, shellMain)
} else if (!shellMain.includes(narrowedLegacyInfoAccess)) {
  rmSync(runtimeDir, { recursive: true, force: true })
  throw new Error('Shell legacy account compatibility marker not found after Codex migration')
}

rmSync(runtimeDir, { recursive: true, force: true })
