import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { useResizablePanel, ResizeHandle } from '../Shared/Resizable'
import {
  PanelRightClose,
  Globe,
  Terminal,
  RotateCw,
  ExternalLink,
  Play,
  Square,
  Trash2,
} from 'lucide-react'

type Tab = 'web' | 'run'

const COMMON_PORTS = [3000, 5173, 8080, 8000, 4000, 4200, 5000, 8888]

export function PreviewPanel() {
  const setPreviewOpen = useAppStore((s) => s.setPreviewOpen)
  const activeSession = useAppStore((s) => s.activeSession)
  const [tab, setTab] = useState<Tab>('web')
  const previewResize = useResizablePanel({ storageKey: 'preview', defaultWidth: 520, min: 320, max: 920, dock: 'right' })

  return (
    <aside
      className="relative flex flex-col shrink-0 h-full"
      style={{
        width: previewResize.width,
        backgroundColor: 'var(--theme-bg-subtle)',
        borderLeft: '1px solid var(--theme-border)',
      }}
    >
      <ResizeHandle handleProps={previewResize.handleProps} label="preview panel" />
      {/* Header */}
      <div
        className="h-12 flex items-center justify-between px-3 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div
          className="flex items-center gap-1 rounded-lg p-0.5"
          style={{
            backgroundColor: 'var(--theme-bg-raised)',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          <TabButton active={tab === 'web'} onClick={() => setTab('web')} icon={<Globe size={12} />} label="Web" />
          <TabButton active={tab === 'run'} onClick={() => setTab('run')} icon={<Terminal size={12} />} label="Run" />
        </div>
        <button
          onClick={() => setPreviewOpen(false)}
          className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5 transition-all"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Close preview"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'web' ? (
          <WebTab />
        ) : (
          <RunTab cwd={activeSession?.cwd ?? null} />
        )}
      </div>
    </aside>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-all"
      style={{
        backgroundColor: active ? 'var(--theme-bg)' : 'transparent',
        color: active ? 'var(--theme-text)' : 'var(--theme-muted)',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

// ─── Web tab: URL + iframe ────────────────────────────────────────────────
function WebTab() {
  const [url, setUrl] = useState('http://localhost:3000')
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [key, setKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback((raw: string) => {
    let u = raw.trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u
    setUrl(u)
    setLoadedUrl(u)
  }, [])

  const refresh = () => setKey((k) => k + 1)

  return (
    <>
      <div
        className="flex items-center gap-1.5 px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--theme-border)' }}
      >
        <input
          ref={inputRef}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load(url)
          }}
          placeholder="http://localhost:3000"
          className="flex-1 rounded-md px-2.5 py-1.5 text-[12px] outline-none transition-shadow"
          style={{
            backgroundColor: 'var(--theme-bg)',
            color: 'var(--theme-text)',
            border: '1px solid var(--theme-border)',
          }}
        />
        <button
          onClick={() => load(url)}
          className="px-2.5 py-1.5 rounded-md text-[12px] transition-colors"
          style={{
            backgroundColor: 'var(--theme-primary)',
            color: '#1a1814',
          }}
          title="Load"
        >
          Load
        </button>
        <button
          onClick={refresh}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors"
          style={{ color: 'var(--theme-muted)' }}
          title="Refresh"
        >
          <RotateCw size={13} />
        </button>
        {loadedUrl && (
          <button
            onClick={() => void window.electron.openExternal(loadedUrl)}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors"
            style={{ color: 'var(--theme-muted)' }}
            title="Open in browser"
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>

      {!loadedUrl ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-xs">
            <Globe size={28} className="mx-auto mb-3" style={{ color: 'var(--theme-muted)', opacity: 0.4 }} />
            <p className="text-[13px] mb-3" style={{ color: 'var(--theme-muted)' }}>
              Preview any local dev server — React, Vue, Next, Django, Flask, plain HTML.
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {COMMON_PORTS.map((p) => (
                <button
                  key={p}
                  onClick={() => load(`http://localhost:${p}`)}
                  className="px-2 py-1 rounded-md text-[11.5px] hover:bg-white/5 transition-colors"
                  style={{
                    backgroundColor: 'var(--theme-bg-raised)',
                    color: 'var(--theme-muted)',
                  }}
                >
                  :{p}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 relative" style={{ backgroundColor: '#ffffff' }}>
          <iframe
            key={key}
            src={loadedUrl}
            className="w-full h-full border-0"
            title="Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          />
        </div>
      )}
    </>
  )
}

// ─── Run tab: command + streamed output ──────────────────────────────────
interface LogLine {
  id: string
  kind: 'stdout' | 'stderr' | 'meta'
  text: string
}

function RunTab({ cwd }: { cwd: string | null }) {
  const [command, setCommand] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [lines, setLines] = useState<LogLine[]>([])
  const [running, setRunning] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsubStart = window.electron.run.onStarted(({ runId: id, pid }) => {
      setLines((ls) => [...ls, { id: `meta-${Date.now()}`, kind: 'meta', text: `▶ started (pid ${pid ?? '?'})` }])
      setRunId(id)
      setRunning(true)
    })
    const unsubOutput = window.electron.run.onOutput(({ runId: id, kind, data }) => {
      setRunId((curr) => {
        if (curr !== id) return curr
        setLines((ls) => [...ls, { id: `${Date.now()}-${Math.random()}`, kind, text: data }])
        return curr
      })
    })
    const unsubExit = window.electron.run.onExit(({ runId: id, code, signal }) => {
      setRunId((curr) => {
        if (curr !== id) return curr
        setLines((ls) => [
          ...ls,
          { id: `meta-${Date.now()}-exit`, kind: 'meta', text: `■ exited ${signal ? `(signal ${signal})` : `with code ${code ?? '?'}`}` },
        ])
        setRunning(false)
        return null
      })
    })
    return () => {
      unsubStart()
      unsubOutput()
      unsubExit()
    }
  }, [])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [lines])

  const handleRun = async () => {
    const cmd = command.trim()
    if (!cmd || !cwd || running) return
    const id = 'run_' + Math.random().toString(36).slice(2, 10)
    setLines([])
    const res = await window.electron.run.start({ runId: id, command: cmd, cwd })
    if (!res.ok) {
      setLines([{ id: 'err', kind: 'stderr', text: res.error ?? 'Failed to start' }])
    }
  }

  const handleStop = async () => {
    if (runId) await window.electron.run.stop(runId)
  }

  const clearOutput = () => setLines([])

  return (
    <>
      <div
        className="px-3 py-2 shrink-0 flex flex-col gap-2"
        style={{ borderBottom: '1px solid var(--theme-border)' }}
      >
        <div className="flex items-center gap-1.5">
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleRun()
            }}
            placeholder="python script.py / npm run dev / cargo run / go run main.go"
            disabled={running}
            className="flex-1 rounded-md px-2.5 py-1.5 text-[12px] font-mono outline-none disabled:opacity-50"
            style={{
              backgroundColor: 'var(--theme-bg)',
              color: 'var(--theme-text)',
              border: '1px solid var(--theme-border)',
            }}
          />
          {running ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] transition-colors"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--theme-error) 18%, transparent)',
                color: 'var(--theme-error)',
              }}
              title="Stop"
            >
              <Square size={11} /> Stop
            </button>
          ) : (
            <button
              onClick={() => void handleRun()}
              disabled={!command.trim() || !cwd}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] transition-colors disabled:opacity-40"
              style={{
                backgroundColor: 'var(--theme-primary)',
                color: '#1a1814',
              }}
              title="Run"
            >
              <Play size={11} /> Run
            </button>
          )}
          <button
            onClick={clearOutput}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors"
            style={{ color: 'var(--theme-muted)' }}
            title="Clear"
          >
            <Trash2 size={12} />
          </button>
        </div>
        <div className="text-[10.5px] truncate" style={{ color: 'var(--theme-muted)', opacity: 0.7 }}>
          cwd: {cwd || '(no session)'}
        </div>
      </div>

      <div
        ref={outputRef}
        className="flex-1 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-[1.55]"
        style={{ backgroundColor: 'var(--theme-bg)' }}
      >
        {lines.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-xs">
              <Terminal size={28} className="mx-auto mb-3" style={{ color: 'var(--theme-muted)', opacity: 0.4 }} />
              <p className="text-[13px]" style={{ color: 'var(--theme-muted)', fontFamily: 'inherit' }}>
                Run any command in the project directory — Python, Node, Go, Rust, shell…
              </p>
            </div>
          </div>
        ) : (
          lines.map((l) => (
            <div
              key={l.id}
              className="whitespace-pre-wrap break-all"
              style={{
                color:
                  l.kind === 'stderr'
                    ? 'var(--theme-error)'
                    : l.kind === 'meta'
                    ? 'var(--theme-muted)'
                    : 'var(--theme-text)',
              }}
            >
              {l.text}
            </div>
          ))
        )}
      </div>
    </>
  )
}
