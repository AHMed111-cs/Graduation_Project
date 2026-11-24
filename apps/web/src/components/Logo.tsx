import { useState } from 'react'

/**
 * Uses the official files from /public (never redrawn or recoloured):
 *  full: naqb-logo-dark.png on the dark UI | mark: naqb-mark-512.png
 * If a file is missing, a plain "NAQB" wordmark shows instead of a broken image.
 */
export function Logo({ variant = 'full', className = 'h-16' }: { variant?: 'full' | 'dark' | 'mark'; className?: string }) {
  const [failed, setFailed] = useState(false)
  const src = variant === 'mark' ? '/naqb-mark-512.png' : '/naqb-logo-dark.png'
  if (failed) return <span className="font-bold tracking-wide text-naqb">{variant === 'mark' ? 'N' : 'NAQB'}</span>
  return <img src={src} alt="NAQB" className={className} onError={() => setFailed(true)} />
}

/** Mark + NAQB, for the sidebar header and for "Configuration required" / error screens. */
export function MarkAndName({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo variant="mark" className="h-8 w-8 shrink-0" />
      {!collapsed && <span className="text-lg font-bold tracking-[0.18em] text-fg">NAQB</span>}
    </span>
  )
}
