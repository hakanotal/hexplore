import type { PlaceView } from './placeView'

export interface SearchDoc {
  id: string
  title: string
  text: string
}

export function toSearchDocs(views: PlaceView[]): SearchDoc[] {
  return views.map((v) => ({ id: v.id, title: v.place.title, text: v.searchText }))
}
