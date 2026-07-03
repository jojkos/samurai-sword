import { CARD_DEFS, CHARACTERS } from '../engine/cards'
import type { Card, CharacterId } from '../engine/types'
import { CHARACTER_KANJI } from './helpers'
import { CARD_ICONS } from './Icons'

/** A rendered playing card (ink & parchment style, pure CSS/SVG — original art). */
export function CardFace(props: {
  card: Card
  size?: 'hand' | 'mini'
  selected?: boolean
  dimmed?: boolean
  onClick?: (e: React.MouseEvent) => void
}) {
  const def = CARD_DEFS[props.card.kind]
  const mini = props.size === 'mini'
  const cls = [
    'card',
    `card-${def.type}`,
    mini ? 'card-mini' : 'card-hand',
    props.selected ? 'card-selected' : '',
    props.dimmed ? 'card-dimmed' : '',
    props.onClick ? 'card-clickable' : '',
  ].join(' ')
  const kanjiLen = def.kanji.length
  return (
    <div className={cls} onClick={props.onClick} title={`${def.name} — ${def.text}`}>
      <div className="card-frame" />
      {!mini && <div className="card-title">{def.name}</div>}
      {!mini && (
        <div className="card-art">
          <div className="card-art-wash" />
          {CARD_ICONS[props.card.kind]}
        </div>
      )}
      <div className={`card-kanji card-kanji-${kanjiLen >= 4 ? 'xl' : kanjiLen === 3 ? 'l' : 's'}`}>
        {def.kanji}
      </div>
      {def.type === 'weapon' && <WeaponStats difficulty={def.difficulty!} damage={def.damage!} />}
      {!mini && card_hint(props.card.kind)}
      <div className="card-typestrip" />
    </div>
  )
}

function card_hint(kind: string) {
  if (kind === 'parry') return <div className="card-corner-hint">受</div>
  return null
}

/** Weapon stats readable at a glance: arrow chip = reach, blood drops = wounds. */
export function WeaponStats(props: { difficulty: number; damage: number }) {
  return (
    <>
      <div className="card-stat card-stat-reach" title={`Reach — hits targets up to difficulty ${props.difficulty}`}>
        <ReachArrow />
        {props.difficulty}
      </div>
      <div className="card-stat card-stat-damage" title={`Deals ${props.damage} wound${props.damage > 1 ? 's' : ''}`}>
        {Array.from({ length: props.damage }, (_, i) => (
          <BloodDrop key={i} />
        ))}
      </div>
    </>
  )
}

function ReachArrow() {
  return (
    <svg viewBox="0 0 12 12" className="stat-icon" aria-hidden="true">
      <path
        d="M1.5 6 H9.5 M9.5 6 L6.6 3.4 M9.5 6 L6.6 8.6"
        stroke="currentColor"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BloodDrop() {
  return (
    <svg viewBox="0 0 10 14" className="stat-drop" aria-hidden="true">
      <path d="M5 0.8 C5.4 3.6 9 6.8 9 9.8 A4 4 0 1 1 1 9.8 C1 6.8 4.6 3.6 5 0.8 Z" fill="currentColor" />
    </svg>
  )
}

export function CardBack(props: { size?: 'hand' | 'mini' }) {
  return (
    <div className={`card card-back ${props.size === 'mini' ? 'card-mini' : 'card-hand'}`}>
      <div className="card-back-ring" />
      <div className="card-back-mon">侍</div>
    </div>
  )
}

/** Small character plate shown on each seat. */
export function CharacterPlate(props: { character: CharacterId }) {
  const def = CHARACTERS[props.character]
  return (
    <div className="char-plate" title={`${def.name} — ${def.text}`}>
      <span className="char-kanji">{CHARACTER_KANJI[props.character]}</span>
      <span className="char-name">{def.name}</span>
    </div>
  )
}

/** Honor / resilience token rows. */
export function Tokens(props: { kind: 'honor' | 'resilience'; value: number; max?: number }) {
  const items = []
  const max = props.max ?? props.value
  for (let i = 0; i < max; i++) {
    items.push(
      <span
        key={i}
        className={`token token-${props.kind} ${i < props.value ? '' : 'token-lost'}`}
      />,
    )
  }
  if (props.kind === 'honor' && props.value > max) {
    for (let i = max; i < props.value; i++) items.push(<span key={i} className="token token-honor" />)
  }
  return <span className={`tokens tokens-${props.kind}`} title={`${props.kind}: ${props.value}`}>{items}</span>
}
