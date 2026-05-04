import React, { useState, useEffect, useRef } from 'react'
import { ChatArea } from '../Chat/ChatArea'
import { StatusBar } from '../Shared/StatusBar'
import { PreviewPanel } from '../Preview/PreviewPanel'
import { useAppStore } from '../../store/appStore'
import { Plus, MessageSquare, MessageCircle, PanelLeftClose, PanelLeft, PanelRight, Settings, Trash2, Folder, BookmarkCheck, Bot, Clock, ChevronDown, FolderTree } from 'lucide-react'
import { ApprovalModal, MCPApprovalModal } from '../Modals/ApprovalModal'
import { SettingsModal } from '../Modals/SettingsModal'
import { NewSessionModal } from '../Modals/NewSessionModal'
import { DrawerModal } from '../Modals/DrawerModal'
import { CommandPalette } from '../Modals/CommandPalette'
import { FilesPanel } from '../Files/FilesPanel'

function formatRelative(input: string | number | undefined): string {
  if (!input) return ''
  const ts = typeof input === 'number' ? input : Date.parse(input)
  if (!Number.isFinite(ts)) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function Layout() {
  const sessionList = useAppStore((s) => s.sessionList)
  const activeSession = useAppStore((s) => s.activeSession)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const switchSession = useAppStore((s) => s.switchSession)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const openSettings = useAppStore((s) => s.openSettings)
  const updateSessionCwd = useAppStore((s) => s.updateSessionCwd)
  const updateSessionModel = useAppStore((s) => s.updateSessionModel)
  const renameSession = useAppStore((s) => s.renameSession)
  const pickDirectory = useAppStore((s) => s.pickDirectory)
  const previewOpen = useAppStore((s) => s.previewOpen)
  const togglePreview = useAppStore((s) => s.togglePreview)
  const filesPanelOpen = useAppStore((s) => s.filesPanelOpen)
  const toggleFilesPanel = useAppStore((s) => s.toggleFilesPanel)
  const setDrawer = useAppStore((s) => s.setDrawer)
  const providers = useAppStore((s) => s.providers)
  const availableModels = useAppStore((s) => s.availableModels)
  const loadModels = useAppStore((s) => s.loadModels)

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const modelPickerRef = useRef<HTMLDivElement>(null)

  // Close model picker on outside click / escape
  useEffect(() => {
    if (!modelPickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setModelPickerOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModelPickerOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [modelPickerOpen])

  // When the picker opens, refresh the model list for the session's provider
  useEffect(() => {
    if (modelPickerOpen && activeSession?.provider) {
      void loadModels(activeSession.provider)
    }
  }, [modelPickerOpen, activeSession?.provider, loadModels])

  const commitRename = async () => {
    if (!renamingId) return
    const id = renamingId
    const draft = renameDraft
    setRenamingId(null)
    setRenameDraft('')
    await renameSession(id, draft)
  }
  const cancelRename = () => {
    setRenamingId(null)
    setRenameDraft('')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        togglePreview()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        toggleFilesPanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePreview, toggleFilesPanel])

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

  // Chat-mode sessions are conversation-only — they never touch the
  // filesystem, so the cwd picker, Files panel, and panel toggle are
  // suppressed in their UI to avoid implying capabilities that don't exist.
  const isChatSession = activeSession?.mode === 'chat'

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)' }}
    >
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside
            className="w-[220px] flex flex-col shrink-0"
            style={{
              backgroundColor: 'var(--theme-bg-subtle)',
              borderRight: '1px solid var(--theme-hairline)',
            }}
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
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] transition-colors hover:bg-white/5 focus-ring"
                style={{ color: 'var(--theme-text)' }}
              >
                <Plus size={14} />
                <span>New session</span>
                <span className="ml-auto text-[10.5px] opacity-40 font-mono">⌘N</span>
              </button>
            </div>

            {/* Section header */}
            <div className="px-4 pt-5 pb-1.5">
              <span className="text-[10.5px] font-medium uppercase tracking-wider opacity-40">
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
                sessionList.map((s) => {
                  const active = s.id === activeSessionId
                  const isRenaming = renamingId === s.id
                  return (
                    <div
                      key={s.id}
                      onClick={() => { if (!isRenaming) void switchSession(s.id) }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setRenamingId(s.id)
                        setRenameDraft(s.title || '')
                      }}
                      className="group relative flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-white/[0.03]"
                      style={active ? {
                        backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)',
                      } : undefined}
                      title={isRenaming ? undefined : 'Double-click to rename'}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full"
                          style={{ backgroundColor: 'var(--theme-primary)' }}
                        />
                      )}
                      {(s as { mode?: 'code' | 'chat' }).mode === 'chat' && !isRenaming && (
                        <MessageCircle
                          size={11}
                          className="shrink-0 opacity-50"
                          style={{ color: 'var(--theme-secondary)' }}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={() => void commitRename()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); void commitRename() }
                              else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                            }}
                            className="w-full bg-transparent outline-none text-[13px] leading-tight rounded px-1 -mx-1"
                            style={{
                              color: 'var(--theme-text)',
                              boxShadow: '0 0 0 1px color-mix(in srgb, var(--theme-primary) 45%, transparent)',
                            }}
                          />
                        ) : (
                          <p
                            className="text-[13px] truncate leading-tight"
                            style={{ color: active ? 'var(--theme-text)' : 'var(--theme-text)', fontWeight: active ? 500 : 400 }}
                          >
                            {s.title || 'Untitled'}
                          </p>
                        )}
                      </div>
                      {!isRenaming && (
                        <>
                          <span
                            className="text-[10.5px] font-mono shrink-0 opacity-40 group-hover:opacity-0 transition-opacity"
                            style={{ color: 'var(--theme-muted)' }}
                          >
                            {formatRelative((s as { updated_at?: string; updatedAt?: number }).updated_at ?? (s as { updated_at?: string; updatedAt?: number }).updatedAt)}
                          </span>
                          <button
                            onClick={(e) => handleDeleteSession(e, s.id)}
                            className="absolute right-2 opacity-0 group-hover:opacity-60 hover:!opacity-100 w-5 h-5 rounded flex items-center justify-center transition-all"
                            style={{ color: 'var(--theme-muted)' }}
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {/* Bottom: actions */}
            <div
              className="p-2 space-y-0.5"
              style={{ borderTop: '1px solid var(--theme-hairline)' }}
            >
              <button
                onClick={() => setDrawer('checkpoints')}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] hover:bg-white/5 transition-colors opacity-75 hover:opacity-100 focus-ring"
              >
                <BookmarkCheck size={13} />
                <span>Checkpoints</span>
              </button>
              <button
                onClick={() => setDrawer('bg-agents')}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] hover:bg-white/5 transition-colors opacity-75 hover:opacity-100 focus-ring"
              >
                <Bot size={13} />
                <span>Background agents</span>
              </button>
              <button
                onClick={() => setDrawer('cron')}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] hover:bg-white/5 transition-colors opacity-75 hover:opacity-100 focus-ring"
              >
                <Clock size={13} />
                <span>Scheduled tasks</span>
              </button>
              <button
                onClick={openSettings}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] hover:bg-white/5 transition-colors opacity-75 hover:opacity-100 focus-ring"
              >
                <Settings size={13} />
                <span>Settings</span>
              </button>
            </div>
          </aside>
        )}

        {/* Chat pane */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Top bar */}
          <header
            className={`h-12 flex items-center justify-between pr-3 shrink-0 ${sidebarOpen ? 'pl-4' : 'pl-[84px]'}`}
            style={{
              WebkitAppRegion: 'drag',
            } as React.CSSProperties}
          >
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="mr-2 w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5 transition-all shrink-0 focus-ring"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title="Show sidebar"
              >
                <PanelLeft size={14} />
              </button>
            )}
            <div className="flex items-center gap-2 text-[12.5px] flex-1 min-w-0" style={{ color: 'var(--theme-text)' }}>
              {activeSession ? (
                <span className="truncate max-w-[360px] font-medium tracking-tight">{activeSession.title || 'Untitled'}</span>
              ) : (
                <span className="opacity-50">No active session</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--theme-muted)' }}>
              {activeSession && (
                <>
                  <div className="hidden sm:block relative" ref={modelPickerRef}>
                    <button
                      onClick={() => setModelPickerOpen((v) => !v)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] font-mono opacity-70 hover:opacity-100 hover:bg-white/5 transition-all focus-ring"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      title={`${activeSession.provider} · ${activeSession.model}`}
                    >
                      <span className="truncate max-w-[220px]">{activeSession.model}</span>
                      <ChevronDown size={11} className={`transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {modelPickerOpen && (
                      <div
                        className="absolute right-0 top-full mt-1 rounded-xl shadow-xl z-20 overflow-hidden min-w-[260px]"
                        style={{
                          backgroundColor: 'var(--theme-bg-raised, var(--theme-bg-subtle))',
                          border: '1px solid var(--theme-hairline-strong)',
                          WebkitAppRegion: 'no-drag',
                        } as React.CSSProperties}
                      >
                        <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider opacity-50" style={{ color: 'var(--theme-muted)' }}>
                          Model · {activeSession.provider}
                        </div>
                        <div className="max-h-[320px] overflow-y-auto pb-1">
                          {availableModels.length === 0 ? (
                            <div className="px-3 py-3 text-[12px] opacity-60" style={{ color: 'var(--theme-muted)' }}>
                              Loading models…
                            </div>
                          ) : (
                            availableModels.map((m) => {
                              const selected = m.name === activeSession.model
                              return (
                                <button
                                  key={m.id}
                                  onClick={async () => {
                                    setModelPickerOpen(false)
                                    if (m.name !== activeSession.model) {
                                      await updateSessionModel(activeSession.id, activeSession.provider, m.name)
                                    }
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-white/[0.05]"
                                  style={selected ? { backgroundColor: 'color-mix(in srgb, var(--theme-primary) 12%, transparent)' } : undefined}
                                >
                                  <span className="font-mono flex-1 truncate" style={{ color: selected ? 'var(--theme-primary)' : 'var(--theme-text)' }}>
                                    {m.name}
                                  </span>
                                  {selected && (
                                    <span className="text-[10.5px] font-mono opacity-70" style={{ color: 'var(--theme-primary)' }}>
                                      active
                                    </span>
                                  )}
                                </button>
                              )
                            })
                          )}
                        </div>
                        <div
                          className="px-3 py-1.5 text-[10.5px] opacity-50 flex items-center justify-between"
                          style={{ borderTop: '1px solid var(--theme-hairline)', color: 'var(--theme-muted)' }}
                        >
                          <span>{providers.find(p => p.id === activeSession.provider)?.name ?? activeSession.provider}</span>
                          <span>⎋ close</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="opacity-25">·</span>
                  {isChatSession ? (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-mono text-[11.5px]"
                      style={{
                        color: 'var(--theme-secondary)',
                        backgroundColor: 'color-mix(in srgb, var(--theme-secondary) 10%, transparent)',
                        WebkitAppRegion: 'no-drag',
                      } as React.CSSProperties}
                      title="Chat-only session — no filesystem, shell, or git access"
                    >
                      <MessageCircle size={11} />
                      <span>chat</span>
                    </span>
                  ) : (
                    <button
                      onClick={handleChangeCwd}
                      className="group/cwd flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors hover:bg-white/5 focus-ring"
                      style={{
                        WebkitAppRegion: 'no-drag',
                      } as React.CSSProperties}
                      title={activeSession.cwd ? `${activeSession.cwd} — click to change` : 'Pick a project directory'}
                    >
                      <Folder size={11} className="opacity-70 group-hover/cwd:opacity-100 transition-opacity" />
                      <span
                        className="truncate max-w-[200px] font-mono text-[11.5px]"
                        style={{ color: activeSession.cwd ? undefined : 'var(--theme-primary)' }}
                      >
                        {activeSession.cwd ? activeSession.cwd.split('/').slice(-2).join('/') : 'pick a folder →'}
                      </span>
                      <span
                        className="text-[10px] font-mono opacity-0 group-hover/cwd:opacity-60 transition-opacity ml-0.5"
                        style={{ color: 'var(--theme-muted)' }}
                      >
                        change
                      </span>
                    </button>
                  )}
                </>
              )}
              {!isChatSession && (
                <button
                  onClick={toggleFilesPanel}
                  className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5 transition-colors focus-ring"
                  style={{
                    WebkitAppRegion: 'no-drag',
                    color: filesPanelOpen ? 'var(--theme-primary)' : 'var(--theme-muted)',
                  } as React.CSSProperties}
                  title="Toggle files (⌘⇧E)"
                >
                  <FolderTree size={12} />
                  <span className="text-[11.5px]">Files</span>
                </button>
              )}
              <button
                onClick={togglePreview}
                className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5 transition-colors focus-ring"
                style={{
                  WebkitAppRegion: 'no-drag',
                  color: previewOpen ? 'var(--theme-primary)' : 'var(--theme-muted)',
                } as React.CSSProperties}
                title="Toggle preview (⌘P)"
              >
                <PanelRight size={12} />
                <span className="text-[11.5px]">Preview</span>
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

        {/* Files panel (right, to the left of preview if both open) */}
        {filesPanelOpen && !isChatSession && <FilesPanel />}
        {/* Preview panel (right) */}
        {previewOpen && <PreviewPanel />}
      </div>

      <StatusBar />
      <ApprovalModal />
      <MCPApprovalModal />
      <SettingsModal />
      <DrawerModal />
      <CommandPalette />
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
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all hover:brightness-110 active:scale-[0.98] focus-ring"
          style={{
            backgroundColor: 'var(--theme-primary)',
            color: 'var(--theme-bg)',
            boxShadow: '0 4px 14px -4px color-mix(in srgb, var(--theme-primary) 50%, transparent)',
          }}
        >
          <Plus size={14} />
          New session
        </button>
      </div>
    </div>
  )
}
