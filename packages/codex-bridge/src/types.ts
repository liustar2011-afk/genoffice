import type { AgentMessage, AgentToolCall, AgentToolDef, AgentToolResult } from '@genoffice/agent-core'

export type RpcId = number | string

export interface CodexAccountStatus {
  loggedIn: boolean
  authType?: 'chatgpt' | 'apiKey' | 'amazonBedrock'
  email?: string
  planType?: string
}

export interface CodexLoginStart {
  loginId?: string
  authUrl?: string
  verificationUrl?: string
  userCode?: string
}

export interface CodexStreamOptions {
  system: string
  messages: AgentMessage[]
  tools: AgentToolDef[]
  model?: string
  signal?: AbortSignal
  onDelta(text: string): void
  onToolRequest(call: AgentToolCall): Promise<AgentToolResult>
  onActivity?(): void
}

export interface CodexTurnHandle {
  threadId: string
  turnId: string
}

export interface CodexDynamicTool {
  type: 'function'
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
