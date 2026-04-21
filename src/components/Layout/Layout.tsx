import React, { useState, useEffect } from 'react'
import { ChatArea } from '../Chat/ChatArea'
import { StatusBar } from '../Shared/StatusBar'
import { PreviewPanel } from '../Preview/PreviewPanel'
import { useAppStore } from '../../store/appStore'
import { Plus, MessageSquare, PanelLeftClose, PanelLeft, PanelRight, Settings, Trash2, Folder, BookmarkCheck, Bot, Clock } from 'lucide-react'
import { ApprovalModal, MCPApprovalModal } from '../Modals/ApprovalModal'
import { SettingsModal } from '../Modals/SettingsModal'
import { NewSessionModal } from '../Modals/NewSessionModal'
import { DrawerModal } from '../Modals/DrawerModal'

export function Layout() {
  const sessionList = useAppStore((s) => s.sessionList)
  const activeSession = useAppStore((s) => s.activeSession)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const switchSession = useAppStore((s) => s.switchSession)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const openSettings = useAppStore((s) => s.openSettings)
  const updateSessionCwd = useAppStore((s) => s.updateSessionCwd)
  const pickDirectory = useAppStore((s) => s.pickDirectory)
  const previewOpen = useAppStore((s) => s.previewOpen)
  const togglePreview = useAppStore((s) => s.togglePreview)
  const setDrawer = useAppStore((s) => s.setDrawer)

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [newSessionOpen, setNewSessionOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        togglePreview()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePreview])

  const handleNewSession = () => {
    setNewSessionOpen(true)
    setSidebarOpen(true)
  }

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    void deleteSession(sessionId)
  }

  const handleChangeCwd = async () => {
    if (!activeSession) return
    const path = await pickDirectory()
    if (path) await updateSessionCwd(activeSession.id, path)
  }

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)' }}
    >
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside
            className="w-[260px] flex flex-col shrink-0"
            style={{ backgroundColor: 'var(--theme-bg-subtle)' }}
          >
            {/* Top: app identity — left space reserved for macOS traffic lights via drag region */}
            <div
              className="h-12 flex items-center justify-between pl-[92px] pr-3"
              style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            >
              <span className="text-[13px] font-medium tracking-tight">codemaxxing</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5 transition-all"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title="Hide sidebar"
              >
                <PanelLeftClose size={14} />
              </button>
            </div>

            {/* New chat */}
            <div className="px-2 pt-2">
              <button
                onClick={handleNewSession}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] transition-colors hover:bg-white/5"
                style={{ color: 'var(--theme-text)' }}
              >
                <Plus size={14} />
                <span>New session</span>
              </button>
            </div>

            {/* Section header */}
            <div className="px-4 pt-5 pb-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider opacity-50">
                Recent
              </span>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto px-2">
              {sessionList.length === 0 ? (
                <div className="px-3 py-8 text-center">
                  <MessageSquare size={18} className="opacity-30 mx-auto mb-2" />
                  <p className="text-[12px] opacity-50">No conversations yet</p>
                </div>
              ) : (
                sessionList.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => void switchSession(s.id)}
                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                      s.id === activeSessionId ? 'bg-white/5' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] truncate leading-tight">{s.title || 'Untitled'}</p>
                    </div>
                    <button
                      onClick={(e) => handleDeleteSession(e, s.id)}
                      className="opacity-0 group-hover:opacity-60 hover:opacity-100 w-5 h-5 rounded flex items-center justify-center transition-all"
                      style={{ color: 'var(--theme-muted)' }}
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Bottom: actions */}
            <div className="p-2 space-y-0.5">
              <button
                onClick={() => setDrawer('checkpoints')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] hover:bg-white/5 transition-colors opacity-80 hover:opacity-100"
              >
                <BookmarkCheck size={14} />
                <span>Checkpoints</span>
              </button>
              <button
                onClick={() => setDrawer('bg-agents')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] hover:bg-white/5 transition-colors opacity-80 hover:opacity-100"
              >
                <Bot size={14} />
                <span>Background agents</span>
              </button>
              <button
                onClick={() => setDrawer('cron')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] hover:bg-white/5 transition-colors opacity-80 hover:opacity-100"
              >
                <Clock size={14} />
                <span>Scheduled tasks</span>
              </button>
              <button
                onClick={openSettings}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] hover:bg-white/5 transition-colors opacity-80 hover:opacity-100"
              >
                <Settings size={14} />
                <span>Settings</span>
              </button>
            </div>
          </aside>
        )}

        {/* Chat pane */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Top bar */}
          <header
            className={`h-12 flex items-center justify-between pr-4 shrink-0 ${sidebarOpen ? 'pl-4' : 'pl-[84px]'}`}
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="mr-2 w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5 transition-all shrink-0"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title="Show sidebar"
              >
                <PanelLeft size={14} />
              </button>
            )}
            <div className="flex items-center gap-2 text-[12px] flex-1 min-w-0" style={{ color: 'var(--theme-muted)' }}>
              {activeSession ? (
                <>
                  <span className="truncate max-w-[280px]">{activeSession.title || 'Untitled'}</span>
                </>
              ) : (
                <span className="opacity-60">No active session</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--theme-muted)' }}>
              {activeSession && (
                <>
                  <span className="opacity-80">{activeSession.model}</span>
                  <span className="opacity-40">·</span>
                  <button
                    onClick={handleChangeCwd}
                    className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5 transition-colors opacity-80 hover:opacity-100"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title="Change project directory"
                  >
                    <Folder size={11} />
                    <span className="truncate max-w-[200px]">
                      {activeSession.cwd ? activeSession.cwd.split('/').slice(-2).join('/') : 'pick cwd'}
                    </span>
                  </button>
                </>
              )}
              <button
                onClick={togglePreview}
                className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5 transition-colors opacity-80 hover:opacity-100"
                style={{
                  WebkitAppRegion: 'no-drag',
                  color: previewOpen ? 'var(--theme-primary)' : 'var(--theme-muted)',
                } as React.CSSProperties}
                title="Toggle preview (⌘P)"
              >
                <PanelRight size={12} />
                <span>Preview</span>
              </button>
            </div>
          </header>

          {/* Body */}
          <div className="flex-1 overflow-hidden">
            {activeSession ? (
              <ChatArea />
            ) : (
              <EmptyState onNewSession={handleNewSession} />
            )}
          </div>
        </div>

        {/* Preview panel (right) */}
        {previewOpen && <PreviewPanel />}
      </div>

      <StatusBar />
      <ApprovalModal />
      <MCPApprovalModal />
      <SettingsModal />
      <DrawerModal />
      <NewSessionModal open={newSessionOpen} onClose={() => setNewSessionOpen(false)} />
    </div>
  )
}

function EmptyState({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-sm px-6">
        <div
          className="w-12 h-12 rounded-xl mx-auto mb-5 flex items-center justify-center"
          style={{ backgroundColor: 'var(--theme-bg-raised)' }}
        >
          <MessageSquare size={20} style={{ color: 'var(--theme-primary)' }} />
        </div>
        <h2 className="text-[20px] font-medium mb-2 tracking-tight">How can I help you code?</h2>
        <p className="text-[14px] mb-6 leading-relaxed" style={{ color: 'var(--theme-muted)' }}>
          Start a new session — pick a project directory and a model to begin.
        </p>
        <button
          onClick={onNewSession}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
          style={{ backgroundColor: 'var(--theme-primary)', color: '#1a1814' }}
        >
          <Plus size={14} />
          New session
        </button>
      </div>
    </div>
  )
}
