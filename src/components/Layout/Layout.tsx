import React, { useState, useEffect, useRef } from 'react'
import { ChatArea } from '../Chat/ChatArea'
import { StatusBar } from '../Shared/StatusBar'
import { PreviewPanel } from '../Preview/PreviewPanel'
import { BrowserMode } from '../Browser/BrowserMode'
import { useAppStore, type ModelInfo } from '../../store/appStore'
import { Plus, MessageSquare, MessageCircle, PanelLeftClose, PanelLeft, PanelRight, Settings, Trash2, Folder, BookmarkCheck, Bot, Clock, BookOpen, GitCompare, StickyNote, FileText, Mail, CalendarDays, ChevronDown, FolderTree, Loader2, Search, Compass } from 'lucide-react'
import { ApprovalModal, MCPApprovalModal } from '../Modals/ApprovalModal'
import { SettingsModal } from '../Modals/SettingsModal'
import { NewSessionModal } from '../Modals/NewSessionModal'
import { DrawerModal } from '../Modals/DrawerModal'
import { CompareModal } from '../Modals/CompareModal'
import { ResearchModal } from '../Modals/ResearchModal'
import { DocumentsView } from '../Workspace/DocumentsView'
import { NotesView } from '../Workspace/NotesView'
import { EmailModal } from '../Modals/EmailModal'
import { CalendarModal } from '../Modals/CalendarModal'
import { CommandPalette } from '../Modals/CommandPalette'
import { OnboardingOverlay } from '../Modals/OnboardingOverlay'
import { FilesPanel } from '../Files/FilesPanel'
import { useResizablePanel, ResizeHandle } from '../Shared/Resizable'

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
  const openCompare = useAppStore((s) => s.openCompare)
  const openResearch = useAppStore((s) => s.openResearch)
  const openDocuments = useAppStore((s) => s.openDocuments)
  const documentsOpen = useAppStore((s) => s.documentsOpen)
  const openEmail = useAppStore((s) => s.openEmail)
  const openCalendar = useAppStore((s) => s.openCalendar)
  const updateSessionCwd = useAppStore((s) => s.updateSessionCwd)
  const updateSessionModel = useAppStore((s) => s.updateSessionModel)
  const renameSession = useAppStore((s) => s.renameSession)
  const pickDirectory = useAppStore((s) => s.pickDirectory)
  const previewOpen = useAppStore((s) => s.previewOpen)
  const togglePreview = useAppStore((s) => s.togglePreview)
  const browserView = useAppStore((s) => s.browserView)
  const toggleBrowserView = useAppStore((s) => s.toggleBrowserView)
  const filesPanelOpen = useAppStore((s) => s.filesPanelOpen)
  const toggleFilesPanel = useAppStore((s) => s.toggleFilesPanel)
  const setDrawer = useAppStore((s) => s.setDrawer)
  const activeDrawer = useAppStore((s) => s.activeDrawer)
  const providers = useAppStore((s) => s.providers)
  const availableModels = useAppStore((s) => s.availableModels)
  const loadModels = useAppStore((s) => s.loadModels)

  const [sidebarOpen, setSidebarOpen] = useState(true)
  // Layout is per-device UI state — persisted via localStorage, not config IPC.
  const sidebarResize = useResizablePanel({ storageKey: 'sidebar', defaultWidth: 220, min: 170, max: 420, dock: 'left' })
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  // Per-provider model lists for the picker. Keyed by provider id. We fetch
  // these in parallel when the picker opens so the user can switch BOTH
  // provider and model in one click — without this, the dropdown only
  // showed the current session provider's models, which forced you to
  // delete-and-recreate a session just to swap from LM Studio to Anthropic.
  const [allModels, setAllModels] = useState<Record<string, ModelInfo[]>>({})
  // Providers whose model fetch is still in flight. Used for per-section
  // loading spinners — local providers (LM Studio, Ollama) can be slow if
  // the server is starting up, and we don't want one slow provider to
  // delay rendering the rest of the list.
  const [loadingProviders, setLoadingProviders] = useState<Set<string>>(new Set())
  const [modelFilter, setModelFilter] = useState('')

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

  // Fetch models for every authed provider when the picker opens. We use
  // direct IPC (not the store's loadModels) because loadModels overwrites
  // the global `availableModels` — calling it for 6 providers in parallel
  // would race and last-writer-wins. A local map per provider sidesteps that.
  useEffect(() => {
    if (!modelPickerOpen) return
    const authed = providers.filter((p) => p.authed)
    if (authed.length === 0) return
    setModelFilter('')
    setLoadingProviders(new Set(authed.map((p) => p.id)))
    let cancelled = false
    authed.forEach((p) => {
      void window.electron.llm.listModels(p.id)
        .then((res) => {
          if (cancelled) return
          const models = res.ok && res.models ? res.models : []
          setAllModels((prev) => ({ ...prev, [p.id]: models }))
        })
        .catch(() => {
          if (cancelled) return
          setAllModels((prev) => ({ ...prev, [p.id]: [] }))
        })
        .finally(() => {
          if (cancelled) return
          setLoadingProviders((prev) => {
            const next = new Set(prev)
            next.delete(p.id)
            return next
          })
        })
    })
    return () => { cancelled = true }
  }, [modelPickerOpen, providers])

  // Keep the store's availableModels in sync with the active session's
  // provider too, since other surfaces (NewSessionModal in re-edit, etc.)
  // still read from it. Cheap — fires once per session-provider change.
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
      className="app-shell h-screen w-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)' }}
    >
      {browserView ? (
        <BrowserMode onNewSession={handleNewSession} />
      ) : documentsOpen ? (
        <DocumentsView onNewSession={handleNewSession} />
      ) : activeDrawer === 'notes' ? (
        <NotesView onNewSession={handleNewSession} />
      ) : (
        <>
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside
            className="relative flex flex-col shrink-0"
            style={{
              width: sidebarResize.width,
              backgroundColor: 'var(--theme-bg-subtle)',
              backgroundImage: 'linear-gradient(180deg, color-mix(in srgb, var(--theme-text) 3%, transparent), transparent 26%)',
              borderRight: '1px solid var(--theme-hairline)',
              boxShadow: 'inset -1px 0 0 0 var(--sheen)',
            }}
          >
            <ResizeHandle handleProps={sidebarResize.handleProps} label="sidebar" />
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
              <button
                onClick={toggleBrowserView}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] transition-colors hover:bg-white/5 focus-ring mt-0.5"
                style={{
                  color: browserView ? 'var(--theme-primary)' : 'var(--theme-text)',
                  backgroundColor: browserView ? 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' : 'transparent',
                }}
                title="Browser — the agent can navigate, read + click it"
              >
                <Compass size={14} />
                <span>Browser</span>
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
                          className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full"
                          style={{
                            backgroundColor: 'var(--theme-primary)',
                            boxShadow: '0 0 10px 0 color-mix(in srgb, var(--theme-primary) 55%, transparent)',
                          }}
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

            {/* Bottom: compact tool rail — icon-only with tooltips, one flat group */}
            <div
              className="p-2"
              style={{ borderTop: '1px solid var(--theme-hairline)' }}
            >
              <div className="flex flex-wrap gap-1">
                {[
                  { icon: BookOpen, label: 'Cookbook', onClick: () => setDrawer('cookbook') },
                  { icon: GitCompare, label: 'Compare', onClick: openCompare },
                  { icon: Search, label: 'Deep Research', onClick: openResearch },
                  { icon: StickyNote, label: 'Notes & Tasks', onClick: () => setDrawer('notes') },
                  { icon: FileText, label: 'Documents', onClick: openDocuments },
                  { icon: Mail, label: 'Email', onClick: openEmail },
                  { icon: CalendarDays, label: 'Calendar', onClick: openCalendar },
                  { icon: BookmarkCheck, label: 'Checkpoints', onClick: () => setDrawer('checkpoints') },
                  { icon: Bot, label: 'Background agents', onClick: () => setDrawer('bg-agents') },
                  { icon: Clock, label: 'Scheduled tasks', onClick: () => setDrawer('cron') },
                  { icon: Settings, label: 'Settings', onClick: openSettings },
                ].map(({ icon: Icon, label, onClick }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    title={label}
                    aria-label={label}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors opacity-70 hover:opacity-100 hover:bg-white/5 focus-ring"
                    style={{ color: 'var(--theme-muted)' }}
                  >
                    <Icon size={15} />
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Chat pane */}
        <div className="flex-1 flex flex-col overflow-hidden relative min-w-[360px]">
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
                        className="absolute right-0 top-full mt-1 rounded-xl shadow-xl z-20 overflow-hidden min-w-[320px]"
                        style={{
                          backgroundColor: 'var(--theme-bg-raised, var(--theme-bg-subtle))',
                          border: '1px solid var(--theme-hairline-strong)',
                          WebkitAppRegion: 'no-drag',
                        } as React.CSSProperties}
                      >
                        {/* Search bar — useful once you have a few providers
                            with dozens of models each. Focuses on open. */}
                        <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--theme-hairline)' }}>
                          <Search size={11} style={{ color: 'var(--theme-muted)' }} />
                          <input
                            autoFocus
                            value={modelFilter}
                            onChange={(e) => setModelFilter(e.target.value)}
                            placeholder="Filter models…"
                            className="flex-1 bg-transparent outline-none text-[12px] font-mono"
                            style={{ color: 'var(--theme-text)' }}
                          />
                          {modelFilter && (
                            <button onClick={() => setModelFilter('')} className="text-[10.5px] opacity-60 hover:opacity-100">
                              clear
                            </button>
                          )}
                        </div>

                        {/* Body: every authed provider gets its own section.
                            Active provider's section is rendered first so the
                            current model is at the top of the list. */}
                        <div className="max-h-[420px] overflow-y-auto pb-1">
                          {(() => {
                            const authed = providers.filter((p) => p.authed)
                            if (authed.length === 0) {
                              return (
                                <div className="px-3 py-4 text-[12px] opacity-60 text-center" style={{ color: 'var(--theme-muted)' }}>
                                  No providers configured.<br />
                                  <span className="text-[11px]">Open Settings → Providers to add one.</span>
                                </div>
                              )
                            }
                            // Sort: active provider first, then alphabetical
                            const sorted = [...authed].sort((a, b) => {
                              if (a.id === activeSession.provider) return -1
                              if (b.id === activeSession.provider) return 1
                              return a.name.localeCompare(b.name)
                            })
                            const filter = modelFilter.trim().toLowerCase()
                            // Track whether ANY model matched the filter so we
                            // can show "no results" once for the whole picker
                            // instead of an empty section per provider.
                            let totalMatches = 0
                            const sections = sorted.map((p) => {
                              const list = allModels[p.id] ?? []
                              const filtered = filter
                                ? list.filter((m) => m.name.toLowerCase().includes(filter) || m.id.toLowerCase().includes(filter))
                                : list
                              totalMatches += filtered.length
                              const isLoading = loadingProviders.has(p.id)
                              const isActiveProvider = p.id === activeSession.provider
                              return { provider: p, models: filtered, isLoading, isActiveProvider }
                            })

                            if (filter && totalMatches === 0) {
                              return (
                                <div className="px-3 py-6 text-[12px] opacity-60 text-center" style={{ color: 'var(--theme-muted)' }}>
                                  No models match "{modelFilter}"
                                </div>
                              )
                            }

                            return sections.map(({ provider, models, isLoading, isActiveProvider }) => {
                              // Hide non-active provider sections when they're
                              // empty + finished loading + filter is empty —
                              // a provider with zero models is just noise.
                              if (!isActiveProvider && !isLoading && models.length === 0 && !filter) return null
                              return (
                                <div key={provider.id} className="pt-1.5">
                                  <div
                                    className="flex items-center justify-between px-3 py-1 text-[10.5px] uppercase tracking-wider"
                                    style={{ color: 'var(--theme-muted)', opacity: 0.6 }}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span>{provider.name}</span>
                                      {isActiveProvider && (
                                        <span
                                          className="text-[9px] font-mono px-1 py-[1px] rounded"
                                          style={{
                                            color: 'var(--theme-primary)',
                                            backgroundColor: 'color-mix(in srgb, var(--theme-primary) 14%, transparent)',
                                          }}
                                        >
                                          current
                                        </span>
                                      )}
                                    </div>
                                    {isLoading && <Loader2 size={10} className="animate-spin opacity-70" />}
                                  </div>
                                  {models.length === 0 && !isLoading ? (
                                    <div className="px-3 py-1.5 text-[11px] opacity-50 italic" style={{ color: 'var(--theme-muted)' }}>
                                      {filter ? 'no matches' : 'no models — server reachable but empty'}
                                    </div>
                                  ) : (
                                    models.map((m) => {
                                      const selected = isActiveProvider && m.name === activeSession.model
                                      return (
                                        <button
                                          key={`${provider.id}::${m.id}`}
                                          onClick={async () => {
                                            setModelPickerOpen(false)
                                            // Always pass both provider AND model — switching
                                            // providers within a session works because the IPC
                                            // already accepts the pair; the bug was purely
                                            // that the picker only showed one provider.
                                            if (!selected) {
                                              await updateSessionModel(activeSession.id, provider.id, m.name)
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
                              )
                            })
                          })()}
                        </div>
                        <div
                          className="px-3 py-1.5 text-[10.5px] opacity-50 flex items-center justify-between"
                          style={{ borderTop: '1px solid var(--theme-hairline)', color: 'var(--theme-muted)' }}
                        >
                          <span>{(providers.find(p => p.id === activeSession.provider)?.name ?? activeSession.provider)} · {activeSession.model}</span>
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
              {!browserView && !isChatSession && (
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
              {!browserView && (
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
              )}
              <button
                onClick={toggleBrowserView}
                className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5 transition-colors focus-ring"
                style={{
                  WebkitAppRegion: 'no-drag',
                  color: browserView ? 'var(--theme-primary)' : 'var(--theme-muted)',
                } as React.CSSProperties}
                title="Browser view — the agent can drive it"
              >
                <Compass size={12} />
                <span className="text-[11.5px]">Browser</span>
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
        </>
      )}
      <ApprovalModal />
      <MCPApprovalModal />
      <SettingsModal />
      <DrawerModal />
      <CompareModal />
      <ResearchModal />
      <EmailModal />
      <CalendarModal />
      <CommandPalette />
      <NewSessionModal open={newSessionOpen} onClose={() => setNewSessionOpen(false)} />
      <OnboardingOverlay />
    </div>
  )
}

function EmptyState({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-sm px-6 animate-fade-in">
        <div className="relative mx-auto mb-6 w-14 h-14">
          <div
            className="absolute -inset-7 rounded-full pointer-events-none animate-pulse"
            style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--theme-primary) 22%, transparent), transparent 70%)', animationDuration: '4s' }}
          />
          <div
            className="relative w-14 h-14 rounded-2xl flex items-center justify-center font-mono text-[20px] font-bold select-none"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 14%, transparent)',
              border: '1px solid color-mix(in srgb, var(--theme-primary) 32%, transparent)',
              color: 'var(--theme-primary)',
              boxShadow: '0 8px 32px -8px color-mix(in srgb, var(--theme-primary) 42%, transparent), inset 0 1px 0 0 var(--sheen)',
            }}
          >
            {'>_'}
          </div>
        </div>
        <h2 className="text-[26px] font-semibold mb-1 tracking-tight">
          codemaxxing
          <span className="animate-pulse" style={{ color: 'var(--theme-primary)' }}>_</span>
        </h2>
        <p className="text-[13.5px] mb-7 leading-relaxed" style={{ color: 'var(--theme-muted)' }}>
          Your agentic coding workspace — local models, cloud frontier, one app.
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
        <div
          className="flex items-center justify-center gap-4 mt-7 text-[10.5px] font-mono opacity-40"
          style={{ color: 'var(--theme-muted)' }}
        >
          <span><kbd>⌘N</kbd> new session</span>
          <span>·</span>
          <span><kbd>/</kbd> commands</span>
          <span>·</span>
          <span>16 themes</span>
        </div>
      </div>
    </div>
  )
}
