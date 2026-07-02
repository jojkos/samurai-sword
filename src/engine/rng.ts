/** Deterministic PRNG (mulberry32). State is a 32-bit int kept in GameState. */
export function nextRandom(state: number): { value: number; state: number } {
  let a = (state + 0x6d2b79f5) | 0
  let t = a
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return { value, state: a }
}

/** Random int in [0, n). Returns new rng state. */
export function randInt(state: number, n: number): { value: number; state: number } {
  const r = nextRandom(state)
  return { value: Math.floor(r.value * n), state: r.state }
}

/** Fisher–Yates shuffle. Returns a new array and the new rng state. */
export function shuffle<T>(arr: T[], state: number): { arr: T[]; state: number } {
  const a = arr.slice()
  let s = state
  for (let i = a.length - 1; i > 0; i--) {
    const r = randInt(s, i + 1)
    s = r.state
    ;[a[i], a[r.value]] = [a[r.value], a[i]]
  }
  return { arr: a, state: s }
}
