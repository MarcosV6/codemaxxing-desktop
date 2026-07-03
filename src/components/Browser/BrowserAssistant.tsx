import React from 'react'
import { useAppStore } from '../../store/appStore'
import { ChatArea } from '../Chat/ChatArea'
import { AssistantModelPicker } from '../Shared/AssistantModelPicker'
import { MessageSquare, X, Plus, PanelRight, AppWindow } from 'lucide-react'

/**
 * The browser's agent assistant — header (title + model picker + dock toggle)
 * over the active session's ChatArea. Rendered inside either a floating panel
 * or a docked right column by BrowserMode; the dock mode is passed in.
 */
export function BrowserAssistant({ dock, onToggleDock, onClose, onNewSession }: {
  dock: 'float' | 'right'
  onToggleDock: () => void
  onClose: () => void
  onNewSession: () => void
}) {
  const activeSession = useAppStore((s) => s.activeSession)
  const iconBtn = 'w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors'

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--theme-bg-subtle)' }}>
      <div className="h-10 flex items-center gap-1.5 px-2.5 shrink-0" style={{ borderBottom: '1px solid var(--theme-hairline)' }}>
        <MessageSquare size={13} style={{ color: 'var(--theme-primary)', flexShrink: 0 }} />
        <span className="text-[12px] font-medium shrink-0" style={{ color: 'var(--theme-text)' }}>Assistant</span>
        <AssistantModelPicker />
        <span className="flex-1" />
        <button onClick={onToggleDock} className={iconBtn} style={{ color: 'var(--theme-muted)' }} title={dock === 'right' ? 'Float over the page' : 'Dock to the right'}>
          {dock === 'right' ? <AppWindow size={14} /> : <PanelRight size={14} />}
        </button>
        <button onClick={onClose} className={iconBtn} style={{ color: 'var(--theme-muted)' }} title="Close"><X size={14} /></button>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeSession ? (
          <ChatArea />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 px-5 text-center">
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--theme-muted)' }}>
              Start a chat to have the agent browse, read, and click for you.
            </p>
            <button onClick={onNewSession} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>
              <Plus size={13} /> New session
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
