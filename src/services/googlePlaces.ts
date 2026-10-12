import type { BusinessStatus } from '../domain/types'
import { cached, fetchJson, HttpError } from './http'

// Google Places API (New), Place Details. The place ID the API takes is a
// base64url protobuf of the two halves of the feature ID in list URLs, so every
// saved place is looked up by ID: no name search and no ambiguity.
//
// Results are stored permanently. Google's terms allow keeping only place IDs
// beyond 30 days; the owner accepted that for this private, self-hosted app.

export const PLACES_URL = 'https://places.googleapis.com/v1/places'

/**
 * Billed at the highest tier among these: Pro (displayName, primaryType,
 * businessStatus), 5,000 free calls a month. Opening hours, rating and website
 * are Enterprise with only 1,000 free, so they stay out.
 */
export const PLACE_FIELDS = 'id,displayName,location,formattedAddress,types,primaryType,businessStatus'

export interface GooglePlace {
  placeId: string
  name?: string
  lat: number
  lng: number
  address?: string
  types: string[]
  primaryType?: string
  businessStatus?: BusinessStatus
}

interface DetailsResponse {
  id?: string
  displayName?: { text?: string }
  location?: { latitude?: number; longitude?: number }
  formattedAddress?: string
  types?: string[]
  primaryType?: string
  businessStatus?: BusinessStatus
}

/** "0x14cab9e7a7777c43:0x4c76cf3dcc8b330b" -> "ChIJQ3x3p-e5yhQRCzOLzD3Pdkw" */
export function fidToPlaceId(fid: string): string | undefined {
  const m = /^0x([0-9a-f]{1,16}):0x([0-9a-f]{1,16})$/i.exec(fid.trim())
  if (!m) return undefined
  const cell = BigInt(`0x${m[1]}`)
  // Review URLs zero the first half; that is not a usable ID.
  if (cell === 0n) return undefined
  // message { fixed64 cell = 1; fixed64 cid = 2; } wrapped as field 1, 18 bytes long
  const bytes = new Uint8Array(20)
  const view = new DataView(bytes.buffer)
  bytes.set([0x0a, 0x12, 0x09])
  view.setBigUint64(3, cell, true)
  bytes[11] = 0x11
  view.setBigUint64(12, BigInt(`0x${m[2]}`), true)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface CallBudget {
  /** Reserves one billable call; false once this month's allowance is used. */
  take(): Promise<boolean>
}

export interface PlaceDetailsService {
  readonly id: string
  /** Null when the feature ID has no usable place ID, Google no longer knows it, or the budget is used up. */
  details(fid: string, signal?: AbortSignal): Promise<GooglePlace | null>
}

class BudgetExhausted extends Error {}

export class GooglePlaces implements PlaceDetailsService {
  readonly id = 'google'
  private readonly key: string
  private readonly budget: CallBudget

  constructor(key: string, budget: CallBudget) {
    this.key = key
    this.budget = budget
  }

  async details(fid: string, signal?: AbortSignal): Promise<GooglePlace | null> {
    const placeId = fidToPlaceId(fid)
    if (!placeId) return null
    try {
      // Cached forever, including "not found", so nothing is billed twice.
      return await cached(`google:${placeId}`, async () => {
        if (!(await this.budget.take())) throw new BudgetExhausted()
        return this.fetchDetails(placeId, signal)
      })
    } catch (err) {
      if (err instanceof BudgetExhausted) return null
      throw err
    }
  }

  private async fetchDetails(placeId: string, signal?: AbortSignal): Promise<GooglePlace | null> {
    // Key and field mask as query parameters keep this a simple GET without a CORS preflight.
    const url = `${PLACES_URL}/${placeId}?${new URLSearchParams({ fields: PLACE_FIELDS, key: this.key })}`
    let json: DetailsResponse
    try {
      json = await fetchJson<DetailsResponse>(url, { signal })
    } catch (err) {
      // 400 also covers a bad key, so only 404 counts as "Google no longer knows this place".
      if (err instanceof HttpError && err.status === 404) return null
      throw err
    }
    const lat = json.location?.latitude
    const lng = json.location?.longitude
    if (typeof lat !== 'number' || typeof lng !== 'number') return null
    return {
      placeId: json.id ?? placeId,
      name: json.displayName?.text,
      lat,
      lng,
      address: json.formattedAddress,
      types: json.types ?? [],
      primaryType: json.primaryType,
      businessStatus: json.businessStatus,
    }
  }
}
