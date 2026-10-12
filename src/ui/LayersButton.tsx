import { lazy, Suspense, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// The panel loads on first tap; it is not needed to show the map.
const LayersPanel = lazy(() => import('./LayersPanel').then((m) => ({ default: m.LayersPanel })))

/** Round button for the map controls column; opens the map type and details panel. */
export function LayersButton() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={button}
        onClick={() => setOpen(true)}
        className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-700 shadow-md ring-1 ring-slate-200"
        aria-label="Map layers"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
          <path d="m12 3 9 5-9 5-9-5 9-5Z" />
          <path d="m3 12.5 9 5 9-5M3 16.5l9 5 9-5" />
        </svg>
      </button>
      {/* Portaled: the controls column is its own stacking context, under the sheet. */}
      {open &&
        createPortal(
          <Suspense fallback={null}>
            <LayersPanel
              onClose={() => {
                setOpen(false)
                button.current?.focus()
              }}
            />
          </Suspense>,
          document.body,
        )}
    </>
  )
}
