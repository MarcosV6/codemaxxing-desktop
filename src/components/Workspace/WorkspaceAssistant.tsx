import { useAppStore } from '../../store/appStore'
import { ChatArea } from '../Chat/ChatArea'
import { useResizablePanel, ResizeHandle } from '../Shared/Resizable'
import { MessageSquare, Plus } from 'lucide-react'

/**
 * The docked, resizable assistant shown on the right of a full-page workspace
 * (Documents / Email / Calendar / Notes). It's the normal agent chat — which
 * carries the workspace's acting tools — so it can read and change what's open.
 */
export function WorkspaceAssistant({ onNewSession, hint }: { onNewSession: () => void; hint?: string }) {
  const activeSession = useAppStore((s) => s.activeSession)
  const dock = useResizablePanel({ storageKey: 'workspace-assistant', defaultWidth: 384, min: 300, max: 680, dock: 'right' })

  return (
    <aside
      className="relative flex flex-col h-full shrink-0"
      style={{ width: dock.width, minWidth: 300, backgroundColor: 'var(--theme-bg-subtle)', borderLeft: '1px solid var(--theme-border)' }}
    >
      <ResizeHandle handleProps={dock.handleProps} label="assistant" />
      <div className="h-10 flex items-center gap-2 px-3 shrink-0" style={{ borderBottom: '1px solid var(--theme-hairline)' }}>
        <MessageSquare size={13} style={{ color: 'var(--theme-primary)' }} />
        <span className="text-[12px] font-medium" style={{ color: 'var(--theme-text)' }}>Assistant</span>
        {hint && <span className="text-[10px] opacity-50 ml-0.5 truncate">{hint}</span>}
      </div>
      <div className="flex-1 overflow-hidden">
        {activeSession ? (
          <ChatArea />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--theme-muted)' }}>
              Start a chat and the agent can do the work here for you.
            </p>
            <button onClick={onNewSession} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-opacity hover:opacity-90" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>
              <Plus size={13} /> New session
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
