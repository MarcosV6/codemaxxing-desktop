export type ToolCallStatus = 'pending' | 'running' | 'done' | 'error' | 'denied'

export interface ToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  status: ToolCallStatus
  result?: string
  diff?: string | null
}

export interface ChatMessage {
  id: string
  type: 'user' | 'assistant' | 'error' | 'tool'
  content: string
  timestamp: number
  toolCalls?: ToolCallRecord[]
  toolCallId?: string
}

export interface Session {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  model: string
  provider: string
  cwd: string
  tokenCount: number
  estimatedCost: number
}

export interface Theme {
  key?: string
  name: string
  description?: string
  colors: {
    primary: string
    secondary: string
    muted: string
    text: string
    userInput: string
    response: string
    tool: string
    toolResult: string
    error: string
    success: string
    warning: string
    spinner?: string
    border: string
    suggestion: string
    bg?: string
    bgSubtle?: string
  }
}

export interface Task {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface PendingApproval {
  sessionId: string
  call: {
    id: string
    name: string
    args: Record<string, unknown>
    diff?: string | null
  }
}

export interface PendingMCPApproval {
  token: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface AuthCredentialDisplay {
  provider: string
  method: 'api-key' | 'oauth' | 'setup-token' | 'cached-token'
  apiKey: string
  baseUrl: string
  label?: string
  createdAt: string
}
