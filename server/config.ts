import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const settings = {
  maxRooms: ['PENJAT_MAX_ROOMS', 100_000],
  roomCreationRequests: ['PENJAT_ROOM_CREATION_REQUESTS', 1_000_000],
  roomCreationWindowSeconds: ['PENJAT_ROOM_CREATION_WINDOW_SECONDS', 86_400],
  roomPreviewRequests: ['PENJAT_ROOM_PREVIEW_REQUESTS', 1_000_000],
  roomPreviewWindowSeconds: ['PENJAT_ROOM_PREVIEW_WINDOW_SECONDS', 86_400],
  rateLimiterMaxEntries: ['PENJAT_RATE_LIMITER_MAX_ENTRIES', 1_000_000],
} as const
export type Limits = Readonly<Record<keyof typeof settings, number>>

/** Both npm development and Render production commands run from the project root. No code defaults override JSON. */
export function loadLimits(path = resolve('config/limits.json'), env: NodeJS.ProcessEnv = process.env): Limits {
  try {
    const json: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('expected a JSON object')
    const raw = json as Record<string, unknown>
    for (const key of Object.keys(raw)) if (!Object.hasOwn(settings, key)) throw new Error(`unknown setting ${key}`)
    const result = {} as Record<keyof typeof settings, number>
    for (const key of Object.keys(settings) as (keyof typeof settings)[]) {
      const [variable, max] = settings[key]
      // Validate JSON even when overridden, so a broken configuration never silently ships.
      if (!Number.isSafeInteger(raw[key]) || (raw[key] as number) < 1 || (raw[key] as number) > max) {
        throw new Error(`${key} must be an integer from 1 to ${max}`)
      }
      const override = env[variable]
      if (override !== undefined && (!/^[0-9]+$/.test(override) || !Number.isSafeInteger(Number(override)) || Number(override) < 1 || Number(override) > max)) {
        throw new Error(`${variable} must contain a decimal integer from 1 to ${max}`)
      }
      result[key] = override === undefined ? raw[key] as number : Number(override)
    }
    return Object.freeze(result)
  } catch (error) {
    throw new Error(`Invalid Penjat limits (${path}): ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const limits = loadLimits()
