import type { CardKind } from '../engine/types'

/**
 * Brush-style card icons — original art, drawn in code.
 * Convention: 48x48 viewBox, ink strokes (#211c16), round caps, slightly bowed
 * "straight" lines for a hand-drawn feel, exactly one vermilion accent per icon.
 */

const INK = '#211c16'
const RED = '#c3282f'

const base = {
  fill: 'none',
  stroke: INK,
  strokeWidth: 4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function Svg(props: { children: React.ReactNode }) {
  return (
    <svg className="card-icon" viewBox="0 0 48 48" aria-hidden="true">
      <g {...base}>{props.children}</g>
    </svg>
  )
}

export const CARD_ICONS: Record<CardKind, JSX.Element> = {
  // ---------- weapons ----------
  bokken: (
    <Svg>
      <path d="M11 40 Q22 27 37 11" />
      <path d="M13 33 L19 38" strokeWidth={3.2} />
      <circle cx="10" cy="41" r="1.6" fill={RED} stroke="none" />
    </Svg>
  ),
  kiseru: (
    <Svg>
      <path d="M6 32 Q22 35 40 27" strokeWidth={3.5} />
      <circle cx="41" cy="25.5" r="3.2" strokeWidth={3.2} />
      <path d="M5 33 L9 34.5" strokeWidth={4} />
      <path d="M41 18 q-3 -3 0 -6 q2.5 -2.5 0.5 -5" stroke={RED} strokeWidth={2.6} />
    </Svg>
  ),
  bo: (
    <Svg>
      <path d="M9 41 Q24 23 39 7" />
      <path d="M17 30 L21 34" strokeWidth={2.9} />
      <path d="M28 18 L32 22" strokeWidth={2.9} stroke={RED} />
    </Svg>
  ),
  shuriken: (
    <Svg>
      <path d="M24 6 L29 19 L24 24 L19 19 Z" strokeWidth={3.2} />
      <path d="M24 42 L19 29 L24 24 L29 29 Z" strokeWidth={3.2} />
      <path d="M6 24 L19 19 L24 24 L19 29 Z" strokeWidth={3.2} />
      <path d="M42 24 L29 29 L24 24 L29 19 Z" strokeWidth={3.2} />
      <circle cx="24" cy="24" r="3" stroke={RED} strokeWidth={2.9} />
    </Svg>
  ),
  kusarigama: (
    <Svg>
      <path d="M15 42 L17 24" strokeWidth={4.2} />
      <path d="M17 24 Q14 10 32 8" />
      <circle cx="21" cy="30" r="1.7" strokeWidth={2.4} />
      <circle cx="26" cy="34" r="1.7" strokeWidth={2.4} />
      <circle cx="31" cy="37" r="1.7" strokeWidth={2.4} />
      <rect x="34" y="37" width="6" height="6" rx="1" fill={RED} stroke="none" />
    </Svg>
  ),
  nagayari: (
    <Svg>
      <path d="M8 42 Q23 27 34 15" strokeWidth={3.5} />
      <path d="M34 15 Q34 8 40 6 Q42 12 37 17 Q35 17 34 15 Z" strokeWidth={2.9} />
      <path d="M31 19 q-4 4 -7 2" stroke={RED} strokeWidth={2.6} />
    </Svg>
  ),
  kanabo: (
    <Svg>
      <path d="M12 42 L28 10" strokeWidth={4.5} />
      <path d="M18 42 L34 12" strokeWidth={4.5} />
      <path d="M28 10 Q31 8 34 12" strokeWidth={4} />
      <circle cx="27" cy="19" r="1.3" fill={INK} stroke="none" />
      <circle cx="30" cy="14" r="1.3" fill={INK} stroke="none" />
      <circle cx="23" cy="26" r="1.3" fill={INK} stroke="none" />
      <path d="M13 38 L18 40" stroke={RED} strokeWidth={2.9} />
    </Svg>
  ),
  naginata: (
    <Svg>
      <path d="M8 43 Q20 32 29 21" strokeWidth={3.5} />
      <path d="M29 21 Q28 10 39 5 Q40 16 32 23 Q30 23 29 21 Z" strokeWidth={2.9} />
      <path d="M27 24 L31 27" stroke={RED} strokeWidth={3.2} />
    </Svg>
  ),
  daikyu: (
    <Svg>
      <path d="M14 4 Q34 22 16 44" strokeWidth={3.7} />
      <path d="M14 5 L16 43" strokeWidth={2.1} />
      <path d="M6 22 L38 26" strokeWidth={2.9} />
      <path d="M38 26 L33 22 M38 26 L33 29" strokeWidth={2.6} />
      <path d="M8 20 L11 24 M6 25 L10 27" stroke={RED} strokeWidth={2.6} />
    </Svg>
  ),
  tanegashima: (
    <Svg>
      <path d="M5 34 L14 30 L18 31 L42 21" strokeWidth={3.7} />
      <path d="M6 38 L13 34" strokeWidth={4.5} />
      <path d="M20 33 L21 36" strokeWidth={2.6} />
      <path d="M44 17 l-2 3 m4 0 l-4 1 m2 -6 l-3 4" stroke={RED} strokeWidth={2.4} />
    </Svg>
  ),
  wakizashi: (
    <Svg>
      <path d="M16 32 Q24 22 34 13" strokeWidth={3.7} />
      <ellipse cx="15" cy="33.5" rx="3" ry="2.4" strokeWidth={2.6} transform="rotate(-45 15 33.5)" />
      <path d="M13 36 L8 41" strokeWidth={4.5} />
      <path d="M10.5 37.5 l2 2" stroke={RED} strokeWidth={2.6} />
    </Svg>
  ),
  katana: (
    <Svg>
      <path d="M14 34 Q26 22 41 7" strokeWidth={3.7} />
      <path d="M18 31 Q29 20 38 11" strokeWidth={1.6} stroke={RED} />
      <ellipse cx="13" cy="35.5" rx="3" ry="2.4" strokeWidth={2.6} transform="rotate(-45 13 35.5)" />
      <path d="M11 38 L5 44" strokeWidth={4.5} />
    </Svg>
  ),
  nodachi: (
    <Svg>
      <circle cx="28" cy="20" r="8" fill={RED} stroke="none" opacity={0.55} />
      <path d="M10 38 Q26 26 44 4" strokeWidth={4} />
      <path d="M9 39 L3 45" strokeWidth={4.5} />
      <path d="M6.5 40.5 l2 2 M9.5 43.5 l-2 -2" strokeWidth={2.4} />
    </Svg>
  ),

  // ---------- actions ----------
  parry: (
    <Svg>
      <path d="M24 5 L24 43" strokeWidth={3.7} />
      <path d="M8 34 Q24 20 42 16" strokeWidth={4} />
      <path d="M22 22 l4 4 m0 -4 l-4 4 m2 -6 l0 8" stroke={RED} strokeWidth={2.1} />
    </Svg>
  ),
  geisha: (
    <Svg>
      <path d="M24 40 L10 14 M24 40 L18 11 M24 40 L24 9 M24 40 L30 11 M24 40 L38 14" strokeWidth={2.9} />
      <path d="M10 14 Q24 4 38 14" strokeWidth={3.5} />
      <circle cx="24" cy="15" r="2.4" fill={RED} stroke="none" />
    </Svg>
  ),
  diversion: (
    <Svg>
      <rect x="20" y="12" width="18" height="26" rx="2" strokeWidth={3.2} transform="rotate(12 29 25)" />
      <path d="M8 10 Q20 12 27 22" strokeWidth={3.2} />
      <path d="M27 22 l-6 -1 m6 1 l-1 -6" stroke={RED} strokeWidth={2.9} />
      <path d="M10 30 l5 -2 M12 36 l5 -3" strokeWidth={2.4} />
    </Svg>
  ),
  jiujitsu: (
    <Svg>
      <circle cx="24" cy="26" r="15" strokeWidth={3.5} strokeDasharray="70 25" />
      <circle cx="33" cy="13" r="3.4" fill={RED} stroke="none" />
      <path d="M9 20 l-2 6 m2 -6 l5 2" strokeWidth={2.9} />
    </Svg>
  ),
  battlecry: (
    <Svg>
      <path d="M17 28 Q11 20 17 12 Q24 6 30 12 Q35 20 29 28 Q23 32 17 28 Z" strokeWidth={3.2} />
      <path d="M23 30 L21 43" strokeWidth={4} />
      <path d="M35 22 q4 -3 4 -7 M37 28 q6 -3 7 -10 M38 34 q8 -4 9 -14" stroke={RED} strokeWidth={2.6} />
    </Svg>
  ),
  teaceremony: (
    <Svg>
      <path d="M10 24 Q10 36 24 36 Q38 36 38 24 Z" strokeWidth={3.5} />
      <path d="M18 40 L30 40" strokeWidth={3.2} />
      <path d="M19 18 q-3 -4 0 -8 M27 18 q3 -4 0 -8" stroke={RED} strokeWidth={2.6} />
    </Svg>
  ),
  daimyo: (
    <Svg>
      <path d="M12 26 Q12 12 24 12 Q36 12 36 26 L33 30 L15 30 Z" strokeWidth={3.2} />
      <path d="M8 30 Q11 24 15 26 M40 30 Q37 24 33 26" strokeWidth={2.9} />
      <path d="M19 10 Q24 2 29 10 Q26 8 24 8 Q22 8 19 10 Z" fill={RED} stroke="none" />
    </Svg>
  ),
  breathing: (
    <Svg>
      <path d="M30 7 A17 17 0 1 0 41 20" strokeWidth={4.5} />
      <path d="M40 13 l6 0 M41 18 l5 0" strokeWidth={2.4} />
      <path d="M42 8.5 l4 0" stroke={RED} strokeWidth={2.6} />
    </Svg>
  ),

  // ---------- properties ----------
  focus: (
    <Svg>
      <circle cx="24" cy="24" r="16" strokeWidth={4.2} />
      <circle cx="24" cy="24" r="3" fill={RED} stroke="none" />
    </Svg>
  ),
  armor: (
    <Svg>
      <path d="M12 12 L36 12 L38 30 Q31 38 24 38 Q17 38 10 30 Z" strokeWidth={3.5} />
      <path d="M12 19 L36 19 M11 25 L37 25 M12 31 L36 31" strokeWidth={2.4} />
      <path d="M11 25 L37 25" stroke={RED} strokeWidth={2.4} />
      <path d="M14 12 L12 7 M34 12 L36 7" strokeWidth={2.9} />
    </Svg>
  ),
  quickdraw: (
    <Svg>
      <path d="M6 40 Q20 34 36 22" strokeWidth={4.2} />
      <path d="M22 30 Q32 20 42 8" strokeWidth={3.5} />
      <path d="M8 26 l7 -2 M6 20 l7 -2 M9 14 l6 -2" stroke={RED} strokeWidth={2.6} />
    </Svg>
  ),
  bushido: (
    <Svg>
      <path d="M8 14 Q24 8 40 14" strokeWidth={4} />
      <path d="M11 20 L37 20" strokeWidth={3.2} />
      <path d="M14 20 L14 42 M34 20 L34 42" strokeWidth={3.7} />
      <path d="M18 32 A6 6 0 0 1 30 32 Z" fill={RED} stroke="none" />
    </Svg>
  ),
}
