import { useSyncExternalStore } from 'react'

// Hash routes for the few full-screen pages; filters live in the query string.

export type Route = 'map' | 'import' | 'settings'

function current(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  return h === 'import' || h === 'settings' ? h : 'map'
}

export function navigate(route: Route): void {
  location.hash = route === 'map' ? '' : `/${route}`
  if (route === 'map') history.replaceState(history.state, '', location.pathname + location.search)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb)
      return () => window.removeEventListener('hashchange', cb)
    },
    current,
    () => 'map',
  )
}
