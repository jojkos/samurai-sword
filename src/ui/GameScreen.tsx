import { useEffect, useMemo, useRef, useState } from 'react'
import { CARD_DEFS, CHARACTERS } from '../engine/cards'
import type { Card, Pending, PlayerView, PublicPlayer } from '../engine/types'
import type { Session } from '../net/session'
import { CardBack, CardFace, CharacterPlate, Tokens } from './Cards'
import {
  baseHonor,
  cardAction,
  cardKindInText,
  CHARACTER_KANJI,
  HIDDEN_ROLE_TEXT,
  ROLE_GOAL,
  ROLE_INFO,
  TEAM_LABEL,
  viewAttackDifficulty,
  weaponStatLines,
  type TargetMode,
} from './helpers'
import { sound } from './sound'

export function GameScreen(props: { view: PlayerView; session: Session; onLeave: () => void }) {
  const { view, session } = props
  const [targetMode, setTargetMode] = useState<TargetMode | null>(null)
  const [geishaSeat, setGeishaSeat] = useState<number | null>(null)
  const [inspect, setInspect] = useState<Card | null>(null)
  const [infoSeat, setInfoSeat] = useState<number | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const touch = useTouchDevice()
  const [impact, setImpact] = useState<{ seat: number; n: number } | null>(null)
  const prevView = useRef(view)

  // detect wounds between view updates → impact flash + table shake + sound cues
  useEffect(() => {
    const prev = prevView.current
    prevView.current = view
    if (prev === view) return
    const mine = view.players[view.seat]
    const mineBefore = prev.players[view.seat]
    if (mineBefore && mine.handCount > mineBefore.handCount) sound.draw()
    if (view.players.some((p) => prev.players[p.seat] && p.honor < prev.players[p.seat].honor))
      sound.honorLost()
    if (
      view.players.some(
        (p) => prev.players[p.seat] && p.resilience === 0 && prev.players[p.seat].resilience > 0,
      )
    )
      sound.defeat()
    if (view.prompt && !prev.prompt) sound.alert()
    if (view.phase === 'play' && view.turnSeat === view.seat && prev.turnSeat !== view.seat)
      sound.yourTurn()
    if (view.result && !prev.result) sound.victory()
    for (let i = prev.log.length; i < view.log.length; i++) {
      if (/parr/i.test(view.log[i].text)) {
        sound.parry()
        break
      }
    }
    const hit = view.players.find((p) => {
      const before = prev.players[p.seat]
      return before && p.resilience < before.resilience
    })
    if (hit) {
      sound.wound()
      setImpact((old) => ({ seat: hit.seat, n: (old?.n ?? 0) + 1 }))
      const t = setTimeout(() => setImpact(null), 600)
      return () => clearTimeout(t)
    }
  }, [view])

  const me = view.players[view.seat]
  const myTurn =
    view.phase === 'play' && view.turnSeat === view.seat && !view.prompt && view.waitingFor === null

  // clear stale targeting when the view changes turn/prompt
  useEffect(() => {
    if (!myTurn) {
      setTargetMode(null)
      setGeishaSeat(null)
    }
  }, [myTurn])

  useEffect(() => {
    if (blocked) {
      const t = setTimeout(() => setBlocked(null), 2500)
      return () => clearTimeout(t)
    }
  }, [blocked])

  function clickHandCard(card: Card) {
    // touch: no hover exists, so the first tap opens the inspect sheet and the
    // Play button (or a second tap on the same card) commits the action
    if (touch && inspect?.id !== card.id) {
      sound.uiClick()
      setInspect(card)
      return
    }
    setInspect(null)
    actOn(card)
  }

  function actOn(card: Card) {
    if (!myTurn) return
    if (targetMode?.card.id === card.id) {
      setTargetMode(null)
      return
    }
    const action = cardAction(view, card)
    if ('blocked' in action) setBlocked(action.blocked)
    else if ('play' in action) {
      sound.cardPlay()
      session.sendIntent(
        CARD_DEFS[card.kind].type === 'property'
          ? { t: 'playProperty', card: card.id }
          : { t: 'playAction', card: card.id },
      )
    } else {
      sound.uiClick()
      setTargetMode(action.target)
    }
    setGeishaSeat(null)
  }

  function clickSeat(seat: number) {
    if (!targetMode) {
      // not aiming anything — a tap on a seat explains that warrior instead
      sound.uiClick()
      setInfoSeat(seat)
      return
    }
    if (!targetMode.targets.includes(seat)) {
      const target = view.players[seat]
      const def = CARD_DEFS[targetMode.card.kind]
      if (seat === view.seat) setBlocked('You cannot target yourself')
      else if (target.harmless) setBlocked(`${target.name} is Harmless and cannot be targeted`)
      else if (targetMode.kind === 'weapon') {
        setBlocked(
          `Out of reach — difficulty ${viewAttackDifficulty(view, view.seat, seat)} exceeds ${def.name}'s ${def.difficulty}`,
        )
      } else setBlocked(`${target.name} cannot be targeted by ${def.name}`)
      return
    }
    const card = targetMode.card.id
    switch (targetMode.kind) {
      case 'weapon':
        sound.attack()
        session.sendIntent({ t: 'playWeapon', card, target: seat })
        break
      case 'diversion':
      case 'breathing':
        sound.cardPlay()
        session.sendIntent({ t: 'playAction', card, target: seat })
        break
      case 'bushido':
        sound.cardPlay()
        session.sendIntent({ t: 'playProperty', card, target: seat })
        break
      case 'geisha':
        setGeishaSeat(seat)
        return // submenu takes it from here
    }
    setTargetMode(null)
  }

  const seatCount = view.playerCount
  const narrow = useNarrowViewport()
  const positions = useMemo(() => {
    // narrow screens pull the ring inward so edge seats stay on-screen
    const radiusX = narrow ? 36 : 41
    return view.players.map((p) => {
      const rel = (p.seat - view.seat + seatCount) % seatCount
      const angle = Math.PI / 2 + (rel * 2 * Math.PI) / seatCount
      // your own seat sits a touch higher so the hand fan never covers it
      const radiusY = rel === 0 ? 33 : 38
      return {
        left: 50 + radiusX * Math.cos(angle),
        top: 50 + radiusY * Math.sin(angle),
      }
    })
  }, [view.seat, seatCount, view.players, narrow])

  const playedProperty = (card: Card) => {
    if (!myTurn) return
    session.sendIntent({ t: 'playProperty', card: card.id })
  }

  return (
    <div className="game">
      <Embers />
      <div className={`table-scene ${impact ? 'shake' : ''}`}>
        <div className="table">
          <div className="table-inner" />
          <div className="table-center">
            <div className="pile">
              <span className="pile-shadow" aria-hidden="true" />
              {view.deckCount > 0 ? (
                <>
                  {view.deckCount > 1 && <span className="pile-edges" aria-hidden="true" />}
                  <CardBack size="mini" />
                </>
              ) : (
                <div className="pile-empty" />
              )}
              <span className="pile-count">{view.deckCount}</span>
            </div>
            <div className="pile">
              <span className="pile-shadow" aria-hidden="true" />
              {view.discardTop ? (
                <>
                  {view.discardCount > 1 && <span className="pile-edges" aria-hidden="true" />}
                  <CardFace
                    key={view.discardTop.id}
                    card={view.discardTop}
                    size="mini"
                    onClick={() => setInspect(view.discardTop)}
                  />
                </>
              ) : (
                <div className="pile-empty" />
              )}
              <span className="pile-count">{view.discardCount}</span>
            </div>
          </div>

          {view.players.map((p) => (
            <Seat
              key={p.seat}
              player={p}
              view={view}
              style={{ left: `${positions[p.seat].left}%`, top: `${positions[p.seat].top}%` }}
              isYou={p.seat === view.seat}
              isTurn={view.turnSeat === p.seat && view.phase === 'play'}
              targetable={!!targetMode?.targets.includes(p.seat)}
              hit={impact?.seat === p.seat ? impact.n : 0}
              aiming={targetMode !== null}
              waiting={view.waitingFor === p.seat}
              difficulty={
                targetMode?.kind === 'weapon' && p.seat !== view.seat && !p.harmless
                  ? viewAttackDifficulty(view, view.seat, p.seat)
                  : null
              }
              onClick={() => clickSeat(p.seat)}
              onInspectCard={(c) => setInspect(c)}
            />
          ))}
        </div>
      </div>

      <StatusBar
        view={view}
        myTurn={myTurn}
        onShowRole={() => setInfoSeat(view.seat)}
        onLeave={() => setConfirmLeave(true)}
      />

      {blocked && <div className="toast toast-info">{blocked}</div>}
      {targetMode && (
        <div className="toast toast-info">
          Choose a target for {CARD_DEFS[targetMode.card.kind].name} — or click the card again to cancel.
        </div>
      )}

      <Hand view={view} myTurn={myTurn} targetMode={targetMode} onCardClick={clickHandCard} />

      <Controls view={view} myTurn={myTurn} session={session} onPlayProperty={playedProperty} />

      {geishaSeat !== null && targetMode?.kind === 'geisha' && (
        <GeishaMenu
          view={view}
          seat={geishaSeat}
          onPick={(propertyCard) => {
            session.sendIntent({
              t: 'playAction',
              card: targetMode.card.id,
              target: geishaSeat,
              ...(propertyCard != null ? { propertyCard } : {}),
            })
            setTargetMode(null)
            setGeishaSeat(null)
          }}
          onCancel={() => setGeishaSeat(null)}
        />
      )}

      {infoSeat !== null && (
        <SeatInfoModal
          view={view}
          seat={infoSeat}
          onInspect={(card) => setInspect(card)}
          onClose={() => setInfoSeat(null)}
        />
      )}

      {inspect && (
        <InspectOverlay
          card={inspect}
          view={view}
          myTurn={myTurn}
          onPlay={() => {
            const c = inspect
            setInspect(null)
            actOn(c)
          }}
          onClose={() => setInspect(null)}
        />
      )}

      {confirmLeave && (
        <div className="modal-backdrop" onClick={() => setConfirmLeave(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Leave the duel?</h2>
            <p>
              {session.startGame
                ? 'You are the host — leaving closes the room for everyone.'
                : 'Your seat stays at the table; you can rejoin this room with the same name while the duel lasts.'}
            </p>
            <div className="result-actions">
              <button className="btn btn-danger" onClick={props.onLeave}>Leave</button>
              <button className="btn" onClick={() => setConfirmLeave(false)}>Stay</button>
            </div>
          </div>
        </div>
      )}

      {view.prompt && <PromptModal view={view} prompt={view.prompt} session={session} />}
      {view.waitingFor !== null && (
        <div className="waiting-banner pulse">
          Waiting for {view.players[view.waitingFor].name}…
        </div>
      )}

      <LogPanel view={view} />

      {view.result && <ResultOverlay view={view} session={session} onLeave={props.onLeave} />}
    </div>
  )
}

/** True on touch-first devices (no hover); SSR-safe (no matchMedia in node → false). */
function useTouchDevice() {
  const [touch, setTouch] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches,
  )
  useEffect(() => {
    const mq = matchMedia('(hover: none)')
    const onChange = () => setTouch(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return touch
}

/** True below the phone breakpoint; SSR-safe (no matchMedia in node → false). */
function useNarrowViewport() {
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 640px)').matches,
  )
  useEffect(() => {
    const mq = matchMedia('(max-width: 640px)')
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

// ---------------- ambient embers ----------------

/** Drifting lantern embers. Deterministic per index (SSR-safe). */
function Embers() {
  const embers = Array.from({ length: 12 }, (_, i) => {
    const h = (i * 2654435761) % 1000
    return {
      left: `${4 + ((h % 92))}%`,
      delay: `${(h % 140) / 10}s`,
      duration: `${11 + (h % 9)}s`,
      scale: 0.6 + ((h % 5) / 6),
    }
  })
  return (
    <div className="embers" aria-hidden="true">
      {embers.map((e, i) => (
        <span
          key={i}
          className="ember"
          style={{
            left: e.left,
            animationDelay: e.delay,
            animationDuration: e.duration,
            transform: `scale(${e.scale})`,
          }}
        />
      ))}
    </div>
  )
}

// ---------------- seat ----------------

function Seat(props: {
  player: PublicPlayer
  view: PlayerView
  style: React.CSSProperties
  isYou: boolean
  isTurn: boolean
  targetable: boolean
  aiming: boolean
  hit: number
  waiting: boolean
  difficulty: number | null
  onClick: () => void
  onInspectCard: (card: Card) => void
}) {
  const { player: p, view } = props
  // your own role is always known to you; others only when the view reveals it
  const role = props.isYou ? view.you.role : p.role
  const cls = [
    'seat',
    props.isYou ? 'seat-you' : '',
    props.isTurn ? 'seat-turn' : '',
    props.targetable ? 'seat-targetable' : '',
    props.aiming && !props.targetable && !props.isYou ? 'seat-outofreach' : '',
    p.harmless ? 'seat-harmless' : '',
  ].join(' ')
  return (
    <div className={cls} style={props.style} onClick={props.onClick}>
      {props.hit > 0 && <div key={props.hit} className="seat-impact" />}
      {props.difficulty !== null && <div className="seat-difficulty">{props.difficulty}</div>}
      <div className="seat-name">{p.name}</div>
      {role && (
        <div className={`seat-role-badge role-badge-${ROLE_INFO[role].team}`}>
          {ROLE_INFO[role].kanji} {ROLE_INFO[role].name}
        </div>
      )}
      <CharacterPlate character={p.character} />
      <div className="seat-tokens">
        <Tokens kind="resilience" value={p.resilience} max={p.maxResilience} />
        <Tokens kind="honor" value={p.honor} max={Math.max(baseHonor(view, p.seat), p.honor)} />
      </div>
      {!props.isYou && (
        <div className="seat-handcount" title={`${p.handCount} cards in hand`}>
          <CardBack size="mini" /> ×{p.handCount}
        </div>
      )}
      {p.properties.length > 0 && (
        <div className="seat-properties">
          {p.properties.map((c) => (
            <CardFace
              key={c.id}
              card={c}
              size="mini"
              onClick={(e) => {
                e.stopPropagation()
                props.onInspectCard(c)
              }}
            />
          ))}
        </div>
      )}
      {p.harmless && <div className="seat-harmless-tag">harmless 無害</div>}
      {props.waiting && <div className="seat-waiting pulse">…</div>}
    </div>
  )
}

// ---------------- status / controls / hand ----------------

function StatusBar(props: {
  view: PlayerView
  myTurn: boolean
  onShowRole: () => void
  onLeave: () => void
}) {
  const { view } = props
  const role = ROLE_INFO[view.you.role]
  return (
    <div className="statusbar">
      <button
        className={`role-badge role-${role.team}`}
        onClick={props.onShowRole}
        title="Your role — click for what it means"
      >
        <span className="role-glyph">{role.kanji}</span>
        {role.name}
      </button>
      <span className={`turn-indicator ${props.myTurn ? 'turn-yours' : ''}`}>
        {view.phase === 'ended'
          ? 'the duel is over'
          : props.myTurn
            ? 'Your turn'
            : `${view.players[view.turnSeat].name}'s turn`}
      </span>
      {props.myTurn && (
        <span className="weapons-left">
          weapons {view.weaponsPlayed}/{view.weaponsAllowed}
        </span>
      )}
      <button className="role-badge leave-btn" onClick={props.onLeave} title="Leave the duel">
        leave 退
      </button>
    </div>
  )
}

/** Full-screen card inspect: any card, readable, with plain-language rules. */
function InspectOverlay(props: {
  card: Card
  view: PlayerView
  myTurn: boolean
  onPlay: () => void
  onClose: () => void
}) {
  const def = CARD_DEFS[props.card.kind]
  const inHand = props.view.you.hand.some((c) => c.id === props.card.id)
  let canPlay = false
  let blockedReason: string | null = null
  if (inHand) {
    if (!props.myTurn) blockedReason = 'Not your turn'
    else {
      const action = cardAction(props.view, props.card)
      if ('blocked' in action) blockedReason = action.blocked
      else canPlay = true
    }
  }
  return (
    <div className="inspect-backdrop" onClick={props.onClose}>
      <div className="inspect-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="inspect-card">
          <CardFace card={props.card} />
        </div>
        <div className="inspect-body">
          <div className="card-inspect-name">
            {def.name}
            <span className="card-inspect-kanji">{def.kanji}</span>
          </div>
          <span className={`inspect-type inspect-type-${def.type}`}>{def.type}</span>
          {def.type === 'weapon' && (
            <ul className="inspect-stats">
              {weaponStatLines(def).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          <p>{def.text}</p>
          <div className="inspect-actions">
            {canPlay && (
              <button className="btn btn-primary" onClick={props.onPlay}>
                Play
              </button>
            )}
            {blockedReason && <span className="inspect-blocked">{blockedReason}</span>}
            <button className="btn btn-ghost" onClick={props.onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Everything about one warrior, spelled out — tap any seat to open. */
function SeatInfoModal(props: {
  view: PlayerView
  seat: number
  onInspect: (card: Card) => void
  onClose: () => void
}) {
  const { view, seat } = props
  const p = view.players[seat]
  const isYou = seat === view.seat
  const role = isYou ? view.you.role : p.role
  const char = CHARACTERS[p.character]
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal seat-info" onClick={(e) => e.stopPropagation()}>
        <h2>
          {p.name}
          {isYou ? ' — you' : ''}
        </h2>

        <div className="info-section">
          {role ? (
            <>
              <span className={`seat-role-badge role-badge-${ROLE_INFO[role].team} role-badge-large`}>
                {ROLE_INFO[role].kanji} {ROLE_INFO[role].name}
              </span>
              <p>{ROLE_GOAL[role]}</p>
              {isYou && role !== 'shogun' && (
                <p className="info-hint">Only you can see this. Keep it secret.</p>
              )}
            </>
          ) : (
            <>
              <span className="seat-role-badge role-badge-hidden">役 secret role</span>
              <p>{HIDDEN_ROLE_TEXT}</p>
            </>
          )}
        </div>

        <div className="info-section">
          <h3>
            <span className="char-kanji">{CHARACTER_KANJI[p.character]}</span> {char.name}
          </h3>
          <p>{char.text}</p>
          <p className="info-meta">
            Resilience {p.resilience}/{p.maxResilience} · Honor {p.honor} · {p.handCount} card
            {p.handCount === 1 ? '' : 's'} in hand
            {p.harmless ? ' · Harmless (cannot be attacked, does not count for distance)' : ''}
          </p>
          {!isYou && !p.harmless && (
            <p className="info-meta">
              Attack difficulty from you: {viewAttackDifficulty(view, view.seat, seat)}
            </p>
          )}
        </div>

        {p.properties.length > 0 && (
          <div className="info-section">
            <h3>In play</h3>
            {p.properties.map((c) => (
              <p key={c.id} className="info-property" onClick={() => props.onInspect(c)}>
                <strong>{CARD_DEFS[c.kind].name}</strong> — {CARD_DEFS[c.kind].text}
              </p>
            ))}
          </div>
        )}

        <button className="btn" onClick={props.onClose}>Close</button>
      </div>
    </div>
  )
}

function Hand(props: {
  view: PlayerView
  myTurn: boolean
  targetMode: TargetMode | null
  onCardClick: (card: Card) => void
}) {
  const { view } = props
  const n = view.you.hand.length
  // hover-inspect: after a short dwell, show an enlarged card + rules text above the fan
  const [inspectId, setInspectId] = useState<number | null>(null)
  const inspectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (inspectTimer.current) clearTimeout(inspectTimer.current) }, [])
  const beginInspect = (id: number) => {
    if (inspectTimer.current) clearTimeout(inspectTimer.current)
    inspectTimer.current = setTimeout(() => setInspectId(id), 280)
  }
  const endInspect = () => {
    if (inspectTimer.current) clearTimeout(inspectTimer.current)
    setInspectId(null)
  }
  const inspected = inspectId !== null ? view.you.hand.find((c) => c.id === inspectId) : undefined
  return (
    <div className="hand" onMouseLeave={endInspect}>
      {inspected && (
        <div className="card-inspect" aria-hidden="true">
          <div className="card-inspect-card">
            <CardFace card={inspected} />
          </div>
          <div className="card-inspect-text">
            <div className="card-inspect-name">
              {CARD_DEFS[inspected.kind].name}
              <span className="card-inspect-kanji">{CARD_DEFS[inspected.kind].kanji}</span>
            </div>
            <p>{CARD_DEFS[inspected.kind].text}</p>
          </div>
        </div>
      )}
      {view.you.hand.map((card, i) => (
        <div
          key={card.id}
          className="hand-slot"
          style={{
            ['--fan' as string]: `${(i - (n - 1) / 2) * Math.min(8, 40 / Math.max(n, 1))}deg`,
            ['--lift' as string]: `${Math.abs(i - (n - 1) / 2) * 7}px`,
          }}
          onMouseEnter={() => beginInspect(card.id)}
        >
          <CardFace
            card={card}
            selected={props.targetMode?.card.id === card.id}
            dimmed={!props.myTurn}
            onClick={() => props.onCardClick(card)}
          />
        </div>
      ))}
    </div>
  )
}

function Controls(props: {
  view: PlayerView
  myTurn: boolean
  session: Session
  onPlayProperty: (card: Card) => void
}) {
  const { view, myTurn, session } = props
  if (!myTurn) return null
  const me = view.players[view.seat]
  const nobunagaReady = me.character === 'nobunaga' && me.resilience >= 2
  return (
    <div className="controls">
      {nobunagaReady && (
        <button
          className="btn btn-small"
          onClick={() => session.sendIntent({ t: 'nobunaga' })}
          title="Nobunaga: discard 1 Resilience (not the last) to draw 1 card"
        >
          信長 sacrifice 1 ♥ → draw
        </button>
      )}
      <button className="btn btn-primary" onClick={() => session.sendIntent({ t: 'endTurn' })}>
        End turn
      </button>
    </div>
  )
}

// ---------------- geisha submenu ----------------

function GeishaMenu(props: {
  view: PlayerView
  seat: number
  onPick: (propertyCard: number | null) => void
  onCancel: () => void
}) {
  const target = props.view.players[props.seat]
  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Geisha visits {target.name}</h2>
        <p>Choose what they must discard:</p>
        <div className="modal-cards">
          {target.properties.map((c) => (
            <CardFace key={c.id} card={c} onClick={() => props.onPick(c.id)} />
          ))}
          {target.handCount > 0 && (
            <div className="modal-choice" onClick={() => props.onPick(null)}>
              <CardBack />
              <span>Random card from hand</span>
            </div>
          )}
        </div>
        <button className="btn btn-ghost" onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ---------------- prompts ----------------

function PromptModal(props: { view: PlayerView; prompt: Pending; session: Session }) {
  const { view, prompt, session } = props
  const me = view.players[view.seat]
  const hand = view.you.hand
  const isWeapon = (c: Card) => CARD_DEFS[c.kind].type === 'weapon'
  const hanzoOk = me.character === 'hanzo' && hand.length >= 2

  switch (prompt.type) {
    case 'parry': {
      const attacker = view.players[prompt.attackerSeat]
      const weaponDef = CARD_DEFS[prompt.weaponCard.kind]
      const options = hand.filter((c) => c.kind === 'parry' || (hanzoOk && isWeapon(c)))
      return (
        <Modal title={`${attacker.name} attacks you!`}>
          <div className="modal-cards">
            <CardFace card={prompt.weaponCard} />
          </div>
          <p>
            {weaponDef.name} strikes for <strong>{prompt.damage}</strong> wound
            {prompt.damage > 1 ? 's' : ''}
            {prompt.damage !== weaponDef.damage && <> ({weaponDef.damage} + bonuses)</>}. Parry, or take the hit?
          </p>
          <div className="modal-cards">
            {options.map((c) => (
              <div
                key={c.id}
                className="modal-choice modal-choice-play"
                onClick={() => session.sendIntent({ t: 'respondParry', card: c.id })}
              >
                <CardFace card={c} />
                <span>Play {CARD_DEFS[c.kind].name}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-danger" onClick={() => session.sendIntent({ t: 'respondParry', card: null })}>
            Take {prompt.damage} wound{prompt.damage > 1 ? 's' : ''}
          </button>
        </Modal>
      )
    }
    case 'forced': {
      const source = view.players[prompt.sourceSeat]
      const isCry = prompt.kind === 'battlecry'
      const options = hand.filter((c) =>
        isCry ? c.kind === 'parry' || (hanzoOk && isWeapon(c)) : isWeapon(c),
      )
      return (
        <Modal title={`${source.name} plays ${isCry ? 'Battle Cry' : 'Jiu-jitsu'}!`}>
          <p>Discard a {isCry ? 'Parry' : 'Weapon'} or suffer 1 wound.</p>
          <div className="modal-cards">
            {options.map((c) => (
              <div
                key={c.id}
                className="modal-choice modal-choice-play"
                onClick={() => session.sendIntent({ t: 'respondForced', card: c.id })}
              >
                <CardFace card={c} />
                <span>Discard {CARD_DEFS[c.kind].name}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-danger" onClick={() => session.sendIntent({ t: 'respondForced', card: null })}>
            Suffer 1 wound
          </button>
        </Modal>
      )
    }
    case 'bushido': {
      const weapons = hand.filter(isWeapon)
      const shogun3p = view.playerCount === 3 && view.you.role === 'shogun'
      return (
        <Modal title="Bushido demands its due">
          <p>The flipped card was a Weapon:</p>
          <div className="modal-cards"><CardFace card={prompt.flipped} /></div>
          <p>Discard a Weapon to pass Bushido on — or {shogun3p ? 'discard Bushido (the Shogun loses no Honor)' : 'lose 1 Honor'}.</p>
          <div className="modal-cards">
            {weapons.map((c) => (
              <div
                key={c.id}
                className="modal-choice modal-choice-play"
                onClick={() => session.sendIntent({ t: 'respondBushido', discardWeapon: c.id })}
              >
                <CardFace card={c} />
                <span>Discard {CARD_DEFS[c.kind].name}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-danger" onClick={() => session.sendIntent({ t: 'respondBushido', loseHonor: true })}>
            {shogun3p ? 'Discard Bushido' : 'Lose 1 Honor'}
          </button>
        </Modal>
      )
    }
    case 'ieyasu':
      return (
        <Modal title="Ieyasu's cunning">
          <p>Take the top card of the discard pile as your first draw?</p>
          <div className="modal-cards">
            {view.discardTop && (
              <CardFace card={view.discardTop} onClick={() => session.sendIntent({ t: 'respondIeyasu', fromDiscard: true })} />
            )}
            <div className="modal-choice" onClick={() => session.sendIntent({ t: 'respondIeyasu', fromDiscard: false })}>
              <CardBack />
              <span>Draw from the deck</span>
            </div>
          </div>
        </Modal>
      )
    case 'discard':
      return <DiscardPrompt view={view} count={prompt.count} session={session} />
  }
}

function DiscardPrompt(props: { view: PlayerView; count: number; session: Session }) {
  const [picked, setPicked] = useState<number[]>([])
  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < props.count ? [...p, id] : p))
  return (
    <Modal title={`Discard ${props.count} card${props.count > 1 ? 's' : ''}`}>
      <p>Your hand may hold at most 7 cards at the end of your turn.</p>
      <div className="modal-cards">
        {props.view.you.hand.map((c) => (
          <CardFace key={c.id} card={c} selected={picked.includes(c.id)} onClick={() => toggle(c.id)} />
        ))}
      </div>
      <button
        className="btn btn-primary"
        disabled={picked.length !== props.count}
        onClick={() => props.session.sendIntent({ t: 'respondDiscard', cards: picked })}
      >
        Discard {picked.length}/{props.count}
      </button>
    </Modal>
  )
}

function Modal(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  )
}

// ---------------- log ----------------

function LogPanel(props: { view: PlayerView }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(true)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [props.view.log.length])
  return (
    <div className={`log ${open ? '' : 'log-closed'}`}>
      <button className="log-toggle" onClick={() => setOpen(!open)}>
        {open ? '▾ chronicle' : '▸ chronicle'}
      </button>
      {open && (
        <div className="log-entries" ref={ref}>
          {props.view.log.map((e) => {
            const isTurn = e.text.startsWith('—')
            return (
              <div key={e.n} className={`log-entry ${isTurn ? 'log-entry-turn' : ''}`}>
                {isTurn ? e.text.replace(/^—\s*/, '').replace(/\s*—$/, '') : e.text}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------- result ----------------

function ResultOverlay(props: { view: PlayerView; session: Session; onLeave: () => void }) {
  const { view, session } = props
  const result = view.result!
  const teams = [...result.teams].sort((a, b) => b.total - a.total)
  return (
    <div className="modal-backdrop result-backdrop">
      <div className="modal result">
        <h1 className="result-title">
          {result.type === 'swordmaster' ? 'Victory of the Sword Master!' : 'The duel is decided'}
        </h1>
        <h2 className={`result-winner result-${result.winnerTeam}`}>
          {TEAM_LABEL[result.winnerTeam]} win{result.winnerTeam === 'ronin' ? 's' : ''}
          {result.type === 'swordmaster' && result.swordmasterSeat != null && (
            <> — {view.players[result.swordmasterSeat].name} stood alone</>
          )}
        </h2>
        <div className="result-teams">
          {teams.map((t) => (
            <div key={t.team} className={`result-team ${t.team === result.winnerTeam ? 'result-team-winner' : ''}`}>
              <h3>
                {TEAM_LABEL[t.team]} — {t.total} pt{t.total !== 1 ? 's' : ''}
                {t.penalty > 0 && <em> (−{t.penalty} mortal blow)</em>}
              </h3>
              <ul>
                {t.members.map((m) => (
                  <li key={m.seat}>
                    <strong>{view.players[m.seat].name}</strong> — {ROLE_INFO[m.role].kanji}{' '}
                    {ROLE_INFO[m.role].name}: {m.honor} honor ×{m.multiplier}
                    {m.daimyo > 0 && <> +{m.daimyo} daimyo</>} = {m.score}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="result-actions">
          {session.playAgain && (
            <button className="btn btn-primary" onClick={() => session.playAgain!()}>Play again</button>
          )}
          <button className="btn btn-ghost" onClick={props.onLeave}>Leave</button>
        </div>
      </div>
    </div>
  )
}
