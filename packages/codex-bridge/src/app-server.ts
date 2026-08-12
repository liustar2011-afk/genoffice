import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  CodexAccountStatus,
  CodexDynamicTool,
  CodexLoginStart,
  CodexStreamOptions,
  CodexTurnHandle,
  RpcId,
} from './types'
import type { AgentMessage, AgentToolCall, AgentToolDef, AgentToolResult } from '@genoffice/agent-core'

type JsonRecord = Record<string, unknown>

interface RpcError {
  code?: number
  message?: string
  data?: unknown
}

interface RpcMessage {
  id?: RpcId
  method?: string
  params?: unknown
  result?: unknown
  error?: RpcError
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
}

interface ActiveTurn {
  threadId: string
  turnId?: string
  options: CodexStreamOptions
  resolve(): void
  reject(error: Error): void
  finalTextSeen: boolean
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function rpcErrorMessage(error: RpcError | undefined, fallback: string): string {
  if (!error) return fallback
  const details = typeof error.data === 'string' ? ` | ${error.data}` : ''
  return `${error.message || fallback}${details}`
}

interface CodexBinarySpec {
  command: string
  shell: boolean
  argsPrefix?: string[]
  env?: NodeJS.ProcessEnv
}

const CODEX_PLATFORM = {
  'darwin:arm64': { packageName: '@openai/codex-darwin-arm64', triple: 'aarch64-apple-darwin' },
  'darwin:x64': { packageName: '@openai/codex-darwin-x64', triple: 'x86_64-apple-darwin' },
  'win32:x64': { packageName: '@openai/codex-win32-x64', triple: 'x86_64-pc-windows-msvc' },
  'win32:arm64': { packageName: '@openai/codex-win32-arm64', triple: 'aarch64-pc-windows-msvc' },
  'linux:x64': { packageName: '@openai/codex-linux-x64', triple: 'x86_64-unknown-linux-musl' },
  'linux:arm64': { packageName: '@openai/codex-linux-arm64', triple: 'aarch64-unknown-linux-musl' },
} as const

function packedCodexBinary(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (!resourcesPath) return null
  const platform = CODEX_PLATFORM[`${process.platform}:${process.arch}` as keyof typeof CODEX_PLATFORM]
  if (!platform) return null
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const path = join(
    resourcesPath,
    'codex',
    'node_modules',
    platform.packageName,
    'vendor',
    platform.triple,
    'bin',
    executable,
  )
  return existsSync(path) ? path : null
}

/**
 * Resolve Codex without reading or copying auth tokens. The bridge always delegates
 * authentication and token refresh to the official Codex process.
 */
export function resolveCodexBinary(): CodexBinarySpec {
  const configured = process.env.CODEX_BINARY?.trim()
  if (configured) {
    return { command: configured, shell: process.platform === 'win32' && /\.cmd$/i.test(configured) }
  }

  // Packaged GenOffice builds carry the official platform-native Codex package
  // under Resources/codex. Prefer it over PATH so end users do not need a separate install.
  const packed = packedCodexBinary()
  if (packed) return { command: packed, shell: false }

  const localBin = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex')
  const candidates =
    process.platform === 'win32'
      ? [
          localBin,
          process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'codex.cmd') : '',
          process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm', 'codex.cmd') : '',
        ]
      : [
          localBin,
          '/opt/homebrew/bin/codex',
          '/usr/local/bin/codex',
          join(homedir(), '.local', 'bin', 'codex'),
        ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return { command: candidate, shell: process.platform === 'win32' && /\.cmd$/i.test(candidate) }
    }
  }

  // PATH fallback. On Windows npm installs a codex.cmd shim, which requires shell execution.
  return { command: process.platform === 'win32' ? 'codex.cmd' : 'codex', shell: process.platform === 'win32' }
}

export function agentToolsToCodex(tools: AgentToolDef[]): CodexDynamicTool[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

function stringifyToolCalls(message: Extract<AgentMessage, { role: 'assistant' }>): string {
  if (!message.toolCalls?.length) return ''
  return `\n[tool calls]\n${message.toolCalls
    .map((call) => `${call.name}: ${JSON.stringify(call.input)}`)
    .join('\n')}`
}

/**
 * GenOffice owns its conversation history. Codex app-server owns one model turn.
 * To avoid a second persistent conversation store, each provider turn is an ephemeral
 * Codex thread and receives the existing GenOffice history as a serialized transcript.
 */
export function serializeAgentHistory(messages: readonly AgentMessage[]): string {
  const blocks: string[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      blocks.push(`USER:\n${message.text}`)
    } else if (message.role === 'assistant') {
      blocks.push(`ASSISTANT:\n${message.text}${stringifyToolCalls(message)}`)
    } else {
      blocks.push(
        `TOOL RESULTS:\n${message.results
          .map((result) => `${result.name}${result.isError ? ' [error]' : ''}: ${result.output}`)
          .join('\n')}`,
      )
    }
  }
  return blocks.join('\n\n---\n\n')
}

function imagesFromMessages(messages: readonly AgentMessage[]): Array<{ type: 'image'; url: string }> {
  const images: Array<{ type: 'image'; url: string }> = []
  // The current user turn is the only place GenOffice adds fresh inline images.
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  if (latestUser?.role === 'user') {
    for (const image of latestUser.images ?? []) {
      images.push({ type: 'image', url: `data:${image.mime};base64,${image.base64}` })
    }
  }
  return images
}

const OFFICE_RUNTIME_INSTRUCTIONS = `
You are embedded inside an Office document editor. GenOffice, not Codex, owns the document model.
For document edits, reads, selections, formatting, tables, slides, workbook cells, PDF objects, or other artifact operations, use the dynamic tools supplied by the client.
Do not use shell commands or direct filesystem edits as a substitute for those dynamic Office tools.
Treat the serialized USER / ASSISTANT / TOOL RESULTS transcript in the user input as conversation history. The final USER section is the current request.
When an Office tool reports an error, repair the arguments and retry if useful. When the requested edit is complete, give a concise user-facing completion message.
`.trim()

export class CodexAppServer {
  private process: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private stderrTail: string[] = []
  private nextId = 1
  private pending = new Map<RpcId, PendingRequest>()
  private activeTurns = new Map<string, ActiveTurn>()
  private startPromise: Promise<void> | null = null

  async start(): Promise<void> {
    // A second caller may arrive after the child process is spawned but before the
    // initialize/initialized handshake has finished. Always join that in-flight start.
    if (this.startPromise) return this.startPromise
    if (this.process) return
    this.startPromise = this.startInner()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async startInner(): Promise<void> {
    const binary = resolveCodexBinary()
    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(binary.command, [...(binary.argsPrefix ?? []), 'app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: binary.shell,
        env: binary.env ?? process.env,
      })
    } catch (error) {
      throw new Error(`Failed to launch Codex. Install/login to Codex first or set CODEX_BINARY. ${String(error)}`)
    }
    this.process = proc

    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => this.consumeStdout(chunk))
    proc.stderr.on('data', (chunk: string) => {
      this.stderrTail.push(...String(chunk).split(/\r?\n/).filter(Boolean))
      if (this.stderrTail.length > 40) this.stderrTail.splice(0, this.stderrTail.length - 40)
    })
    proc.once('error', (cause: Error) => {
      const error = new Error(
        `Failed to launch Codex app-server. Install the official Codex CLI or set CODEX_BINARY. ${cause.message}`,
        { cause },
      )
      this.process = null
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
      for (const turn of this.activeTurns.values()) turn.reject(error)
      this.activeTurns.clear()
    })
    proc.once('exit', (code: number | null, signal: string | null) => {
      const tail = this.stderrTail.slice(-8).join(' | ')
      const error = new Error(
        `Codex app-server exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}${tail ? `: ${tail}` : ''}`,
      )
      this.process = null
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
      for (const turn of this.activeTurns.values()) turn.reject(error)
      this.activeTurns.clear()
    })

    await this.request('initialize', {
      clientInfo: {
        name: 'genoffice_codex_bridge',
        title: 'GenOffice Codex Bridge',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    })
    this.notify('initialized')
  }

  stop(): void {
    this.process?.kill()
    this.process = null
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline < 0) break
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!line) continue
      let message: RpcMessage
      try {
        message = JSON.parse(line) as RpcMessage
      } catch {
        continue
      }
      void this.routeMessage(message)
    }
  }

  private async routeMessage(message: RpcMessage): Promise<void> {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(rpcErrorMessage(message.error, 'Codex RPC error')))
      else pending.resolve(message.result)
      return
    }

    // Server-initiated dynamic tool request.
    if (message.id !== undefined && message.method === 'item/tool/call') {
      await this.handleToolRequest(message.id, asRecord(message.params))
      return
    }

    if (!message.method) return
    this.handleNotification(message.method, asRecord(message.params))
  }

  private async handleToolRequest(serverRequestId: RpcId, params: JsonRecord): Promise<void> {
    const threadId = asString(params.threadId)
    const turn = this.activeTurns.get(threadId)
    if (!turn) {
      this.respond(serverRequestId, {
        contentItems: [{ type: 'inputText', text: 'GenOffice no longer owns this Codex thread.' }],
        success: false,
      })
      return
    }

    const call: AgentToolCall = {
      id: asString(params.callId) || `codex-tool-${Date.now()}`,
      name: asString(params.tool),
      input: asRecord(params.arguments),
    }

    turn.options.onActivity?.()
    let result: AgentToolResult
    try {
      result = await turn.options.onToolRequest(call)
    } catch (error) {
      result = {
        id: call.id,
        name: call.name,
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      }
    }
    turn.options.onActivity?.()
    this.respond(serverRequestId, {
      contentItems: [{ type: 'inputText', text: result.output }],
      success: !result.isError,
    })
  }

  private handleNotification(method: string, params: JsonRecord): void {
    const threadId = asString(params.threadId)
    const turn = threadId ? this.activeTurns.get(threadId) : undefined
    if (!turn) return

    turn.options.onActivity?.()

    if (method === 'item/agentMessage/delta') {
      const delta = asString(params.delta)
      if (delta) {
        turn.finalTextSeen = true
        turn.options.onDelta(delta)
      }
      return
    }

    if (method !== 'turn/completed') return
    const turnPayload = asRecord(params.turn)
    const status = asString(turnPayload.status)
    if (status === 'completed') {
      // Normal operation streams item/agentMessage/delta. The official app-server contract
      // also includes the final agent message in turn/completed as a summary fallback.
      if (!turn.finalTextSeen && Array.isArray(turnPayload.items)) {
        for (let i = turnPayload.items.length - 1; i >= 0; i--) {
          const item = asRecord(turnPayload.items[i])
          if (asString(item.type) !== 'agentMessage') continue
          const text = asString(item.text)
          if (text) {
            turn.finalTextSeen = true
            turn.options.onDelta(text)
          }
          break
        }
      }
      this.activeTurns.delete(threadId)
      turn.resolve()
    } else if (status === 'interrupted') {
      this.activeTurns.delete(threadId)
      turn.resolve()
    } else {
      const error = asRecord(turnPayload.error)
      this.activeTurns.delete(threadId)
      turn.reject(new Error(asString(error.message) || `Codex turn failed (${status || 'unknown'})`))
    }
  }

  private write(message: unknown): void {
    if (!this.process || this.process.stdin.destroyed) throw new Error('Codex app-server is not running')
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.write(params === undefined ? { method, id } : { method, id, params })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  private notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params })
  }

  private respond(id: RpcId, result: unknown): void {
    this.write({ id, result })
  }

  async accountStatus(refreshToken = false): Promise<CodexAccountStatus> {
    await this.start()
    const result = asRecord(await this.request('account/read', { refreshToken }))
    const account = asRecord(result.account)
    const type = asString(account.type)
    if (!type) return { loggedIn: false }
    if (type === 'chatgpt') {
      return {
        loggedIn: true,
        authType: 'chatgpt',
        ...(asString(account.email) ? { email: asString(account.email) } : {}),
        ...(asString(account.planType) ? { planType: asString(account.planType) } : {}),
      }
    }
    if (type === 'apiKey') return { loggedIn: true, authType: 'apiKey' }
    if (type === 'amazonBedrock') return { loggedIn: true, authType: 'amazonBedrock' }
    return { loggedIn: true }
  }

  async loginWithChatGPT(): Promise<CodexLoginStart> {
    await this.start()
    const result = asRecord(
      await this.request('account/login/start', {
        type: 'chatgpt',
        codexStreamlinedLogin: true,
        useHostedLoginSuccessPage: true,
        appBrand: 'codex',
      }),
    )
    const type = asString(result.type)
    if (type !== 'chatgpt') throw new Error(`Unexpected Codex login response: ${type || 'empty'}`)
    return {
      loginId: asString(result.loginId),
      authUrl: asString(result.authUrl),
    }
  }

  async logout(): Promise<void> {
    await this.start()
    await this.request('account/logout')
  }

  async stream(options: CodexStreamOptions): Promise<CodexTurnHandle> {
    await this.start()
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')

    const requestedModel = options.model && options.model !== 'auto' ? options.model : undefined
    const threadResult = asRecord(
      await this.request('thread/start', {
        ...(requestedModel ? { model: requestedModel } : {}),
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
        developerInstructions: `${OFFICE_RUNTIME_INSTRUCTIONS}\n\nGENOFFICE SKILL INSTRUCTIONS:\n${options.system}`,
        dynamicTools: agentToolsToCodex(options.tools),
      }),
    )
    const thread = asRecord(threadResult.thread)
    const threadId = asString(thread.id)
    if (!threadId) throw new Error('Codex thread/start returned no thread id')

    let resolveDone!: () => void
    let rejectDone!: (error: Error) => void
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve
      rejectDone = reject
    })
    const active: ActiveTurn = {
      threadId,
      options,
      resolve: resolveDone,
      reject: rejectDone,
      finalTextSeen: false,
    }
    this.activeTurns.set(threadId, active)

    const transcript = serializeAgentHistory(options.messages)
    const input: unknown[] = [
      { type: 'text', text: transcript, text_elements: [] },
      ...imagesFromMessages(options.messages),
    ]

    let turnResult: JsonRecord
    try {
      turnResult = asRecord(
        await this.request('turn/start', {
          threadId,
          input,
          ...(requestedModel ? { model: requestedModel } : {}),
        }),
      )
    } catch (error) {
      this.activeTurns.delete(threadId)
      throw error
    }
    const turn = asRecord(turnResult.turn)
    const turnId = asString(turn.id)
    if (!turnId) {
      this.activeTurns.delete(threadId)
      throw new Error('Codex turn/start returned no turn id')
    }
    active.turnId = turnId

    const abort = () => {
      if (!this.activeTurns.has(threadId)) return
      void this.request('turn/interrupt', { threadId, turnId }).catch(() => {})
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      await done
    } finally {
      options.signal?.removeEventListener('abort', abort)
      this.activeTurns.delete(threadId)
    }
    return { threadId, turnId }
  }
}

let singleton: CodexAppServer | undefined

export function codexAppServer(): CodexAppServer {
  singleton ??= new CodexAppServer()
  return singleton
}
