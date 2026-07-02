import { CARD_DEFS, CHARACTERS } from '../engine/cards'
import type { Card, CharacterId } from '../engine/types'
import { CHARACTER_KANJI } from './helpers'

/** A rendered playing card (ink & parchment style, pure CSS/SVG — original art). */
export function CardFace(props: {
  card: Card
  size?: 'hand' | 'mini'
  selected?: boolean
  dimmed?: boolean
  onClick?: () => void
}) {
  const def = CARD_DEFS[props.card.kind]
  const cls = [
    'card',
    `card-${def.type}`,
    props.size === 'mini' ? 'card-mini' : 'card-hand',
    props.selected ? 'card-selected' : '',
    props.dimmed ? 'card-dimmed' : '',
    props.onClick ? 'card-clickable' : '',
  ].join(' ')
  return (
    <div className={cls} onClick={props.onClick} title={`${def.name} — ${def.text}`}>
      <div className="card-frame" />
      <div className="card-kanji">{def.kanji}</div>
      <div className="card-name">{def.name}</div>
      {def.type === 'weapon' && (
        <>
          <div className="card-seal card-difficulty" title="Difficulty">{def.difficulty}</div>
          <div className="card-seal card-damage" title="Wounds">{def.damage}</div>
        </>
      )}
      {props.card.kind === 'parry' && <div className="card-corner-hint">受</div>}
    </div>
  )
}

export function CardBack(props: { size?: 'hand' | 'mini' }) {
  return (
    <div className={`card card-back ${props.size === 'mini' ? 'card-mini' : 'card-hand'}`}>
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
