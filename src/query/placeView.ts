import type { List, ListRole, Membership, Place, UserData } from '../domain/types'
import { categoryLabel } from '../domain/taxonomy'

/** A place joined with its memberships and user data, with derived flags. */
export interface PlaceView {
  id: string
  place: Place
  lat?: number
  lng?: number
  listIds: string[]
  visited: boolean
  wantToGo: boolean
  favorite: boolean
  needsReview: boolean
  notes: string[]
  /** AI tags, user tags and Google tags, lowercased and deduped. */
  tags: string[]
  user?: UserData
  /** Title, category, tags, notes and area names joined, for search and embeddings. */
  searchText: string
}

export interface ViewInput {
  places: Place[]
  memberships: Membership[]
  lists: List[]
  userData: UserData[]
}

function splitTags(s: string | undefined): string[] {
  return s ? s.split(/[,;]/).map((t) => t.trim().toLowerCase()).filter(Boolean) : []
}

export function buildViews({ places, memberships, lists, userData }: ViewInput): PlaceView[] {
  const roleOf = new Map<string, ListRole | null>(lists.map((l) => [l.id, l.role]))
  const byPlace = new Map<string, Membership[]>()
  for (const m of memberships) {
    if (m.removedAt !== undefined) continue
    const arr = byPlace.get(m.placeId)
    if (arr) arr.push(m)
    else byPlace.set(m.placeId, [m])
  }
  const userBy = new Map(userData.map((u) => [u.placeId, u]))

  const views: PlaceView[] = []
  for (const place of places) {
    const ms = byPlace.get(place.id) ?? []
    const user = userBy.get(place.id)
    // A place whose every membership was removed stays in storage (with its
    // enrichment) but leaves the map until it shows up in a list again.
    if (!ms.length && !user?.pinned && !user?.visits.length) continue
    const roles = ms.map((m) => roleOf.get(m.listId))
    const visited = roles.includes('visited') || (user?.visits.length ?? 0) > 0
    const notes = ms.flatMap((m) => [m.note, m.comment]).filter((n): n is string => !!n)
    if (user?.userNote) notes.push(user.userNote)
    const tags = [...new Set([...place.aiTags, ...(user?.userTags ?? []), ...ms.flatMap((m) => splitTags(m.googleTags))].map((t) => t.toLowerCase()))]
    const lat = user?.manualLat ?? place.lat
    const lng = user?.manualLng ?? place.lng
    views.push({
      id: place.id,
      place,
      lat,
      lng,
      listIds: ms.map((m) => m.listId),
      visited,
      wantToGo: !visited && roles.includes('wantToGo'),
      favorite: roles.includes('favorite'),
      needsReview: place.resolveStatus === 'review' || place.resolveStatus === 'flagged',
      notes,
      tags,
      user,
      searchText: [
        place.title,
        place.category ? categoryLabel(place.category) : '',
        place.subcategory?.replace(/_/g, ' ') ?? '',
        tags.join(' '),
        notes.join(' '),
        place.neighborhood ?? '',
        place.city ?? '',
        place.country ?? '',
      ]
        .filter(Boolean)
        .join(' '),
    })
  }
  return views
}
