import { useEffect, useState } from 'react'
import { backupFileName, exportBackup, restoreBackup } from '../db/backup'
import { clearAllData, loadSettings, saveSetting, type AppSettings } from '../db/settings'
import { refresh, startPipeline } from '../state/actions'
import { downloadJson } from './format'
import { Page } from './Page'

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void loadSettings().then(setSettings)
    void (async () => {
      const est = await navigator.storage?.estimate?.()
      const persisted = await navigator.storage?.persisted?.()
      setStorage({ usage: est?.usage, quota: est?.quota, persisted })
    })()
  }, [])

  const update = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    await saveSetting(key, value)
    setSettings((s) => (s ? { ...s, [key]: value } : s))
  }

  if (!settings) return <Page title="Settings">{null}</Page>

  return (
    <Page title="Settings">
      <Section title="Location lookup">
        <label className="block text-[14px] text-slate-700">
          Geocoder
          <select
            value={settings.geocoder}
            onChange={(e) => void update('geocoder', e.target.value as AppSettings['geocoder'])}
            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          >
            <option value="photon">Photon (fuzzy POI search)</option>
            <option value="nominatim">Nominatim (1 request per second)</option>
          </select>
        </label>
        <p className="mt-1 text-[13px] text-slate-500">Both are OpenStreetMap based, so results may be stored permanently. Sample data always uses the offline geocoder.</p>
      </Section>

      <Section title="AI (OpenRouter)">
        <label className="block text-[14px] text-slate-700">
          API key
          <input
            type="password"
            autoComplete="off"
            value={settings.openRouterKey}
            onChange={(e) => void update('openRouterKey', e.target.value)}
            placeholder="sk-or-…"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <p className="mt-1 text-[13px] text-slate-500">
          Stored only on this device and never included in backups. Used for disambiguation, classification and the assistant once those land. Set a monthly credit limit on the key.
        </p>
        <label className="mt-3 flex items-center gap-2 text-[14px] text-slate-700">
          <input type="checkbox" checked={settings.excludeNotesFromAI} onChange={(e) => void update('excludeNotesFromAI', e.target.checked)} />
          Never send my notes to AI calls
        </label>
      </Section>

      <Section title="Backup">
        <p className="text-[13px] text-slate-500">One JSON file with your places, lists, roles, tags and visits. Use it to move devices.</p>
        <div className="mt-2 flex gap-2">
          <button
            className="flex-1 rounded-lg bg-slate-900 py-2.5 text-[14px] font-medium text-white"
            onClick={async () => {
              downloadJson(await exportBackup(), backupFileName())
            }}
          >
            Export backup
          </button>
          <label className="flex-1 cursor-pointer rounded-lg bg-white py-2.5 text-center text-[14px] font-medium text-slate-800 ring-1 ring-slate-300">
            Restore backup
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file || !confirm('Replace all data on this device with this backup?')) return
                try {
                  await restoreBackup(JSON.parse(await file.text()))
                  await refresh()
                  void startPipeline()
                  setMessage('Backup restored.')
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : String(err))
                }
              }}
            />
          </label>
        </div>
        {message && <p className="mt-2 text-[14px] text-slate-700">{message}</p>}
      </Section>

      <Section title="Storage">
        {storage?.usage !== undefined && (
          <p className="text-[14px] text-slate-700">
            Using {(storage.usage / 1e6).toFixed(1)} MB{storage.quota ? ` of ${(storage.quota / 1e9).toFixed(1)} GB` : ''}.
          </p>
        )}
        <p className="mt-1 text-[13px] text-slate-500">
          {storage?.persisted
            ? 'Storage is persistent; the browser will not clear it on its own.'
            : 'Storage is not marked persistent yet. Install the app to your home screen (required on iOS) to keep data safe.'}
        </p>
        <button
          className="mt-3 rounded-lg bg-white px-3 py-2 text-[14px] font-medium text-red-700 ring-1 ring-red-200"
          onClick={async () => {
            if (!confirm('Delete all places, lists and edits on this device? Export a backup first if you need one.')) return
            await clearAllData()
            await refresh()
            setMessage('All data deleted.')
          }}
        >
          Delete all data
        </button>
      </Section>
    </Page>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  )
}
