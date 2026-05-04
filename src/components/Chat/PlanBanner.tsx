import React from 'react'
import { useAppStore } from '../../store/appStore'
import { ClipboardList, X } from 'lucide-react'

interface Props {
  plan: string
}

export function PlanBanner({ plan }: Props) {
  const dismissPlan = useAppStore((s) => s.dismissPlan)
  return (
    <div
      className="mb-5 rounded-xl animate-fade-in overflow-hidden"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--theme-warning) 5%, transparent)',
        border: '1px solid color-mix(in srgb, var(--theme-warning) 18%, transparent)',
        boxShadow: 'inset 3px 0 0 0 var(--theme-warning)',
      }}
    >
      <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid color-mix(in srgb, var(--theme-warning) 12%, transparent)' }}>
        <div className="flex items-center gap-2">
          <ClipboardList size={13} style={{ color: 'var(--theme-warning)' }} />
          <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'var(--theme-warning)' }}>
            Plan ready
          </span>
        </div>
        <button
          onClick={dismissPlan}
          className="w-6 h-6 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5 transition-all"
          title="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
      <div
        className="px-4 py-3 whitespace-pre-wrap text-[13px] leading-[1.6]"
        style={{ color: 'var(--theme-text)' }}
      >
        {plan}
      </div>
    </div>
  )
}
