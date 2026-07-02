import { useEffect, useMemo, useRef, useState } from 'react'
import { CARD_DEFS, CHARACTERS } from '../engine/cards'
import type { Card, Pending, PlayerView, PublicPlayer } from '../engine/types'
import type { Session } from '../net/session'
import { CardBack, CardFace, CharacterPlate, Tokens } from './Cards'
import { cardAction, ROLE_INFO, TEAM_LABEL, viewAttackDifficulty, type TargetMode } from './helpers'

export function GameScreen(props: { view: PlayerView; session: Session; onLeave: () => void }) {
  const { view, session } = props
  const [targetMode, setTargetMode] = useState<TargetMode | null>(null)
  const [geishaSeat, setGeishaSeat] = useState<number | null>(null)
  const [showRole, setShowRole] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)

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
    if (!myTurn) return
    if (targetMode?.card.id === card.id) {
      setTargetMode(null)
      return
    }
    const action = cardAction(view, card)
    if ('blocked' in action) setBlocked(action.blocked)
    else if ('play' in action) session.sendIntent({ t: 'playAction', card: card.id })
    else setTargetMode(action.target)
    setGeishaSeat(null)
  }

  function clickSeat(seat: number) {
    if (!targetMode || !targetMode.targets.includes(seat)) return
    const card = targetMode.card.id
    switch (targetMode.kind) {
      case 'weapon':
        session.sendIntent({ t: 'playWeapon', card, target: seat })
        break
      case 'diversion':
      case 'breathing':
        session.sendIntent({ t: 'playAction', card, target: seat })
        break
      case 'bushido':
        session.sendIntent({ t: 'playProperty', card, target: seat })
        break
      case 'geisha':
        setGeishaSeat(seat)
        return // submenu takes it from here
    }
    setTargetMode(null)
  }

  const seatCount = view.playerCount
  const positions = useMemo(() => {
    return view.players.map((p) => {
      const rel = (p.seat - view.seat + seatCount) % seatCount
      const angle = Math.PI / 2 + (rel * 2 * Math.PI) / seatCount
      return {
        left: 50 + 41 * Math.cos(angle),
        top: 50 + 38 * Math.sin(angle),
      }
    })
  }, [view.seat, seatCount, view.players])

  const playedProperty = (card: Card) => {
    if (!myTurn) return
    session.sendIntent({ t: 'playProperty', card: card.id })
  }

  return (
    <div className="game">
      <div className="table-scene">
        <div className="table">
          <div className="table-center">
            <div className="pile">
              <CardBack size="mini" />
              <span className="pile-count">{view.deckCount}</span>
            </div>
            <div className="pile">
              {view.discardTop ? <CardFace card={view.discardTop} size="mini" /> : <div className="pile-empty" />}
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
              waiting={view.waitingFor === p.seat}
              difficulty={
                targetMode?.kind === 'weapon' && p.seat !== view.seat && !p.harmless
                  ? viewAttackDifficulty(view, view.seat, p.seat)
                  : null
              }
              onClick={() => clickSeat(p.seat)}
            />
          ))}
        </div>
      </div>

      <StatusBar view={view} myTurn={myTurn} showRole={showRole} setShowRole={setShowRole} />

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

// ---------------- seat ----------------

function Seat(props: {
  player: PublicPlayer
  view: PlayerView
  style: React.CSSProperties
  isYou: boolean
  isTurn: boolean
  targetable: boolean
  waiting: boolean
  difficulty: number | null
  onClick: () => void
}) {
  const { player: p } = props
  const cls = [
    'seat',
    props.isYou ? 'seat-you' : '',
    props.isTurn ? 'seat-turn' : '',
    props.targetable ? 'seat-targetable' : '',
    p.harmless ? 'seat-harmless' : '',
  ].join(' ')
  return (
    <div className={cls} style={props.style} onClick={props.onClick}>
      {props.difficulty !== null && <div className="seat-difficulty">{props.difficulty}</div>}
      <div className="seat-name">
        {p.name}
        {p.role === 'shogun' && <span className="seat-role-tag">将軍</span>}
      </div>
      <CharacterPlate character={p.character} />
      <div className="seat-tokens">
        <Tokens kind="resilience" value={p.resilience} max={p.maxResilience} />
        <Tokens kind="honor" value={p.honor} />
      </div>
      {!props.isYou && (
        <div className="seat-handcount" title={`${p.handCount} cards in hand`}>
          <CardBack size="mini" /> ×{p.handCount}
        </div>
      )}
      {p.properties.length > 0 && (
        <div className="seat-properties">
          {p.properties.map((c) => <CardFace key={c.id} card={c} size="mini" />)}
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
  showRole: boolean
  setShowRole: (b: boolean) => void
}) {
  const { view } = props
  const role = ROLE_INFO[view.you.role]
  return (
    <div className="statusbar">
      <button
        className={`role-badge role-${role.team}`}
        onClick={() => props.setShowRole(!props.showRole)}
        title="Your secret role — click to peek"
      >
        {props.showRole ? `${role.kanji} ${role.name}` : '?? secret role'}
      </button>
      {props.showRole && <span className="role-team">team: {TEAM_LABEL[role.team]}</span>}
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
  return (
    <div className="hand">
      {view.you.hand.map((card, i) => (
        <div
          key={card.id}
          className="hand-slot"
          style={{
            ['--fan' as string]: `${(i - (n - 1) / 2) * Math.min(8, 40 / Math.max(n, 1))}deg`,
            ['--lift' as string]: `${Math.abs(i - (n - 1) / 2) * 7}px`,
          }}
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
      const options = hand.filter((c) => c.kind === 'parry' || (hanzoOk && isWeapon(c)))
      return (
        <Modal title={`${attacker.name} attacks you!`}>
          <div className="modal-cards">
            <CardFace card={prompt.weaponCard} />
          </div>
          <p>
            {CARD_DEFS[prompt.weaponCard.kind].name} strikes for <strong>{prompt.damage}</strong> wound
            {prompt.damage > 1 ? 's' : ''}. Parry, or take the hit?
          </p>
          <div className="modal-cards">
            {options.map((c) => (
              <CardFace key={c.id} card={c} onClick={() => session.sendIntent({ t: 'respondParry', card: c.id })} />
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
              <CardFace key={c.id} card={c} onClick={() => session.sendIntent({ t: 'respondForced', card: c.id })} />
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
              <CardFace key={c.id} card={c} onClick={() => session.sendIntent({ t: 'respondBushido', discardWeapon: c.id })} />
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
        {open ? '▸ chronicle' : '◂ chronicle'}
      </button>
      {open && (
        <div className="log-entries" ref={ref}>
          {props.view.log.map((e) => (
            <div key={e.n} className="log-entry">{e.text}</div>
          ))}
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
