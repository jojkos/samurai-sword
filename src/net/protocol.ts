import type { Intent, PlayerView } from '../engine/types'

export interface LobbyPlayer {
  seat: number
  name: string
  connected: boolean
  isHost: boolean
}

export type GuestMsg =
  | { t: 'hello'; name: string; token: string }
  | { t: 'intent'; intent: Intent }

export type HostMsg =
  | { t: 'lobby'; players: LobbyPlayer[]; yourSeat: number; code: string }
  | { t: 'view'; view: PlayerView }
  | { t: 'error'; message: string }
  | { t: 'rejected'; reason: string }

export const PEER_PREFIX = 'samurai-sword-v1-'

export function roomToPeerId(code: string): string {
  return PEER_PREFIX + code.toUpperCase()
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L

export function newRoomCode(): string {
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

export function newToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}
