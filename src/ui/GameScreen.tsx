import { useEffect, useMemo, useRef, useState } from 'react'
import { CARD_DEFS, CHARACTERS } from '../engine/cards'
import type { Card, Pending, PlayerView, PublicPlayer } from '../engine/types'
import type { Session } from '../net/session'
import { CardBack, CardFace, CharacterPlate, Tokens } from './Cards'
import {
  baseHonor,
  cardAction,
  CHARACTER_KANJI,
  flightFromLog,
  HIDDEN_ROLE_TEXT,
  ROLE_GOAL,
  ROLE_INFO,
  showcaseFromLog,
  TEAM_LABEL,
  viewAttackDifficulty,
  weaponStatLines,
  type ShowcaseEvent,
  type TargetMode,
} from './helpers'

interface Floater {
  key: number
  seat: number
  kind: 'honor' | 'resilience'
  delta: number
}

/** One card-back in flight — endpoints are px offsets from the table centre. */
interface Flight {
  key: number
  fx: number
  fy: number
  tx: number
  ty: number
  delay: number
}
import { sound } from './sound'

export function GameScreen(props: { view: PlayerView; session: Session; onLeave: () => void }) {
  const { view, session } = props
  const [targetMode, setTargetMode] = useState<TargetMode | null>(null)
  const [geishaSeat, setGeishaSeat] = useState<number | null>(null)
  const [inspect, setInspect] = useState<Card | null>(null)
  const [infoSeat, setInfoSeat] = useState<number | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [floaters, setFloaters] = useState<Floater[]>([])
  const floaterKey = useRef(0)
  // floater-clear timers, cancelled on unmount so none fire after leave/death
  const floaterTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => floaterTimers.current.forEach(clearTimeout), [])
  const [turnFlash, setTurnFlash] = useState(0)
  // fresh games have a near-empty log; a mid-game rejoin must not replay the ceremony
  const [ceremony, setCeremony] = useState(() => view.log.length < 8)
  const touch = useTouchDevice()
  const reduced = useReducedMotion()
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
    if (view.phase === 'play' && view.turnSeat === view.seat && prev.turnSeat !== view.seat) {
      sound.yourTurn()
      setTurnFlash((n) => n + 1)
    }
    if (view.result && !prev.result) sound.victory()
    if (prev.result && !view.result) setCeremony(true) // "Play again" dealt new roles

    // floating ±N over every seat whose honor/resilience changed
    const drops: Floater[] = []
    for (const p of view.players) {
      const before = prev.players[p.seat]
      if (!before) continue
      if (p.honor !== before.honor)
        drops.push({ key: ++floaterKey.current, seat: p.seat, kind: 'honor', delta: p.honor - before.honor })
      if (p.resilience !== before.resilience)
        drops.push({ key: ++floaterKey.current, seat: p.seat, kind: 'resilience', delta: p.resilience - before.resilience })
    }
    if (drops.length) {
      setFloaters((f) => [...f, ...drops])
      const t = setTimeout(() => setFloaters((f) => f.filter((x) => !drops.includes(x))), 1500)
      floaterTimers.current.push(t)
    }
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

  // the active warrior is spotlit and lifted; everyone else dims (but not while
  // you are aiming a card — then the out-of-reach fade does the talking)
  const activeSeat = view.phase === 'play' ? view.turnSeat : null
  const aiming = targetMode !== null

  return (
    <div className="game">
      <Embers />
      <div className={`table-scene ${impact ? 'shake' : ''}`}>
        <div className={`table ${activeSeat !== null && !aiming ? 'table-focus' : ''}`}>
          <div className="table-inner" />
          {activeSeat !== null && (
            <div
              className="table-spotlight"
              aria-hidden="true"
              style={{
                ['--spot-x' as string]: `${positions[activeSeat].left}%`,
                ['--spot-y' as string]: `${positions[activeSeat].top}%`,
              }}
            />
          )}
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

          <PlayShowcase view={view} positions={positions} />
          <CardFlights view={view} positions={positions} reduced={reduced} />

          {floaters.map((f) => (
            <div
              key={f.key}
              className={`floater floater-${f.kind} ${f.delta > 0 ? 'floater-plus' : 'floater-minus'}`}
              style={{
                left: `${positions[f.seat].left}%`,
                top: `${positions[f.seat].top}%`,
                marginLeft: f.kind === 'resilience' ? '-30px' : '30px',
              }}
            >
              {f.delta > 0 ? `+${f.delta}` : f.delta}
              {f.kind === 'honor' ? '◆' : '●'}
            </div>
          ))}
        </div>
      </div>

      {turnFlash > 0 && (
        <div key={turnFlash} className="turn-banner" aria-hidden="true">
          Your turn<span className="turn-banner-kanji">出番</span>
        </div>
      )}

      {ceremony && view.phase !== 'ended' && (
        <RoleCeremony view={view} onDone={() => setCeremony(false)} />
      )}

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
              <button className="ink-seal ink-seal-blood ink-seal-live" onClick={props.onLeave}>
                <span className="ink-seal-kanji" aria-hidden="true">退</span>
                <span className="ink-seal-text">Leave</span>
              </button>
              <button className="ink-seal ink-seal-ink ink-seal-live" onClick={() => setConfirmLeave(false)}>
                <span className="ink-seal-kanji" aria-hidden="true">留</span>
                <span className="ink-seal-text">Stay</span>
              </button>
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

/** True when the viewer asked for reduced motion; SSR-safe (no matchMedia → false). */
function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
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

/** Sequential center-table showcase of played cards — everyone sees what
 * was played and by whom, flying in from the actor's seat. */
function PlayShowcase(props: { view: PlayerView; positions: { left: number; top: number }[] }) {
  const { view } = props
  const [queue, setQueue] = useState<{ key: number; ev: ShowcaseEvent }[]>([])
  const seenLen = useRef(view.log.length)
  useEffect(() => {
    if (view.log.length < seenLen.current) {
      seenLen.current = view.log.length // log reset (Play again)
      return
    }
    const fresh: { key: number; ev: ShowcaseEvent }[] = []
    for (let i = seenLen.current; i < view.log.length; i++) {
      const ev = showcaseFromLog(view.log[i].text, view.players)
      if (ev) fresh.push({ key: view.log[i].n, ev })
    }
    seenLen.current = view.log.length
    if (fresh.length) setQueue((q) => [...q, ...fresh].slice(-4))
  }, [view.log, view.players])
  const current = queue[0]
  const anchorRef = useRef<HTMLDivElement>(null)
  // px offset from table center to the actor's seat — lets the flight animate
  // transform only (compositor-friendly; animating left/top caused jank)
  const [delta, setDelta] = useState<{ key: number; dx: number; dy: number } | null>(null)
  useEffect(() => {
    if (!current) return
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 1900)
    const table = anchorRef.current?.parentElement
    const pos = props.positions[current.ev.actorSeat]
    if (table && pos) {
      setDelta({
        key: current.key,
        dx: ((pos.left - 50) / 100) * table.clientWidth,
        dy: ((pos.top - 44) / 100) * table.clientHeight,
      })
    } else {
      setDelta({ key: current.key, dx: 0, dy: -120 })
    }
    return () => clearTimeout(t)
  }, [current, props.positions])
  const actor = current ? view.players[current.ev.actorSeat] : null
  return (
    <div className="showcase-anchor" ref={anchorRef} aria-hidden="true">
      {current && actor && delta?.key === current.key && (
        <div
          key={current.key}
          className={`showcase ${current.ev.isAttack ? 'showcase-attack' : ''}`}
          style={{
            ['--dx' as string]: `${delta.dx}px`,
            ['--dy' as string]: `${delta.dy}px`,
          }}
        >
          <div className="showcase-ribbon">
            <strong>{actor.name}</strong>
            {current.ev.isAttack ? ' attacks!' : ' plays'}
          </div>
          <div className="showcase-cardwrap">
            <CardFace card={{ id: -current.key, kind: current.ev.kind }} />
          </div>
        </div>
      )}
    </div>
  )
}

/** Card-backs that physically travel the table: the opening deal, every draw
 * from the deck, and Diversion/Geisha steals. All transform/opacity only, all
 * measured in px from table centre so the flight animates the compositor and
 * never touches layout. Silent under reduced motion (nothing spawns). */
function CardFlights(props: {
  view: PlayerView
  positions: { left: number; top: number }[]
  reduced: boolean
}) {
  const { view, positions, reduced } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const [flights, setFlights] = useState<Flight[]>([])
  const keyRef = useRef(0)
  const seenLen = useRef(view.log.length)
  const firstRun = useRef(true)

  useEffect(() => {
    if (reduced) return
    const table = rootRef.current?.parentElement
    const w = table?.clientWidth ?? 0
    const h = table?.clientHeight ?? 0
    // px offset from table centre to a seat (matches PlayShowcase's math)
    const seatOff = (seat: number) => ({
      dx: ((positions[seat].left - 50) / 100) * w,
      dy: ((positions[seat].top - 46) / 100) * h,
    })
    const anchor = (a: number | 'deck' | 'discard') =>
      typeof a === 'number' ? seatOff(a) : { dx: 0, dy: 0 }

    const spawn = (list: Flight[]) => {
      if (!list.length) return
      setFlights((f) => [...f, ...list].slice(-32))
      const ttl = Math.max(...list.map((x) => x.delay)) + 900
      setTimeout(() => setFlights((f) => f.filter((x) => !list.includes(x))), ttl)
    }

    // opening deal: two rounds around the ring, deck → every seat
    const dealWave = () => {
      const list: Flight[] = []
      let step = 0
      for (let round = 0; round < 2; round++) {
        for (const p of view.players) {
          const to = seatOff(p.seat)
          list.push({ key: ++keyRef.current, fx: 0, fy: 0, tx: to.dx, ty: to.dy, delay: step++ * 80 })
        }
      }
      spawn(list)
    }

    if (!w || !h) {
      seenLen.current = view.log.length
      firstRun.current = false
      return
    }

    // first mount: deal a fresh game, but never replay it on a mid-game rejoin
    if (firstRun.current) {
      firstRun.current = false
      seenLen.current = view.log.length
      if (view.log.length < 8) dealWave()
      return
    }
    // "Play again" resets the chronicle → deal the new hand
    if (view.log.length < seenLen.current) {
      seenLen.current = view.log.length
      dealWave()
      return
    }
    // new chronicle lines → draws and steals fly card-backs across the table
    const list: Flight[] = []
    for (let i = seenLen.current; i < view.log.length; i++) {
      const ev = flightFromLog(view.log[i].text, view.players)
      if (!ev) continue
      const from = anchor(ev.from)
      const to = anchor(ev.to)
      for (let c = 0; c < ev.count; c++) {
        list.push({ key: ++keyRef.current, fx: from.dx, fy: from.dy, tx: to.dx, ty: to.dy, delay: c * 95 })
      }
    }
    seenLen.current = view.log.length
    spawn(list)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.log])

  return (
    <div className="flight-layer" ref={rootRef} aria-hidden="true">
      {flights.map((f) => (
        <div
          key={f.key}
          className="flight"
          style={{
            ['--fx' as string]: `${f.fx}px`,
            ['--fy' as string]: `${f.fy}px`,
            ['--tx' as string]: `${f.tx}px`,
            ['--ty' as string]: `${f.ty}px`,
            animationDelay: `${f.delay}ms`,
          }}
        >
          <CardBack size="mini" />
        </div>
      ))}
    </div>
  )
}

/** Game-start reveal: your role, its goal, and your character's ability. */
function RoleCeremony(props: { view: PlayerView; onDone: () => void }) {
  const { view } = props
  const role = ROLE_INFO[view.you.role]
  const me = view.players[view.seat]
  const char = CHARACTERS[me.character]
  const { onDone } = props
  // stays open until the player closes it — reading your role is not on a timer
  return (
    <div className={`ceremony ceremony-${role.team}`} onClick={onDone}>
      <div className="ceremony-inner">
        <div className="ceremony-kanji">{role.kanji}</div>
        <h1>{role.name}</h1>
        <div className="ceremony-team">team · {TEAM_LABEL[role.team]}</div>
        <p className="ceremony-goal">{ROLE_GOAL[view.you.role]}</p>
        {view.playerCount === 3 && (
          <p className="ceremony-note">
            3-player duel: with one public Shogun and two Ninja there is nothing to hide — all
            roles are shown openly. Roles are secret from 4 players up.
          </p>
        )}
        <div className="ceremony-char">
          <h2>
            <span className="char-kanji">{CHARACTER_KANJI[me.character]}</span> {char.name}
          </h2>
          <p>{char.text}</p>
        </div>
        <button className="ink-seal ink-seal-vermilion ink-seal-live">
          <span className="ink-seal-kanji" aria-hidden="true">始</span>
          <span className="ink-seal-text">The duel begins</span>
        </button>
      </div>
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
              <button className="ink-seal ink-seal-vermilion ink-seal-live" onClick={props.onPlay}>
                <span className="ink-seal-kanji" aria-hidden="true">出</span>
                <span className="ink-seal-text">Play</span>
              </button>
            )}
            {blockedReason && <span className="inspect-blocked">{blockedReason}</span>}
            <button className="ink-seal ink-seal-ink ink-seal-live" onClick={props.onClose}>
              <span className="ink-seal-kanji" aria-hidden="true">閉</span>
              <span className="ink-seal-text">Close</span>
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

        <button className="ink-seal ink-seal-ink ink-seal-live" onClick={props.onClose}>
          <span className="ink-seal-kanji" aria-hidden="true">閉</span>
          <span className="ink-seal-text">Close</span>
        </button>
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
          className="ink-seal ink-seal-ink ink-seal-live ink-seal-sm"
          onClick={() => session.sendIntent({ t: 'nobunaga' })}
          title="Nobunaga: discard 1 Resilience (not the last) to draw 1 card"
        >
          <span className="ink-seal-kanji" aria-hidden="true">信</span>
          <span className="ink-seal-text">sacrifice 1 ♥ → draw</span>
        </button>
      )}
      <button
        className="ink-seal ink-seal-vermilion ink-seal-live"
        onClick={() => session.sendIntent({ t: 'endTurn' })}
      >
        <span className="ink-seal-kanji" aria-hidden="true">終</span>
        <span className="ink-seal-text">End turn</span>
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
        <button className="ink-seal ink-seal-ink ink-seal-live" onClick={props.onCancel}>
          <span className="ink-seal-kanji" aria-hidden="true">止</span>
          <span className="ink-seal-text">Cancel</span>
        </button>
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
          <button
            className="ink-seal ink-seal-blood ink-seal-live"
            onClick={() => session.sendIntent({ t: 'respondParry', card: null })}
          >
            <span className="ink-seal-kanji" aria-hidden="true">受</span>
            <span className="ink-seal-text">Take {prompt.damage} wound{prompt.damage > 1 ? 's' : ''}</span>
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
          <button
            className="ink-seal ink-seal-blood ink-seal-live"
            onClick={() => session.sendIntent({ t: 'respondForced', card: null })}
          >
            <span className="ink-seal-kanji" aria-hidden="true">受</span>
            <span className="ink-seal-text">Suffer 1 wound</span>
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
          <button
            className="ink-seal ink-seal-blood ink-seal-live"
            onClick={() => session.sendIntent({ t: 'respondBushido', loseHonor: true })}
          >
            <span className="ink-seal-kanji" aria-hidden="true">受</span>
            <span className="ink-seal-text">{shogun3p ? 'Discard Bushido' : 'Lose 1 Honor'}</span>
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
        className="ink-seal ink-seal-vermilion ink-seal-live"
        disabled={picked.length !== props.count}
        onClick={() => props.session.sendIntent({ t: 'respondDiscard', cards: picked })}
      >
        <span className="ink-seal-kanji" aria-hidden="true">捨</span>
        <span className="ink-seal-text">Discard {picked.length}/{props.count}</span>
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
        <span className="log-seal" aria-hidden="true">記</span>
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

/** Brushed sumi-e underline that self-draws (stroke-dashoffset) — reused per row. */
function InkRule(props: { className: string; delay?: number; strokeWidth?: number }) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 300 10"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={props.delay != null ? ({ '--wd': `${props.delay}ms` } as React.CSSProperties) : undefined}
    >
      <path
        pathLength="1"
        d="M4 6 Q90 2 160 5 Q230 8 296 4"
        fill="none"
        strokeWidth={props.strokeWidth ?? 2.5}
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Endgame, staged as a sumi-e finale in the order the heart reads it:
 * 1) the verdict — the giant kanji (勝利 / 敗北) brush-painted in behind the
 *    word, an ink disc blooming as a rising sun, a sword-slash cut beneath;
 * 2) the record — a scroll that unrolls from its top rod, each clan settling
 *    in turn, every warrior written onto the paper by a self-drawing stroke,
 *    the victors crowned with a stamped hanko, friendly fire struck through
 *    as a crimson ledger line;
 * 3) the way onward — Play again / Leave pressed as vermilion & ink hanko.
 * All motion is transform / opacity / clip-path / SVG-stroke — phone-safe,
 * and every entrance fills `backwards`/`both` so reduced-motion lands on the
 * finished painting instantly. The #ink-brush filter it uses is mounted once
 * at the GameScreen root (InkScene isn't on this screen).
 */
function ResultOverlay(props: { view: PlayerView; session: Session; onLeave: () => void }) {
  const { view, session } = props
  const result = view.result!
  const victory = result.winnerTeam === view.you.team
  const winnerName = TEAM_LABEL[result.winnerTeam]
  const swordmaster =
    result.type === 'swordmaster' && result.swordmasterSeat != null
      ? view.players[result.swordmasterSeat]
      : null
  // winner clan leads the scroll; the rest rank by score
  const teams = [...result.teams].sort(
    (a, b) =>
      Number(b.team === result.winnerTeam) - Number(a.team === result.winnerTeam) ||
      b.total - a.total,
  )
  // a single running counter so warrior strokes draw one after another down the
  // whole scroll, regardless of which clan they sit in
  let stroke = 0
  return (
    <div className={`modal-backdrop result-backdrop ${victory ? 'result-victory' : 'result-defeat'}`}>
      <div className="result-stage">
        <div className="result-verdict">
          {/* the rising sun / cold moon blooming behind the verdict */}
          <div className="result-verdict-bloom" aria-hidden="true" />
          {/* the giant kanji, brush-painted left-to-right behind the word */}
          <div className="result-verdict-kanji" aria-hidden="true">
            {victory ? '勝利' : '敗北'}
          </div>
          <div className="result-kicker">
            {result.type === 'swordmaster' ? 'Sword Master · 剣聖' : 'The duel is decided'}
          </div>
          <h1 className="result-word">{victory ? 'Victory' : 'Defeat'}</h1>
          {/* the sword-slash cut beneath the word — echoes the home title slash */}
          <svg className="result-slash" viewBox="0 0 420 30" preserveAspectRatio="none" aria-hidden="true">
            <path
              className="result-slash-stroke" pathLength="1"
              d="M8 20 Q130 8 250 15 Q340 20 412 10"
              fill="none" strokeWidth="8" strokeLinecap="round"
            />
            <path
              className="result-slash-stroke result-slash-echo" pathLength="1"
              d="M16 26 Q150 18 292 21 Q360 23 408 18"
              fill="none" strokeWidth="3" strokeLinecap="round"
            />
          </svg>
          <h2 className="result-winnerline">
            {swordmaster ? (
              <>
                {swordmaster.name} stood alone — the {winnerName} clan prevails
              </>
            ) : (
              <>
                {winnerName} {result.winnerTeam === 'ronin' ? 'takes' : 'take'} the field
              </>
            )}
          </h2>
        </div>

        {teams.length > 0 && (
          <div className="result-scroll">
            {/* the paper itself unrolls from the top rod; content settles on top */}
            <div className="result-scroll-paper" aria-hidden="true" />
            <div className="result-clans">
              {teams.map((t, i) => {
                const winner = t.team === result.winnerTeam
                return (
                  <section
                    key={t.team}
                    className={`result-clan ${winner ? 'result-clan-winner' : ''}`}
                    style={{ '--i': i } as React.CSSProperties}
                  >
                    {/* the victors' hanko, stamped into the clan card's corner */}
                    {winner && (
                      <span className="result-clan-seal" aria-hidden="true">勝</span>
                    )}
                    <header className="result-clan-head">
                      <h3 className="result-clan-name">
                        {TEAM_LABEL[t.team]}
                        {winner && <span className="result-clan-crown">victors</span>}
                      </h3>
                      <div className="result-clan-total">
                        {t.total}
                        <span className="result-clan-pts">pt{t.total !== 1 ? 's' : ''}</span>
                      </div>
                    </header>
                    {t.penalty > 0 && (
                      <div className="result-penalty">
                        <span className="result-penalty-mark" aria-hidden="true">血</span>
                        −{t.penalty} mortal blow — the clan pays for felling its own
                      </div>
                    )}
                    <ul className="result-warriors">
                      {t.members.map((m) => {
                        const p = view.players[m.seat]
                        const delay = 600 + stroke++ * 120
                        return (
                          <li key={m.seat} className="result-warrior">
                            <div className="result-warrior-id">
                              <span className="result-warrior-name">{p.name}</span>
                              {m.seat === view.seat && <span className="result-you-tag">you</span>}
                              <span className={`seat-role-badge role-badge-${ROLE_INFO[m.role].team}`}>
                                {ROLE_INFO[m.role].kanji} {ROLE_INFO[m.role].name}
                              </span>
                              <span className="result-warrior-char">
                                <span className="char-kanji">{CHARACTER_KANJI[p.character]}</span>{' '}
                                {CHARACTERS[p.character].name}
                              </span>
                            </div>
                            <div className="result-warrior-math">
                              <span>
                                {m.honor} honor
                                {m.multiplier > 1 && <em className="result-mult"> ×{m.multiplier}</em>}
                                {m.daimyo > 0 && <em className="result-daimyo"> +{m.daimyo} daimyo</em>}
                              </span>
                              <span className="result-warrior-score">{m.score}</span>
                            </div>
                            {/* the stroke that writes this warrior onto the record */}
                            <InkRule className="result-warrior-brush" delay={delay} />
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
          </div>
        )}

        <div className="result-actions result-cta">
          {session.playAgain && (
            <button
              className="ink-seal ink-seal-vermilion result-seal"
              onClick={() => session.playAgain!()}
            >
              <span className="ink-seal-kanji" aria-hidden="true">再</span>
              <span className="ink-seal-text">Play again</span>
            </button>
          )}
          <button className="ink-seal ink-seal-ink result-seal" onClick={props.onLeave}>
            <span className="ink-seal-kanji" aria-hidden="true">退</span>
            <span className="ink-seal-text">Leave</span>
          </button>
        </div>
      </div>
    </div>
  )
}
