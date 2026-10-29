import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

function normalizeIp(raw: string | undefined) {
  if (!raw || !isIP(raw) || raw.includes('%')) return undefined
  // URL canonicalizes equivalent IPv6 spellings; mapped IPv4 shares the native IPv4 bucket.
  const ip = isIP(raw) === 6 ? new URL(`http://[${raw}]/`).hostname.slice(1, -1) : raw
  if (ip.startsWith('::ffff:')) {
    const parts = ip.slice(7).split(':')
    if (parts.length === 2) {
      const value = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16)
      return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
    }
  }
  return ip
}

/** RENDER is platform metadata, never a request header. Render's public ingress passes through Cloudflare. */
export function clientIp(request: Pick<IncomingMessage, 'headers' | 'socket'>, renderIngress = process.env.RENDER === 'true') {
  const forwarded = request.headers['cf-connecting-ip']
  if (renderIngress && typeof forwarded === 'string') {
    const ip = normalizeIp(forwarded)
    if (ip) return ip
  }
  // Missing/malformed trusted metadata fails closed into the peer bucket; never trust arbitrary forwarding chains.
  return normalizeIp(request.socket.remoteAddress) ?? 'unknown'
}
