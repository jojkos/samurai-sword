/* Sound — everything synthesized with the Web Audio API. No samples, no assets.
   Palette: koto plucks (UI/cards), sword shing + taiko (combat), metal clang
   (parry), gongs (honor/defeat), and an ambient night loop (wind + a sparse
   koto phrase in hirajoshi scale). Muted state persists in localStorage. */

const KEY = 'samurai-sword-sound'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null
let ambientStop: (() => void) | null = null
let unlocked = false
let enabled = typeof localStorage !== 'undefined' && localStorage.getItem(KEY) !== 'off'

function ac(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = 0.55
    master.connect(ctx.destination)
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return
      if (document.hidden) void ctx.suspend()
      else if (enabled) void ctx.resume()
    })
  }
  if (ctx.state === 'suspended' && !document.hidden) void ctx.resume()
  return ctx
}

function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

/** Gain node with a pluck/percussion envelope, wired to master. */
function env(c: AudioContext, t: number, peak: number, decay: number, attack = 0.004): GainNode {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  g.connect(master!)
  return g
}

/** Koto string: inharmonic triangle partials through a closing lowpass + pick noise. */
function pluck(f: number, vol = 0.25, decay = 0.6) {
  const c = ac()
  if (!c) return
  const t = c.currentTime
  const g = env(c, t, vol, decay, 0.002)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(f * 6, t)
  lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + decay)
  lp.connect(g)
  for (const [mult, v] of [
    [1, 1],
    [2.02, 0.4],
    [3.03, 0.15],
  ] as const) {
    const o = c.createOscillator()
    o.type = 'triangle'
    o.frequency.value = f * mult
    const og = c.createGain()
    og.gain.value = v
    o.connect(og)
    og.connect(lp)
    o.start(t)
    o.stop(t + decay + 0.05)
  }
  const pick = c.createBufferSource()
  pick.buffer = noise(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = f * 4
  bp.Q.value = 1.2
  pick.connect(bp)
  bp.connect(env(c, t, vol * 0.45, 0.03, 0.001))
  pick.start(t)
  pick.stop(t + 0.06)
}

/** Short filtered-noise whoosh (card draw / movement). */
function swish(vol = 0.1, dur = 0.09, freq = 900) {
  const c = ac()
  if (!c) return
  const t = c.currentTime
  const src = c.createBufferSource()
  src.buffer = noise(c)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = freq
  src.connect(lp)
  lp.connect(env(c, t, vol, dur, 0.008))
  src.start(t)
  src.stop(t + dur + 0.05)
}

/** Blade shing: rising bandpass noise sweep + a thin metallic ring. */
function shing() {
  const c = ac()
  if (!c) return
  const t = c.currentTime
  const src = c.createBufferSource()
  src.buffer = noise(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 4
  bp.frequency.setValueAtTime(2200, t)
  bp.frequency.exponentialRampToValueAtTime(7200, t + 0.13)
  src.connect(bp)
  bp.connect(env(c, t, 0.22, 0.16, 0.006))
  src.start(t)
  src.stop(t + 0.25)
  const ring = c.createOscillator()
  ring.type = 'sine'
  ring.frequency.value = 3520
  ring.connect(env(c, t + 0.04, 0.05, 0.22, 0.004))
  ring.start(t + 0.04)
  ring.stop(t + 0.3)
}

/** Taiko hit: pitch-dropping sine body + soft skin thump. */
function taiko(vol = 0.5) {
  const c = ac()
  if (!c) return
  const t = c.currentTime
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(130, t)
  o.frequency.exponentialRampToValueAtTime(46, t + 0.28)
  o.connect(env(c, t, vol, 0.34, 0.004))
  o.start(t)
  o.stop(t + 0.4)
  const thump = c.createBufferSource()
  thump.buffer = noise(c)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 220
  thump.connect(lp)
  lp.connect(env(c, t, vol * 0.6, 0.07, 0.002))
  thump.start(t)
  thump.stop(t + 0.12)
}

/** Metal-on-metal clang for a successful parry. */
function clang() {
  const c = ac()
  if (!c) return
  const t = c.currentTime
  for (const [f, v] of [
    [523, 0.09],
    [1244, 0.07],
    [1876, 0.05],
    [2742, 0.035],
  ] as const) {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    o.connect(env(c, t, v, 0.4, 0.002))
    o.start(t)
    o.stop(t + 0.45)
  }
  const hit = c.createBufferSource()
  hit.buffer = noise(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3000
  bp.Q.value = 1.5
  hit.connect(bp)
  bp.connect(env(c, t, 0.14, 0.04, 0.001))
  hit.start(t)
  hit.stop(t + 0.08)
}

/** Temple gong: slow-bloom inharmonic partials with a long tail. */
function gong(f = 180, vol = 0.28, decay = 1.4) {
  const c = ac()
  if (!c) return
  const t = c.currentTime
  for (const [mult, v] of [
    [1, 1],
    [1.48, 0.55],
    [2.67, 0.3],
    [3.98, 0.14],
  ] as const) {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = f * mult
    o.connect(env(c, t, vol * v, decay, 0.015))
    o.start(t)
    o.stop(t + decay + 0.1)
  }
}

/* D hirajoshi — the game's pitch home. */
const SCALE = [293.66, 311.13, 392, 440, 466.16, 587.33]

function startAmbient() {
  const c = ac()
  if (!c || ambientStop) return
  const bed = c.createGain()
  bed.gain.setValueAtTime(0.0001, c.currentTime)
  bed.gain.linearRampToValueAtTime(1, c.currentTime + 4)
  bed.connect(master!)

  // night wind: looped noise through a slowly wandering lowpass, breathing gain
  const wind = c.createBufferSource()
  wind.buffer = noise(c)
  wind.loop = true
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 260
  lp.Q.value = 0.7
  const wg = c.createGain()
  wg.gain.value = 0.045
  const drift = c.createOscillator()
  drift.frequency.value = 0.045
  const driftAmt = c.createGain()
  driftAmt.gain.value = 120
  drift.connect(driftAmt)
  driftAmt.connect(lp.frequency)
  const breathe = c.createOscillator()
  breathe.frequency.value = 0.07
  const breatheAmt = c.createGain()
  breatheAmt.gain.value = 0.018
  breathe.connect(breatheAmt)
  breatheAmt.connect(wg.gain)
  wind.connect(lp)
  lp.connect(wg)
  wg.connect(bed)
  wind.start()
  drift.start()
  breathe.start()

  // sparse koto phrase, one octave down, every ~14–24s
  let step = 0
  let phraseTimer = 0
  const noteTimers: number[] = []
  const phrase = () => {
    const count = 3 + (step % 3)
    for (let i = 0; i < count; i++) {
      noteTimers.push(
        window.setTimeout(
          () => pluck(SCALE[(step * 7 + i * 3) % SCALE.length] / 2, 0.09, 1.4),
          i * (480 + (i % 2) * 220),
        ),
      )
    }
    step++
    phraseTimer = window.setTimeout(phrase, 14000 + (step % 5) * 2500)
  }
  phraseTimer = window.setTimeout(phrase, 6000)

  ambientStop = () => {
    clearTimeout(phraseTimer)
    noteTimers.forEach(clearTimeout)
    wind.stop()
    drift.stop()
    breathe.stop()
    bed.disconnect()
  }
}

function stopAmbient() {
  ambientStop?.()
  ambientStop = null
}

export const sound = {
  isEnabled: () => enabled,
  setEnabled(on: boolean) {
    enabled = on
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off')
    } catch {
      /* private mode */
    }
    if (!on) {
      stopAmbient()
      void ctx?.suspend()
    } else {
      void ctx?.resume()
      if (unlocked) startAmbient()
    }
  },
  /** Call from the first user gesture — browsers gate audio behind one. */
  unlock() {
    if (unlocked) return
    unlocked = true
    if (ac()) startAmbient()
  },
  uiClick: () => pluck(660, 0.07, 0.15),
  cardPlay: () => {
    pluck(SCALE[Math.floor(Math.random() * SCALE.length)], 0.18, 0.5)
    swish(0.07, 0.08, 1100)
  },
  draw: () => swish(0.1, 0.1, 900),
  attack: () => shing(),
  wound: () => taiko(0.5),
  parry: () => clang(),
  honorLost: () => gong(180, 0.2, 1.1),
  defeat: () => gong(120, 0.32, 2),
  yourTurn: () => {
    pluck(SCALE[5], 0.16, 0.7)
    setTimeout(() => pluck(SCALE[3], 0.12, 0.7), 130)
  },
  alert: () => {
    pluck(SCALE[4], 0.16, 0.35)
    setTimeout(() => pluck(SCALE[5], 0.16, 0.45), 110)
  },
  playerJoin: () => pluck(SCALE[5], 0.14, 0.6),
  victory: () => {
    ;[0, 2, 3, 5].forEach((n, i) => setTimeout(() => pluck(SCALE[n], 0.2, 0.9), i * 160))
    setTimeout(() => gong(150, 0.26, 2.2), 700)
  },
}
