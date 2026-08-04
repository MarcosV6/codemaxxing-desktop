import React from 'react'
import { useAppStore } from '../../store/appStore'
import { ChatArea } from '../Chat/ChatArea'
import { AssistantModelPicker } from '../Shared/AssistantModelPicker'
import { Sparkles, X, Plus, PanelRight, AppWindow } from 'lucide-react'

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
  const iconBtn = 'browser-control w-7 h-7 rounded-lg flex items-center justify-center'

  return (
    <div className="browser-assistant-shell flex flex-col h-full overflow-hidden">
      <div className="h-12 flex items-center gap-2 px-3 shrink-0" style={{ borderBottom: '1px solid var(--theme-hairline)' }}>
        <div
          className="assistant-mark w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ color: 'var(--theme-primary)' }}
        >
          <Sparkles size={13} />
        </div>
        <div className="min-w-0">
          <div className="text-[11.5px] font-medium leading-tight" style={{ color: 'var(--theme-text)' }}>Browse with codemaxxing</div>
          <div className="flex items-center gap-1 mt-0.5 text-[8.5px] font-mono uppercase tracking-wider" style={{ color: 'var(--theme-muted)', opacity: 0.62 }}>
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: 'var(--theme-success)' }} />
            page-aware
          </div>
        </div>
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
            <div className="hero-orbit w-11 h-11 mb-2">
              <div className="assistant-mark w-full h-full rounded-xl flex items-center justify-center" style={{ color: 'var(--theme-primary)' }}>
                <Sparkles size={18} />
              </div>
            </div>
            <p className="text-[12px] leading-relaxed max-w-[240px]" style={{ color: 'var(--theme-muted)' }}>
              Start a chat to have the agent browse, read, and click for you.
            </p>
            <button onClick={onNewSession} className="primary-action flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg text-[12px] font-medium">
              <Plus size={13} /> New session
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
