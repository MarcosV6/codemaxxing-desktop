import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/appStore'
import { ChatArea } from '../Chat/ChatArea'
import { ResizeHandle } from '../Shared/Resizable'
import { useResizablePanel } from '../Shared/useResizablePanel'
import { AssistantModelPicker } from '../Shared/AssistantModelPicker'
import { MessageSquare, Plus, ChevronRight } from 'lucide-react'

/**
 * The docked, resizable assistant shown on the right of a full-page workspace
 * (Documents / Email / Calendar / Notes). It's the normal agent chat — which
 * carries the workspace's acting tools — so it can read and change what's open.
 * Collapses to a thin rail so the content can take the full width; the state is
 * shared across every workspace.
 */
export function WorkspaceAssistant({ onNewSession, hint }: { onNewSession: () => void; hint?: string }) {
  const activeSession = useAppStore((s) => s.activeSession)
  const dock = useResizablePanel({ storageKey: 'workspace-assistant', defaultWidth: 384, min: 300, max: 680, dock: 'right' })
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('workspace-assistant-collapsed') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('workspace-assistant-collapsed', collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  if (collapsed) {
    return (
      <aside className="flex flex-col items-center shrink-0 h-full pt-2" style={{ width: 40, backgroundColor: 'var(--theme-bg-subtle)', borderLeft: '1px solid var(--theme-border)' }}>
        <button onClick={() => setCollapsed(false)} className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors" style={{ color: 'var(--theme-primary)' }} title="Show assistant">
          <MessageSquare size={15} />
        </button>
      </aside>
    )
  }

  return (
    <aside
      className="relative flex flex-col h-full shrink-0"
      style={{ width: dock.width, minWidth: 300, backgroundColor: 'var(--theme-bg-subtle)', borderLeft: '1px solid var(--theme-border)' }}
    >
      <ResizeHandle handleProps={dock.handleProps} label="assistant" />
      <div className="h-10 flex items-center gap-1.5 px-2.5 shrink-0" style={{ borderBottom: '1px solid var(--theme-hairline)' }}>
        <MessageSquare size={13} style={{ color: 'var(--theme-primary)', flexShrink: 0 }} />
        <span className="text-[12px] font-medium shrink-0" style={{ color: 'var(--theme-text)' }}>Assistant</span>
        <AssistantModelPicker />
        {hint && <span className="text-[10px] opacity-50 ml-0.5 truncate">{hint}</span>}
        <span className="flex-1" />
        <button onClick={() => setCollapsed(true)} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors shrink-0" style={{ color: 'var(--theme-muted)' }} title="Collapse">
          <ChevronRight size={14} />
        </button>
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
