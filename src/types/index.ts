export type ToolCallStatus = 'pending' | 'running' | 'done' | 'error' | 'denied'

export interface ToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  status: ToolCallStatus
  result?: string
  diff?: string | null
}

export type MessageSegment =
  | { kind: 'text'; id: string; content: string }
  | { kind: 'thinking'; id: string; content: string }
  | { kind: 'tool'; id: string; call: ToolCallRecord }

/** Image attached to a user message (paste / drop / file picker). The
 *  `dataUrl` is what we send to providers — base64-encoded so it round-trips
 *  through SQLite and cleanly renders as an `<img src>` on reload. We keep
 *  `mediaType` separate because Anthropic's API wants the bare MIME type
 *  alongside the raw base64 (no data:-prefix), so we slice it back out at
 *  send time rather than re-parsing the data URL each iteration. */
export interface ImageAttachment {
  id: string
  dataUrl: string
  mediaType: string
  name?: string
  width?: number
  height?: number
  sizeBytes?: number
}

export interface ChatMessage {
  id: string
  type: 'user' | 'assistant' | 'error' | 'tool'
  content: string
  timestamp: number
  toolCalls?: ToolCallRecord[]
  toolCallId?: string
  /** Ordered segments preserving the temporal interleaving of text + tool
   *  calls + thinking. When present, renderers should prefer this over
   *  `content`/`toolCalls` which are flattened for backcompat. */
  segments?: MessageSegment[]
  /** Images attached to this user message. Persisted with the session. */
  images?: ImageAttachment[]
  /** For error messages, classifies the failure mode so the UI can show
   *  actionable recovery (e.g. context_overflow → "Compact session" button).
   *  Optional and additive; existing errors that don't classify still
   *  render as the generic red banner. */
  errorKind?: 'context_overflow' | 'auth' | 'rate_limit' | 'network' | 'generic'
  /** The user message that triggered this error. Used to retry the same
   *  prompt against a freshly compacted session without making the user
   *  re-type. */
  retryPrompt?: string
}

export type SessionMode = 'code' | 'chat'

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
  /**
   * 'code' (default) — full coding agent with filesystem/shell tools.
   * 'chat' — plain conversational LLM with web research only, no filesystem.
   */
  mode: SessionMode
}

export interface Theme {
  key?: string
  name: string
  description?: string
  /** When true, the theme is treated as a light-mode theme. Used to derive
   *  the right direction for surface tints (cards, raised surfaces, user-
   *  message bubbles): dark themes get a slightly LIGHTER tint relative to
   *  the bg; light themes get a slightly DARKER tint. Without this flag a
   *  light theme would still render dark cards on a light background. */
  isLight?: boolean
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
    /** Optional explicit overrides. If omitted, applyThemeToDom derives
     *  these from `bg` + `isLight` so theme authors don't have to think
     *  about them — but light themes that want a specific paper tint or
     *  warm cream card color can set them explicitly. */
    bgRaised?: string
    bubble?: string
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
