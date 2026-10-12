import { useRef, useState, type ReactNode } from 'react'
import { useApp, type SheetSnap } from '../state/store'

// Three snap points, built for one-handed use: peek shows the count and active
// filters, half shows the list, full gives the list the whole screen.

const SNAPS: SheetSnap[] = ['peek', 'half', 'full']

function snapHeight(s: SheetSnap): number {
  const h = window.innerHeight
  return s === 'peek' ? 132 : s === 'half' ? Math.round(h * 0.5) : h - 68
}

export function BottomSheet({ header, children }: { header: ReactNode; children: ReactNode }) {
  const sheet = useApp((s) => s.sheet)
  const setSheet = useApp((s) => s.setSheet)
  const [drag, setDrag] = useState<number | null>(null)
  const start = useRef<{ y: number; h: number } | null>(null)

  const height = drag ?? snapHeight(sheet)

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { y: e.clientY, h: snapHeight(sheet) }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return
    setDrag(Math.max(96, Math.min(window.innerHeight - 40, start.current.h + start.current.y - e.clientY)))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return
    const moved = Math.abs(e.clientY - start.current.y)
    const h = drag ?? start.current.h
    start.current = null
    setDrag(null)
    if (moved < 6) {
      // A tap on the handle cycles up, and from full back to peek.
      setSheet(SNAPS[(SNAPS.indexOf(sheet) + 1) % SNAPS.length]!)
      return
    }
    const nearest = SNAPS.reduce((best, s) => (Math.abs(snapHeight(s) - h) < Math.abs(snapHeight(best) - h) ? s : best), sheet)
    setSheet(nearest)
  }

  return (
    <section
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-2xl bg-white dark:bg-slate-900 shadow-[0_-4px_24px_rgba(15,23,42,0.15)]"
      style={{ height, transition: drag === null ? 'height 220ms cubic-bezier(.2,.8,.2,1)' : 'none' }}
      data-testid="sheet"
      data-snap={sheet}
    >
      <div
        className="flex shrink-0 cursor-grab touch-none flex-col items-stretch px-4 pb-2 pt-2"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden />
        {header}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}
