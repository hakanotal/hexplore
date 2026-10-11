import type { ReactNode } from 'react'
import { navigate } from './router'

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex flex-col bg-white">
      <header className="flex items-center gap-2 border-b border-slate-200 px-2 py-2">
        <button onClick={() => navigate('map')} className="grid h-10 w-10 place-items-center rounded-full text-slate-700 hover:bg-slate-100" aria-label="Back to map">
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M12.8 4.2a.75.75 0 0 1 0 1.06L8.06 10l4.74 4.74a.75.75 0 1 1-1.06 1.06l-5.27-5.27a.75.75 0 0 1 0-1.06l5.27-5.27a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
          </svg>
        </button>
        <h1 className="text-[17px] font-semibold text-slate-900">{title}</h1>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 overflow-y-auto px-4 py-5">{children}</main>
    </div>
  )
}
