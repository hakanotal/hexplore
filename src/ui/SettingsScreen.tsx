import { useEffect, useState } from 'react'
import { backupFileName, exportBackup, restoreBackup } from '../db/backup'
import { clearAllData, ENV_GOOGLE_PLACES_KEY, GOOGLE_MONTHLY_LIMIT, googleUsage, loadSettings, saveSetting, type AppSettings, type GoogleUsage } from '../db/settings'
import { refresh, startPipeline } from '../state/actions'
import { useTheme, type ThemeChoice } from '../state/theme'
import { downloadJson } from './format'
import { Page } from './Page'

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [usage, setUsage] = useState<GoogleUsage | null>(null)

  useEffect(() => {
    void loadSettings().then(setSettings)
    void googleUsage().then(setUsage)
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
      <Section title="Appearance">
        <ThemePicker />
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">The light and dark map types follow along; satellite and streets stay as you set them.</p>
      </Section>

      <Section title="Location lookup">
        <label className="block text-[14px] text-slate-700 dark:text-slate-300">
          Geocoder
          <select
            value={settings.geocoder}
            onChange={(e) => void update('geocoder', e.target.value as AppSettings['geocoder'])}
            className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2"
          >
            <option value="photon">Photon (fuzzy POI search)</option>
            <option value="nominatim">Nominatim (1 request per second)</option>
          </select>
        </label>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">Both are OpenStreetMap based, so results may be stored permanently. Sample data always uses the offline geocoder.</p>
      </Section>

      <Section title="Google Places">
        <label className="block text-[14px] text-slate-700 dark:text-slate-300">
          API key
          <input
            type="password"
            autoComplete="off"
            value={settings.googlePlacesKey}
            onChange={(e) => void update('googlePlacesKey', e.target.value)}
            placeholder={ENV_GOOGLE_PLACES_KEY ? 'Using PLACES_API_KEY from .env' : 'AIza…'}
            className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2"
          />
        </label>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
          Looks up each saved place by its Google ID for an exact position, type and open or closed status. Results are stored on this device.
          {usage && ` ${usage.calls.toLocaleString()} of ${GOOGLE_MONTHLY_LIMIT.toLocaleString()} lookups used this month (Google's free allowance is 5,000); past that, OpenStreetMap takes over.`}
        </p>
      </Section>

      <Section title="AI (OpenRouter)">
        <label className="block text-[14px] text-slate-700 dark:text-slate-300">
          API key
          <input
            type="password"
            autoComplete="off"
            value={settings.openRouterKey}
            onChange={(e) => void update('openRouterKey', e.target.value)}
            placeholder="sk-or-…"
            className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2"
          />
        </label>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
          Stored only on this device and never included in backups. Used for disambiguation, classification and the assistant once those land. Set a monthly credit limit on the key.
        </p>
        <label className="mt-3 flex items-center gap-2 text-[14px] text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={settings.excludeNotesFromAI} onChange={(e) => void update('excludeNotesFromAI', e.target.checked)} />
          Never send my notes to AI calls
        </label>
      </Section>

      <Section title="Backup">
        <p className="text-[13px] text-slate-500 dark:text-slate-400">One JSON file with your places, lists, roles, tags and visits. Use it to move devices.</p>
        <div className="mt-2 flex gap-2">
          <button
            className="flex-1 rounded-lg bg-slate-900 dark:bg-slate-100 dark:text-slate-900 py-2.5 text-[14px] font-medium text-white"
            onClick={async () => {
              downloadJson(await exportBackup(), backupFileName())
            }}
          >
            Export backup
          </button>
          <label className="flex-1 cursor-pointer rounded-lg bg-white dark:bg-slate-900 py-2.5 text-center text-[14px] font-medium text-slate-800 dark:text-slate-200 ring-1 ring-slate-300 dark:ring-slate-600">
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
        {message && <p className="mt-2 text-[14px] text-slate-700 dark:text-slate-300">{message}</p>}
      </Section>

      <Section title="Storage">
        {storage?.usage !== undefined && (
          <p className="text-[14px] text-slate-700 dark:text-slate-300">
            Using {(storage.usage / 1e6).toFixed(1)} MB{storage.quota ? ` of ${(storage.quota / 1e9).toFixed(1)} GB` : ''}.
          </p>
        )}
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
          {storage?.persisted
            ? 'Storage is persistent; the browser will not clear it on its own.'
            : 'Storage is not marked persistent yet. Install the app to your home screen (required on iOS) to keep data safe.'}
        </p>
        <button
          className="mt-3 rounded-lg bg-white dark:bg-slate-900 px-3 py-2 text-[14px] font-medium text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-900"
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
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
      {children}
    </section>
  )
}

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

function ThemePicker() {
  const theme = useTheme((s) => s.theme)
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      {THEMES.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={theme === t.id}
          onClick={() => useTheme.getState().setTheme(t.id)}
          className={`rounded-md py-1.5 text-[14px] ${theme === t.id ? 'bg-white font-medium text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
