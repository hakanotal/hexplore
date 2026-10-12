import { useRef, useState } from 'react'
import { useApp } from '../state/store'

// Draw around the places you want: the trace becomes the "drawn area" filter.
// Loaded only when you start drawing; while it is up it takes the pointer
// from the map so the drag draws instead of panning.

const MAX_POINTS = 60

export function LassoOverlay({ onDone }: { onDone: () => void }) {
  const [points, setPoints] = useState<[number, number][]>([])
  const drawing = useRef(false)

  const finish = () => {
    drawing.current = false
    const pick = useApp.getState().pickPoint
    if (pick && points.length >= 3) {
      const step = Math.ceil(points.length / MAX_POINTS)
      const ring = points.filter((_, i) => i % step === 0).map(([x, y]) => pick(x, y))
      useApp.getState().setFilters({ area: ring.map((p) => [p.lng, p.lat]), bbox: undefined })
      useApp.getState().setSheet('half')
    }
    onDone()
  }

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-30 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        drawing.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        setPoints([[e.clientX, e.clientY]])
      }}
      onPointerMove={(e) => drawing.current && setPoints((p) => [...p, [e.clientX, e.clientY]])}
      onPointerUp={finish}
      onPointerCancel={onDone}
      data-testid="lasso"
    >
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        {points.length > 1 && (
          <polygon points={points.map((p) => p.join(',')).join(' ')} fill="rgba(124,58,237,0.12)" stroke="#7c3aed" strokeWidth={2.5} strokeLinejoin="round" />
        )}
      </svg>
      {!points.length && (
        <div className="absolute inset-x-6 top-24 rounded-xl bg-slate-900/85 px-4 py-3 text-center text-[14px] text-white">
          Draw around the places you want to see.{' '}
          <button
            className="ml-1 underline"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onDone()
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
