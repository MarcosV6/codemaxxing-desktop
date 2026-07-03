import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import {
  Command, MessageSquare, Settings, FileText, Folder, Search, ArrowRight,
  GitCompare, GitBranch, History, GitCommit, Upload, Undo2, Gavel, Gauge, HardDrive, Smartphone, Rocket, Compass,
  DollarSign, Archive, Bookmark, BookOpen, Sparkles, Brain,
  Database, Bot, Clock, HelpCircle, PanelRight, StickyNote, Mail, CalendarDays,
} from 'lucide-react'

type LucideIcon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }>

type PaletteItemKind = 'session' | 'slash' | 'file' | 'action'

interface PaletteItem {
  kind: PaletteItemKind
  id: string
  title: string
  subtitle?: string
  icon: LucideIcon
  run: () => void | Promise<void>
  hint?: string
}

const SLASH_PALETTE: Array<{ name: string; description: string; icon: LucideIcon }> = [
  { name: 'diff',        description: 'Show git diff',                              icon: GitCompare },
  { name: 'status',      description: 'Show git status',                            icon: GitBranch },
  { name: 'log',         description: 'Show recent commits',                        icon: History },
  { name: 'commit',      description: 'Stage all and commit',                       icon: GitCommit },
  { name: 'push',        description: 'Push to remote',                             icon: Upload },
  { name: 'undo',        description: 'Undo the last commit (keep changes)',       icon: Undo2 },
  { name: 'cost',        description: 'Show session token usage and cost',         icon: DollarSign },
  { name: 'compact',     description: 'Summarize old history into a fresh session',icon: Archive },
  { name: 'checkpoint',  description: 'Save a session checkpoint',                  icon: Bookmark },
  { name: 'checkpoints', description: 'Browse saved checkpoints',                   icon: BookOpen },
  { name: 'skills',      description: 'Show active skill packs',                    icon: Sparkles },
  { name: 'think',       description: 'Set reasoning effort',                       icon: Brain },
  { name: 'memory',      description: 'Show memory stats or recall',                icon: Database },
  { name: 'bg',          description: 'Open background agents drawer',              icon: Bot },
  { name: 'cron',        description: 'Open scheduled tasks drawer',                icon: Clock },
  { name: 'settings',    description: 'Open settings',                              icon: Settings },
  { name: 'help',        description: 'List all slash commands',                    icon: HelpCircle },
]

function fuzzyMatch(needle: string, hay: string): number {
  if (!needle) return 1
  const h = hay.toLowerCase()
  const n = needle.toLowerCase()
  if (h === n) return 1000
  if (h.startsWith(n)) return 800 - h.length
  if (h.includes(n)) return 500 - h.length
  // char-in-order fuzzy
  let i = 0
  for (const ch of h) { if (ch === n[i]) i++; if (i === n.length) break }
  return i === n.length ? 200 - h.length : -1
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const sessionList = useAppStore((s) => s.sessionList)
  const activeSession = useAppStore((s) => s.activeSession)
  const switchSession = useAppStore((s) => s.switchSession)
  const openSettings = useAppStore((s) => s.openSettings)
  const setDrawer = useAppStore((s) => s.setDrawer)
  const togglePreview = useAppStore((s) => s.togglePreview)
  const sendMessage = useAppStore((s) => s.sendMessage)
  const openCompare = useAppStore((s) => s.openCompare)
  const openResearch = useAppStore((s) => s.openResearch)
  const openDocuments = useAppStore((s) => s.openDocuments)
  const openEmail = useAppStore((s) => s.openEmail)
  const openCalendar = useAppStore((s) => s.openCalendar)
  const goLocal = useAppStore((s) => s.goLocal)
  const openOnboarding = useAppStore((s) => s.openOnboarding)
  const openBrowserPanel = useAppStore((s) => s.openBrowserPanel)

  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [fileHits, setFileHits] = useState<Array<{ path: string; name: string; dir: boolean; ext: string }>>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Global Cmd+K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!open)
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  // File search (debounced)
  useEffect(() => {
    if (!open || !activeSession?.cwd || !query.trim()) { setFileHits([]); return }
    let cancelled = false
    const id = setTimeout(async () => {
      try {
        const api = (window as any).electron?.files
        if (!api?.search) return
        const res = await api.search({ cwd: activeSession.cwd, query, limit: 8 })
        if (!cancelled && res?.ok && res.files) setFileHits(res.files)
      } catch {
        if (!cancelled) setFileHits([])
      }
    }, 80)
    return () => { cancelled = true; clearTimeout(id) }
  }, [query, open, activeSession?.cwd])

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = []
    const q = query.trim()

    // Slash commands
    for (const cmd of SLASH_PALETTE) {
      const score = Math.max(
        fuzzyMatch(q, '/' + cmd.name),
        fuzzyMatch(q, cmd.name),
        fuzzyMatch(q, cmd.description),
      )
      if (q && score < 0) continue
      list.push({
        kind: 'slash',
        id: `slash:${cmd.name}`,
        title: '/' + cmd.name,
        subtitle: cmd.description,
        icon: cmd.icon,
        hint: 'command',
        run: async () => {
          setOpen(false)
          if (activeSession) await sendMessage('/' + cmd.name)
        },
      })
    }

    // Sessions
    for (const s of sessionList) {
      const title = s.title || 'Untitled'
      const score = fuzzyMatch(q, title)
      if (q && score < 0) continue
      if (s.id === activeSession?.id) continue
      list.push({
        kind: 'session',
        id: `session:${s.id}`,
        title,
        subtitle: 'Switch session',
        icon: MessageSquare,
        hint: 'session',
        run: () => { setOpen(false); void switchSession(s.id) },
      })
    }

    // Files (from fileHits, already sorted)
    for (const f of fileHits) {
      list.push({
        kind: 'file',
        id: `file:${f.path}`,
        title: f.name + (f.dir ? '/' : ''),
        subtitle: f.path,
        icon: f.dir ? Folder : FileText,
        hint: f.dir ? 'directory' : 'file',
        run: () => {
          setOpen(false)
          if (!activeSession) return
          const prefix = activeSession.messages.length === 0 ? '' : ''
          // Insert @path into current input via the store's sendMessage — but
          // better to just pop it into the input. Simplest: send a lightweight
          // message that references the file so the agent can open it.
          void sendMessage(prefix + (f.dir ? `@${f.path}/` : `@${f.path}`))
        },
      })
    }

    // Static actions
    const actions: PaletteItem[] = [
      { kind: 'action', id: 'act:cookbook', title: 'Cookbook', subtitle: 'Find & run local models', icon: BookOpen, hint: 'workspace', run: () => { setOpen(false); setDrawer('cookbook') } },
      { kind: 'action', id: 'act:compare', title: 'Compare Models', subtitle: 'Side-by-side, blind voting', icon: GitCompare, hint: 'workspace', run: () => { setOpen(false); openCompare() } },
      { kind: 'action', id: 'act:council', title: 'Convene Council', subtitle: 'N models answer → one synthesized best', icon: Gavel, hint: 'workspace', run: () => { setOpen(false); openCompare() } },
      { kind: 'action', id: 'act:cockpit', title: 'Context Cockpit', subtitle: "See the model's window + compact/checkpoint", icon: Gauge, hint: 'session', run: () => { setOpen(false); setDrawer('cockpit') } },
      { kind: 'action', id: 'act:local', title: 'Go Fully Local', subtitle: 'Switch this session to a local model · $0', icon: HardDrive, hint: 'session', run: () => { setOpen(false); goLocal() } },
      { kind: 'action', id: 'act:browser', title: 'Open Browser', subtitle: 'Embedded browser — the agent can navigate, read + click it', icon: Compass, hint: 'workspace', run: () => {
        setOpen(false)
        // One path into the browser: prefer the most recent browser session
        // (same as the sidebar entry); fall back to the transient panel.
        const recent = sessionList.find((s) => (s as { mode?: string }).mode === 'browser')
        if (recent) void switchSession(recent.id)
        else openBrowserPanel()
      } },
      { kind: 'action', id: 'act:remote', title: 'Remote Access (phone)', subtitle: 'Pair a device → drive this agent from your phone', icon: Smartphone, hint: 'settings', run: () => { setOpen(false); openSettings() } },
      { kind: 'action', id: 'act:welcome', title: 'Welcome / Setup', subtitle: 'Re-open the first-run walkthrough', icon: Rocket, hint: 'help', run: () => { setOpen(false); openOnboarding() } },
      { kind: 'action', id: 'act:research', title: 'Deep Research', subtitle: 'Web research → cited report', icon: Search, hint: 'workspace', run: () => { setOpen(false); openResearch() } },
      { kind: 'action', id: 'act:notes', title: 'Notes & Tasks', subtitle: 'Quick capture', icon: StickyNote, hint: 'workspace', run: () => { setOpen(false); setDrawer('notes') } },
      { kind: 'action', id: 'act:documents', title: 'Documents', subtitle: 'AI-assisted editor', icon: FileText, hint: 'workspace', run: () => { setOpen(false); openDocuments() } },
      { kind: 'action', id: 'act:email', title: 'Email', subtitle: 'IMAP inbox + send', icon: Mail, hint: 'workspace', run: () => { setOpen(false); openEmail() } },
      { kind: 'action', id: 'act:calendar', title: 'Calendar', subtitle: 'CalDAV agenda', icon: CalendarDays, hint: 'workspace', run: () => { setOpen(false); openCalendar() } },
      {
        kind: 'action', id: 'act:settings', title: 'Open Settings', subtitle: 'General, providers, skills, hooks',
        icon: Settings, hint: 'action',
        run: () => { setOpen(false); openSettings() },
      },
      {
        kind: 'action', id: 'act:checkpoints', title: 'Checkpoints', subtitle: 'Save / restore session state',
        icon: Bookmark, hint: 'action',
        run: () => { setOpen(false); setDrawer('checkpoints') },
      },
      {
        kind: 'action', id: 'act:bg-agents', title: 'Background Agents', subtitle: 'Headless runs',
        icon: Bot, hint: 'action',
        run: () => { setOpen(false); setDrawer('bg-agents') },
      },
      {
        kind: 'action', id: 'act:cron', title: 'Scheduled Tasks', subtitle: 'Cron jobs',
        icon: Clock, hint: 'action',
        run: () => { setOpen(false); setDrawer('cron') },
      },
      {
        kind: 'action', id: 'act:preview', title: 'Toggle Preview Panel', subtitle: 'Show command runner',
        icon: PanelRight, hint: 'action',
        run: () => { setOpen(false); togglePreview() },
      },
    ]
    for (const a of actions) {
      const score = Math.max(fuzzyMatch(q, a.title), fuzzyMatch(q, a.subtitle ?? ''))
      if (q && score < 0) continue
      list.push(a)
    }

    return list
  }, [query, sessionList, activeSession, fileHits, setOpen, switchSession, openSettings, setDrawer, togglePreview, sendMessage, openCompare, openResearch, openDocuments, openEmail, openCalendar, goLocal, openOnboarding, openBrowserPanel])

  useEffect(() => { setSelectedIdx(0) }, [query, items.length])

  if (!open) return null

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => (i + 1) % Math.max(1, items.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => (i - 1 + Math.max(1, items.length)) % Math.max(1, items.length))
    } else if (e.key === 'Enter' && items[selectedIdx]) {
      e.preventDefault()
      void items[selectedIdx].run()
    }
  }

  // Group items by kind for display
  const groups: Array<{ label: string; items: PaletteItem[] }> = []
  const byKind: Record<PaletteItemKind, PaletteItem[]> = { slash: [], session: [], file: [], action: [] }
  for (const it of items) byKind[it.kind].push(it)
  const groupOrder: Array<{ kind: PaletteItemKind; label: string }> = [
    { kind: 'file',    label: 'Files' },
    { kind: 'session', label: 'Sessions' },
    { kind: 'slash',   label: 'Commands' },
    { kind: 'action',  label: 'Actions' },
  ]
  let runningIdx = 0
  for (const g of groupOrder) {
    if (byKind[g.kind].length === 0) continue
    groups.push({ label: g.label, items: byKind[g.kind] })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]"
      onClick={() => setOpen(false)}
      style={{ backgroundColor: 'color-mix(in srgb, black 45%, transparent)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="w-[min(640px,92vw)] rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--theme-bg-raised, var(--theme-bg-subtle))',
          border: '1px solid var(--theme-hairline-strong)',
        }}
      >
        <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid var(--theme-hairline)' }}>
          <Search size={15} style={{ color: 'var(--theme-muted)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search sessions, files, commands…"
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:opacity-40"
            style={{ color: 'var(--theme-text)' }}
          />
          <span className="text-[10.5px] font-mono opacity-50" style={{ color: 'var(--theme-muted)' }}>
            ⌘K
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1">
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] opacity-60" style={{ color: 'var(--theme-muted)' }}>
              No matches.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider opacity-50" style={{ color: 'var(--theme-muted)' }}>
                {g.label}
              </div>
              {g.items.map((it) => {
                const idx = runningIdx++
                const isActive = idx === selectedIdx
                const Icon = it.icon
                return (
                  <button
                    key={it.id}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={() => void it.run()}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors ${isActive ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
                  >
                    <Icon
                      size={13}
                      strokeWidth={1.8}
                      style={{ color: isActive ? 'var(--theme-primary)' : 'var(--theme-muted)' }}
                    />
                    <span className="truncate font-mono" style={{ color: isActive ? 'var(--theme-primary)' : 'var(--theme-text)' }}>
                      {it.title}
                    </span>
                    {it.subtitle && (
                      <span className="ml-2 truncate text-[11.5px] opacity-65" style={{ color: 'var(--theme-muted)' }}>
                        {it.subtitle}
                      </span>
                    )}
                    {isActive && (
                      <ArrowRight size={12} className="ml-auto" style={{ color: 'var(--theme-primary)' }} />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div
          className="px-3 py-2 text-[10.5px] flex items-center gap-3 opacity-55"
          style={{ borderTop: '1px solid var(--theme-hairline)', color: 'var(--theme-muted)' }}
        >
          <span className="flex items-center gap-1"><Command size={10} /> K toggle</span>
          <span>↑↓ navigate</span>
          <span>⏎ run</span>
          <span>⎋ close</span>
        </div>
      </div>
    </div>
  )
}
