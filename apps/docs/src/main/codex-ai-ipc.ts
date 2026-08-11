import { randomUUID } from 'node:crypto'
import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import type { AgentToolCall, AgentToolResult } from '@genoffice/agent-core'
import type { AiChatRequest, AiChatResponse, AiStreamChunk, AiStreamRequest } from '@genoffice/ai-provider'
import { codexAppServer } from '@genoffice/codex-bridge'

const activeCodexStreams = new Map<string, AbortController>()
const pendingToolResults = new Map<
  string,
  {
    requestId: string
    call: AgentToolCall
    resolve(result: AgentToolResult): void
  }
>()

function sendChunk(event: IpcMainInvokeEvent, chunk: AiStreamChunk): void {
  if (!event.sender.isDestroyed()) event.sender.send('ai:stream-chunk', chunk)
}

function cancelPendingTools(requestId: string): void {
  for (const [toolRequestId, pending] of pendingToolResults) {
    if (pending.requestId !== requestId) continue
    pendingToolResults.delete(toolRequestId)
    pending.resolve({
      id: pending.call.id,
      name: pending.call.name,
      output: '(the user stopped the run; this tool was not executed)',
      isError: true,
    })
  }
}

/** Register Codex-specific IPC once, while retaining legacy channel names elsewhere. */
export function registerCodexAiIpc(): void {
  ipcMain.handle('ai:codex-status', async (_event, withEmail?: boolean) => {
    try {
      const status = await codexAppServer().accountStatus(false)
      return {
        loggedIn: status.loggedIn,
        ...(withEmail && status.email ? { email: status.email } : {}),
      }
    } catch {
      return { loggedIn: false }
    }
  })

  ipcMain.handle('ai:codex-login', async () => {
    const login = await codexAppServer().loginWithChatGPT()
    if (login.authUrl) await shell.openExternal(login.authUrl)
    return login
  })

  ipcMain.handle('ai:codex-logout', async () => {
    await codexAppServer().logout()
  })

  ipcMain.handle(
    'ai:codex-tool-result',
    (_event, requestId: string, toolRequestId: string, result: AgentToolResult) => {
      const pending = pendingToolResults.get(toolRequestId)
      if (!pending || pending.requestId !== requestId) return false
      pendingToolResults.delete(toolRequestId)
      pending.resolve(result)
      return true
    },
  )
}

export async function codexChat(request: AiChatRequest): Promise<AiChatResponse> {
  let content = ''
  try {
    const config = request.settings.providers.codex
    await codexAppServer().stream({
      system: request.system,
      messages: [{ role: 'user', text: request.user }],
      tools: [],
      model: config?.model,
      onDelta: (text: string) => {
        content += text
      },
      onToolRequest: async (call: AgentToolCall) => ({
        id: call.id,
        name: call.name,
        output: 'No tools are available in this one-shot request.',
        isError: true,
      }),
    })
    return content ? { ok: true, content } : { ok: false, error: 'Codex returned an empty response' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function streamCodexRequest(
  event: IpcMainInvokeEvent,
  request: AiStreamRequest,
): Promise<void> {
  const controller = new AbortController()
  activeCodexStreams.set(request.requestId, controller)
  const config = request.settings.providers.codex
  let lastPing = 0
  const ping = () => {
    const now = Date.now()
    if (now - lastPing < 5_000) return
    lastPing = now
    sendChunk(event, { requestId: request.requestId, type: 'ping' })
  }

  try {
    await codexAppServer().stream({
      system: request.system,
      messages: request.messages,
      tools: request.tools ?? [],
      model: config?.model,
      signal: controller.signal,
      onDelta: (text: string) => sendChunk(event, { requestId: request.requestId, type: 'delta', text }),
      onActivity: ping,
      onToolRequest: (toolCall: AgentToolCall) =>
        new Promise<AgentToolResult>((resolve) => {
          const toolRequestId = randomUUID()
          pendingToolResults.set(toolRequestId, { requestId: request.requestId, call: toolCall, resolve })
          sendChunk(event, {
            requestId: request.requestId,
            type: 'tool-request',
            toolRequestId,
            toolCall,
          })
        }),
    })
    sendChunk(event, { requestId: request.requestId, type: 'done' })
  } catch (error) {
    if (controller.signal.aborted) {
      sendChunk(event, { requestId: request.requestId, type: 'done' })
    } else {
      sendChunk(event, {
        requestId: request.requestId,
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } finally {
    activeCodexStreams.delete(request.requestId)
    cancelPendingTools(request.requestId)
  }
}

export function cancelCodexStream(requestId: string): void {
  activeCodexStreams.get(requestId)?.abort()
  cancelPendingTools(requestId)
}
