import type { Job } from '../domain/types'

export function enqueueJobs(stage: Job['stage'], placeIds: string[], now = Date.now()): Job[] {
  return placeIds.map((placeId) => ({
    id: `${stage}:${placeId}`,
    stage,
    placeId,
    status: 'queued',
    attempts: 0,
    notBefore: now,
    updatedAt: now,
  }))
}
