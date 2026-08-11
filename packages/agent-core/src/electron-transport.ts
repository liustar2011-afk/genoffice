import type {
  AgentStreamRequest,
  AgentToolCall,
  AgentToolDef,
  AgentToolResult,
  AgentTransport,
  AgentMessage,
} from './types'

/**
 * One streamed chunk pushed back over an Electron IPC bridge. Structurally
 * identical to ai-provider's AiStreamChunk; declared here so this package
 * stays dependency-free.
 */
export interface IpcStreamChunk {
  requestId: string
  /** 'ping' = wire-level keepalive; re-arms the silence watchdog and carries no payload */
  type: 'delta' | 'tool-call' | 'tool-request' | 'done' | 'error' | 'ping'
  text?: string
  toolCall?: AgentToolCall
  /** Correlates a Codex server-side dynamic tool request with the result sent back over IPC. */
  toolRequestId?: string
  error?: string
  /** machine-readable error cause; maps to the localized timeout/credits message */
  errorCode?: 'timeout' | 'credits'
  /** normalized stop reason on 'done' ('max_tokens' = cut off by the token limit) */
  stopReason?: string
}

/** The request forwarded to the main process to start one streaming turn. */
export interface IpcStreamStart<S> {
  requestId: string
  settings: S
  system: string
  messages: AgentMessage[]
  tools: AgentToolDef[]
}

/**
 * Renderer-side silence watchdog: the main process re-arms it with keepalive
 * pings on wire activity, so firing means the turn is dead (main-process stall,
 * lost chunks) and the run must fail instead of leaving the UI busy forever.
 * Longer than the main-process idle timeout (180s) so that one (localized) wins.
 */
export const IPC_STREAM_SILENCE_TIMEOUT_MS = 240_000

export interface IpcTransportOptions<S> {
  /** subscribe to stream chunks; returns the unsubscribe function */
  onStream(listener: (chunk: IpcStreamChunk) => void): () => void
  /** forward the start request to the main process; a returned promise reports handler failure */
  start(request: IpcStreamStart<S>): void | Promise<unknown>
  /** abort the in-flight turn in the main process */
  cancel(requestId: string): void
  /** Return a runtime-managed local tool result to the main process. Optional for legacy providers. */
  respondTool?(requestId: string, toolRequestId: string, result: AgentToolResult): void | Promise<unknown>
  getSettings(): S
  /** localized fallback when an error chunk carries no message */
  unknownErrorText(): string
  /** localized message for timeouts (errorCode 'timeout' and the silence watchdog) */
  timeoutErrorText?(): string
  /** localized message for exhausted credits (errorCode 'credits') */
  creditsErrorText?(): string
}

/**
 * AgentTransport over an Electron IPC bridge: the main process talks to the
 * LLM providers (avoids renderer CORS) and streams chunks back per requestId.
 * Each app wires in its own preload bridge and i18n via the options.
 */
export function createIpcTransport<S>(options: IpcTransportOptions<S>): AgentTransport {
  const timeoutText = () => options.timeoutErrorText?.() ?? options.unknownErrorText()
  return {
    stream(request: AgentStreamRequest, cb) {
      const requestId = crypto.randomUUID()
      let settled = false
      let silenceTimer: ReturnType<typeof setTimeout> | undefined
      const settle = () => {
        settled = true
        clearTimeout(silenceTimer)
        unsubscribe()
      }
      const fail = (error: string) => {
        if (settled) return
        settle()
        cb.onError(error)
      }
      const armSilence = () => {
        clearTimeout(silenceTimer)
        silenceTimer = setTimeout(() => {
          options.cancel(requestId)
          fail(timeoutText())
        }, IPC_STREAM_SILENCE_TIMEOUT_MS)
      }
      const unsubscribe = options.onStream((chunk) => {
        if (chunk.requestId !== requestId || settled) return
        if (chunk.type === 'ping') {
          armSilence()
        } else if (chunk.type === 'delta') {
          armSilence()
          cb.onDelta(chunk.text ?? '')
        } else if (chunk.type === 'tool-call') {
          armSilence()
          if (chunk.toolCall) cb.onToolCall(chunk.toolCall)
        } else if (chunk.type === 'tool-request') {
          armSilence()
          const call = chunk.toolCall
          const toolRequestId = chunk.toolRequestId
          if (!call || !toolRequestId || !cb.onToolRequest || !options.respondTool) {
            fail('This AI runtime requested a local tool, but the renderer bridge is not configured for runtime-managed tools.')
            return
          }
          void cb
            .onToolRequest(call)
            .then((result) => options.respondTool!(requestId, toolRequestId, result))
            .catch((error: unknown) =>
              options.respondTool!(requestId, toolRequestId, {
                id: call.id,
                name: call.name,
                output: error instanceof Error ? error.message : String(error),
                isError: true,
              }),
            )
            .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)))
        } else if (chunk.type === 'done') {
          settle()
          if (chunk.stopReason) cb.onStopReason?.(chunk.stopReason)
          cb.onDone()
        } else {
          settle()
          cb.onError(
            chunk.errorCode === 'timeout'
              ? timeoutText()
              : chunk.errorCode === 'credits'
                ? (options.creditsErrorText?.() ?? chunk.error ?? options.unknownErrorText())
                : (chunk.error ?? options.unknownErrorText()),
          )
        }
      })
      armSilence()
      try {
        // a rejected/thrown start would otherwise leave the run pending until the watchdog
        Promise.resolve(
          options.start({
            requestId,
            settings: options.getSettings(),
            system: request.system,
            messages: request.messages,
            tools: request.tools,
          }),
        ).catch((err: unknown) => {
          fail(err instanceof Error ? err.message : options.unknownErrorText())
        })
      } catch (err) {
        fail(err instanceof Error ? err.message : options.unknownErrorText())
      }
      return { cancel: () => options.cancel(requestId) }
    },
  }
}
