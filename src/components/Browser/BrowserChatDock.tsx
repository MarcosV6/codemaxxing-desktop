import { useAppStore } from '../../store/appStore'
import { ChatArea } from '../Chat/ChatArea'
import { useResizablePanel, ResizeHandle } from '../Shared/Resizable'
import { MessageSquare, Plus, ArrowRight } from 'lucide-react'

/**
 * The chat side-dock shown in Browser view. It's the normal agent chat (so it
 * already has the browser_* tools) rendered in a resizable right panel — the
 * "open a chat that interacts with the browser" surface.
 */
export function BrowserChatDock({ onNewSession }: { onNewSession: () => void }) {
  const activeSession = useAppStore((s) => s.activeSession)
  const dock = useResizablePanel({ storageKey: 'browser-chat', defaultWidth: 440, min: 320, max: 820, dock: 'right' })

  return (
    <aside
      className="relative flex flex-col shrink-0 h-full"
      style={{ width: dock.width, backgroundColor: 'var(--theme-bg-subtle)', borderLeft: '1px solid var(--theme-border)' }}
    >
      <ResizeHandle handleProps={dock.handleProps} label="chat dock" />
      <div className="h-10 flex items-center gap-2 px-3 shrink-0" style={{ borderBottom: '1px solid var(--theme-hairline)' }}>
        <MessageSquare size={13} style={{ color: 'var(--theme-primary)' }} />
        <span className="text-[12px] font-medium" style={{ color: 'var(--theme-text)' }}>Chat</span>
        <span className="text-[10.5px] opacity-50 ml-auto flex items-center gap-1">drives the browser <ArrowRight size={10} /></span>
      </div>
      <div className="flex-1 overflow-hidden">
        {activeSession ? (
          <ChatArea />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--theme-muted)' }}>
              Start a chat and ask the agent to browse, read pages, and click for you.
            </p>
            <button
              onClick={onNewSession}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}
            >
              <Plus size={13} /> New session
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
