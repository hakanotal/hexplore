import { useMemo, useState } from 'react'
import type { ImportOutcome } from '../db/importRepo'
import { setListRoles } from '../db/listRepo'
import { clearAllData } from '../db/settings'
import { getDb } from '../db/db'
import type { List, ListRole } from '../domain/types'
import { importFiles, importSample, refresh, seedDemo, startPipeline } from '../state/actions'
import { useApp } from '../state/store'
import { ROLE_LABEL } from './format'
import { navigate } from './router'
import { Page } from './Page'

export function ImportScreen() {
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const lists = useApp((s) => s.lists)
  const unassigned = useMemo(() => lists.filter((l) => l.role === null), [lists])

  const run = async (label: string, fn: () => Promise<ImportOutcome | void>) => {
    setBusy(label)
    setError(null)
    try {
      const out = await fn()
      if (out) setOutcome(out)
      void startPipeline()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const onFiles = async (files: File[]) => {
    if (!files.length) return
    const source = (await getDb().settings.get('dataSource'))?.value
    if ((source === 'sample' || source === 'demo') && confirm('Remove the sample data before importing your own export?')) {
      await clearAllData()
      await refresh()
    }
    await run('Reading your export…', () => importFiles(files))
  }

  return (
    <Page title="Import">
      <section className="space-y-2 text-[15px] text-slate-700">
        <p>
          In <a className="text-blue-700 underline" href="https://takeout.google.com" target="_blank" rel="noreferrer">Google Takeout</a>, select{' '}
          <b>Saved</b> and <b>Maps (your places)</b>, download the zip and drop it here. The file is read on this device and never uploaded.
        </p>
        <p className="text-[13px] text-slate-500">Takeout only exports lists you created. Lists you joined from other people will not appear.</p>
      </section>

      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void onFiles([...e.dataTransfer.files])
        }}
        className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-10 text-center ${
          dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50'
        }`}
      >
        <span className="text-[16px] font-medium text-slate-800">Drop takeout.zip here</span>
        <span className="mt-1 text-[13px] text-slate-500">or tap to choose. List CSVs and Saved Places.json also work.</span>
        <input
          type="file"
          accept=".zip,.csv,.json,.geojson"
          multiple
          className="sr-only"
          data-testid="takeout-input"
          onChange={(e) => void onFiles([...(e.target.files ?? [])])}
        />
      </label>

      {busy && <p className="mt-4 text-[15px] text-slate-600" role="status">{busy}</p>}
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-[14px] text-red-800">{error}</p>}
      {outcome && <ImportSummary outcome={outcome} />}
      {unassigned.length > 0 && <RoleAssignment lists={unassigned} />}

      <section className="mt-8 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <h2 className="text-[15px] font-semibold text-slate-900">No export yet?</h2>
        <p className="mt-1 text-[13px] text-slate-600">
          A synthetic Takeout runs through the same import, resolution and classification steps, using an offline geocoder.
        </p>
        <div className="mt-3 grid gap-2">
          <button disabled={!!busy} onClick={() => run('Importing sample Takeout…', () => importSample(400, 1))} className="rounded-lg bg-slate-900 py-2.5 text-[15px] font-medium text-white disabled:opacity-50" data-testid="import-sample">
            Import sample Takeout (400 places)
          </button>
          <button disabled={!!busy} onClick={() => run('Importing a later sample export…', () => importSample(400, 2))} className="rounded-lg bg-white py-2.5 text-[15px] font-medium text-slate-800 ring-1 ring-slate-300 disabled:opacity-50">
            Simulate a later export (re-import)
          </button>
          <button disabled={!!busy} onClick={() => run('Generating 10,000 places…', () => seedDemo(10_000))} className="rounded-lg bg-white py-2.5 text-[15px] font-medium text-slate-800 ring-1 ring-slate-300 disabled:opacity-50">
            Load 10,000 demo places (performance)
          </button>
        </div>
      </section>
    </Page>
  )
}

function ImportSummary({ outcome }: { outcome: ImportOutcome }) {
  const c = outcome.plan.counts
  const rows: [string, number][] = [
    ['New places', c.newPlaces],
    ['Updated', c.updatedPlaces],
    ['Added to lists', c.newMemberships],
    ['Removed from lists', c.removedMemberships],
    ['Back in lists', c.restoredMemberships],
    ['New lists', c.newLists],
    ['Unchanged files skipped', c.skippedFiles],
    ['Need locating', c.needsResolve],
  ]
  return (
    <section className="mt-5 rounded-2xl bg-white p-4 ring-1 ring-slate-200" data-testid="import-summary">
      <h2 className="text-[15px] font-semibold text-slate-900">Import summary</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[14px]">
        {rows
          .filter(([, n]) => n > 0)
          .map(([label, n]) => (
            <div key={label} className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-600">{label}</dt>
              <dd className="font-medium tabular-nums text-slate-900" data-testid={`count-${label}`}>{n.toLocaleString()}</dd>
            </div>
          ))}
      </dl>
      {rows.every(([, n]) => n === 0) && <p className="mt-2 text-[14px] text-slate-600">Nothing changed since the last import.</p>}
      {outcome.plan.warnings.length > 0 && (
        <details className="mt-3 text-[13px] text-slate-600">
          <summary className="cursor-pointer">{outcome.plan.warnings.length} warnings</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {outcome.plan.warnings.slice(0, 50).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

const ROLES: ListRole[] = ['visited', 'wantToGo', 'favorite', 'other']

function RoleAssignment({ lists }: { lists: List[] }) {
  const [picked, setPicked] = useState<Record<string, ListRole>>({})
  const roles: Record<string, ListRole> = Object.fromEntries(lists.map((l) => [l.id, picked[l.id] ?? l.suggestedRole]))
  const setRoles = (next: Record<string, ListRole>) => setPicked(next)

  return (
    <section className="mt-5 rounded-2xl bg-white p-4 ring-1 ring-blue-200" data-testid="role-assignment">
      <h2 className="text-[15px] font-semibold text-slate-900">What does each list mean?</h2>
      <p className="mt-1 text-[13px] text-slate-600">Roles drive visited status, the "saved but never been" view and recommendations.</p>
      <div className="mt-3 space-y-3">
        {lists.map((l) => (
          <div key={l.id}>
            <div className="mb-1 flex items-center gap-2 text-[15px] font-medium text-slate-800">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
              {l.name}
            </div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Role for ${l.name}`}>
              {ROLES.map((r) => (
                <button
                  key={r}
                  role="radio"
                  aria-checked={roles[l.id] === r}
                  onClick={() => setRoles({ ...roles, [l.id]: r })}
                  className={`rounded-full px-3 py-1 text-[13px] ring-1 ${roles[l.id] === r ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-700 ring-slate-300'}`}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={async () => {
          await setListRoles(roles)
          await refresh()
          useApp.getState().requestFit()
          navigate('map')
        }}
        className="mt-4 w-full rounded-xl bg-blue-600 py-3 text-[15px] font-semibold text-white"
        data-testid="save-roles"
      >
        Save and show map
      </button>
    </section>
  )
}
