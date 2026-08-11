import { describe, expect, it } from 'vitest'
import { agentToolsToCodex, serializeAgentHistory } from '../src/index'

describe('codex bridge protocol mapping', () => {
  it('maps GenOffice tools to Codex dynamic tools without changing the schema', () => {
    expect(
      agentToolsToCodex([
        {
          name: 'replace_text',
          description: 'Replace text in the document',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      ]),
    ).toEqual([
      {
        type: 'function',
        name: 'replace_text',
        description: 'Replace text in the document',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ])
  })

  it('serializes GenOffice-owned history into one ephemeral Codex turn', () => {
    const transcript = serializeAgentHistory([
      { role: 'user', text: 'Polish this paragraph.' },
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: '1', name: 'replace_text', input: { text: 'Rewritten' } }],
      },
      {
        role: 'tool',
        results: [{ id: '1', name: 'replace_text', output: 'ok' }],
      },
      { role: 'user', text: 'Make it shorter.' },
    ])
    expect(transcript).toContain('USER:\nPolish this paragraph.')
    expect(transcript).toContain('replace_text: {"text":"Rewritten"}')
    expect(transcript).toContain('TOOL RESULTS:\nreplace_text: ok')
    expect(transcript).toContain('USER:\nMake it shorter.')
  })
})
