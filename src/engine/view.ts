import { CHARACTERS, ROLES } from './cards'
import { isHarmless, weaponsAllowed } from './game'
import type { GameState, PlayerView, PublicPlayer } from './types'

/** Build the redacted view for one seat. Never leaks other hands or secret roles. */
export function viewFor(state: GameState, seat: number): PlayerView {
  const me = state.players[seat]
  const ended = state.phase === 'ended'
  const threePlayer = state.playerCount === 3

  const players: PublicPlayer[] = state.players.map((p) => ({
    seat: p.seat,
    name: p.name,
    character: p.character,
    maxResilience: CHARACTERS[p.character].resilience,
    resilience: p.resilience,
    honor: p.honor,
    handCount: p.hand.length,
    properties: p.properties,
    harmless: isHarmless(p),
    role:
      p.role === 'shogun' || ended || threePlayer || p.seat === seat
        ? p.role
        : null,
  }))

  const pending = state.pending
  const respondent = pending
    ? pending.type === 'forced' ? pending.queue[0] : pending.seat
    : null

  return {
    seat,
    playerCount: state.playerCount,
    you: { hand: me.hand, role: me.role, team: ROLES[me.role].team },
    players,
    deckCount: state.deck.length,
    discardTop: state.discard.length > 0 ? state.discard[state.discard.length - 1] : null,
    discardCount: state.discard.length,
    turnSeat: state.turnSeat,
    phase: state.phase,
    weaponsPlayed: state.weaponsPlayed,
    weaponsAllowed: weaponsAllowed(state, state.turnSeat),
    prompt: respondent === seat ? pending : null,
    waitingFor: respondent !== null && respondent !== seat ? respondent : null,
    log: state.log,
    result: state.result,
    honorCap: state.honorCap ?? null, // pre-pace host saves lack the field
  }
}
