/**
 * InkScene — the "living ink painting" backdrop for the home screen.
 *
 * A sumi-e landscape that paints itself on load: mountain ridges drawn as
 * brush strokes (stroke-dashoffset choreography via pathLength="1"), ink
 * washes that bleed in behind them, a vermilion sun that blooms, bamboo
 * drawing itself up the left edge, a crane gliding near the sun, and
 * petals drifting down as idle life. Everything is code-generated SVG/CSS —
 * no image assets. Mounted only while the home screen shows; other screens
 * keep the night SceneBackdrop.
 *
 * SSR-safe: pure JSX, no window/matchMedia access.
 */

/** deterministic petal field — left %, fall duration s, delay s, scale, drift px */
const PETALS: Array<[number, number, number, number, number]> = [
  [12, 13, 2.5, 1, 40],
  [26, 16, 7, 0.8, -30],
  [38, 12, 4.5, 1.1, 55],
  [52, 17, 9.5, 0.75, -45],
  [63, 14, 3.5, 0.95, 35],
  [74, 15, 11, 0.85, -25],
  [84, 12.5, 6, 1.05, 50],
  [93, 16.5, 8.5, 0.7, -35],
  [45, 18, 13, 0.9, 30],
]

export function InkScene() {
  return (
    <div className="ink-scene" aria-hidden="true">
      {/* #ink-brush is mounted globally by SharedFilterDefs; #ink-bleed is only
          used by the daylight painting, so it stays local here */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="ink-bleed" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="4" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="12" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      {/* washi paper — visible instantly, the canvas everything paints onto */}
      <div className="ink-paper" />

      {/* vermilion sun — blooms in, then breathes */}
      <div className="ink-sun" />

      {/* crane gliding near the sun — three-stroke sumi-e bird */}
      <svg className="ink-crane" viewBox="0 0 200 120">
        <g className="ink-crane-body">
          {/* far wing, raised */}
          <path d="M96 56 Q118 18 168 6" fill="none" stroke="#3a342b" strokeWidth="6.5" strokeLinecap="round" opacity="0.6" />
          <path d="M97 55 Q116 26 152 13" fill="none" stroke="#3a342b" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
          {/* near wing, sweeping down */}
          <path d="M94 60 Q124 84 166 94" fill="none" stroke="#26211a" strokeWidth="7.5" strokeLinecap="round" opacity="0.75" />
          <path d="M95 61 Q120 78 150 84" fill="none" stroke="#26211a" strokeWidth="3.5" strokeLinecap="round" opacity="0.5" />
          {/* body → neck → head */}
          <path d="M104 60 Q76 52 46 40" fill="none" stroke="#26211a" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
          <path d="M46 40 L30 33" fill="none" stroke="#26211a" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
          {/* red crown — the tancho */}
          <circle cx="46" cy="38" r="2.6" fill="#c3282f" opacity="0.85" />
          {/* trailing legs */}
          <path d="M104 62 Q130 68 148 62" fill="none" stroke="#3a342b" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        </g>
      </svg>

      {/* bamboo — draws itself up the left edge; leaves flick in after */}
      <svg className="ink-bamboo" viewBox="0 0 180 800" preserveAspectRatio="xMinYMax meet">
        {/* main stalk */}
        <path
          className="ink-stalk ink-stalk-1" pathLength="1"
          d="M52 810 C44 660 50 500 42 340 C39 250 44 160 38 70"
          fill="none" stroke="#3f3a30" strokeWidth="13" strokeLinecap="round"
        />
        {/* companion stalk, thinner and paler */}
        <path
          className="ink-stalk ink-stalk-2" pathLength="1"
          d="M112 810 C106 680 112 540 104 400 C100 320 106 240 100 150"
          fill="none" stroke="#57503f" strokeWidth="8" strokeLinecap="round"
        />
        {/* node ticks — paper shows through the joints */}
        <g className="ink-nodes" stroke="#f2e8cf" strokeWidth="4" strokeLinecap="round">
          <path d="M38 665 q 10 -3 24 0" fill="none" />
          <path d="M40 520 q 10 -3 22 0" fill="none" />
          <path d="M36 372 q 10 -3 22 0" fill="none" />
          <path d="M35 228 q 9 -3 20 0" fill="none" />
          <path d="M103 640 q 7 -2 16 0" fill="none" />
          <path d="M100 470 q 7 -2 16 0" fill="none" />
          <path d="M98 300 q 7 -2 15 0" fill="none" />
        </g>
        {/* leaves — tapered fills flicking out from the stalks */}
        <g className="ink-leaves" fill="#33302a">
          <path className="ink-leaf" d="M42 92 q 44 -20 86 -14 q -40 26 -86 14 Z" opacity="0.75" />
          <path className="ink-leaf" d="M40 110 q 30 22 74 24 q -44 12 -74 -24 Z" opacity="0.6" />
          <path className="ink-leaf" d="M40 74 q 18 -34 52 -46 q -16 38 -52 46 Z" opacity="0.68" />
          <path className="ink-leaf" d="M104 168 q 38 -16 72 -8 q -34 22 -72 8 Z" opacity="0.5" />
          <path className="ink-leaf" d="M102 188 q 26 20 62 20 q -38 12 -62 -20 Z" opacity="0.42" />
          <path className="ink-leaf" d="M40 246 q 34 6 60 24 q -40 4 -60 -24 Z" opacity="0.45" />
        </g>
      </svg>

      {/* mountain ridges — the big strokes of the painting */}
      <svg className="ink-mountains" viewBox="0 0 1200 300" preserveAspectRatio="none">
        {/* far ridge: stroke draws, wash bleeds in behind it */}
        <path
          className="ink-wash ink-wash-1"
          d="M-20 200 Q150 120 320 170 Q420 200 520 160 Q660 100 800 165 Q920 210 1060 150 Q1140 122 1220 150 L1220 300 L-20 300 Z"
          fill="#4a4238"
        />
        <path
          className="ink-ridge ink-ridge-1" pathLength="1"
          d="M-20 200 Q150 120 320 170 Q420 200 520 160 Q660 100 800 165 Q920 210 1060 150 Q1140 122 1220 150"
          fill="none" stroke="#26211a" strokeWidth="5" strokeLinecap="round"
        />
        {/* near ridge: darker, lower */}
        <path
          className="ink-wash ink-wash-2"
          d="M-20 252 Q180 206 380 236 Q560 264 740 226 Q940 188 1220 240 L1220 300 L-20 300 Z"
          fill="#332d25"
        />
        <path
          className="ink-ridge ink-ridge-2" pathLength="1"
          d="M-20 252 Q180 206 380 236 Q560 264 740 226 Q940 188 1220 240"
          fill="none" stroke="#1d1913" strokeWidth="4" strokeLinecap="round"
        />
      </svg>

      {/* mist band lying between the ridges */}
      <div className="ink-mist" />

      {/* drifting petals — idle life */}
      <div className="ink-petals">
        {PETALS.map(([left, dur, delay, scale, drift], i) => (
          <span
            key={i}
            style={{
              left: `${left}%`,
              animationDuration: `${dur}s`,
              animationDelay: `${delay}s`,
              ['--petal-scale' as string]: scale,
              ['--petal-drift' as string]: `${drift}px`,
            }}
          />
        ))}
      </div>

      {/* deckled paper edges — a quiet vignette so the painting has borders */}
      <div className="ink-vignette" />
    </div>
  )
}
