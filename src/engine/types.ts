// ---------- Cards ----------

export type CardType = 'weapon' | 'action' | 'property'

export type WeaponKind =
  | 'bokken' | 'kiseru' | 'bo' | 'shuriken' | 'kusarigama' | 'nagayari' | 'kanabo'
  | 'naginata' | 'daikyu' | 'tanegashima' | 'wakizashi' | 'katana' | 'nodachi'

export type ActionKind =
  | 'parry' | 'geisha' | 'diversion' | 'jiujitsu' | 'battlecry'
  | 'teaceremony' | 'daimyo' | 'breathing'

export type PropertyKind = 'focus' | 'armor' | 'quickdraw' | 'bushido'

export type CardKind = WeaponKind | ActionKind | PropertyKind

export interface CardDef {
  kind: CardKind
  type: CardType
  name: string
  kanji: string
  count: number
  /** weapons only: max difficulty reachable */
  difficulty?: number
  /** weapons only: wounds inflicted */
  damage?: number
  text: string
}

/** A physical card instance in the deck (id unique across the 90 cards). */
export interface Card {
  id: number
  kind: CardKind
}

// ---------- Roles & characters ----------

export type Team = 'shogun' | 'ninja' | 'ronin'

export type RoleId =
  | 'shogun' | 'samurai1' | 'samurai2'
  | 'ninja1' | 'ninja2' | 'ninja3' | 'ronin'

export interface RoleDef {
  id: RoleId
  team: Team
  name: string
  /** ninja star count (1..3); used for the 4-player scoring rule */
  stars?: number
}

export type CharacterId =
  | 'benkei' | 'chiyome' | 'ginchiyo' | 'goemon' | 'hanzo' | 'hideyoshi'
  | 'ieyasu' | 'kojiro' | 'musashi' | 'nobunaga' | 'tomoe' | 'ushiwaka'

export interface CharacterDef {
  id: CharacterId
  name: string
  resilience: number
  text: string
}

// ---------- Game state ----------

export interface PlayerState {
  seat: number
  name: string
  role: RoleId
  character: CharacterId
  resilience: number
  honor: number
  hand: Card[]
  /** properties in play in front of this player (includes a Bushido cursing them) */
  properties: Card[]
}

export type Phase = 'play' | 'ended'

export type Pending =
  | {
      type: 'parry'
      seat: number            // who must respond
      attackerSeat: number
      weaponCard: Card
      damage: number
    }
  | {
      type: 'forced'          // battlecry / jiujitsu
      kind: 'battlecry' | 'jiujitsu'
      sourceSeat: number
      queue: number[]         // seats still to respond, current first
      card: Card
    }
  | { type: 'bushido'; seat: number; flipped: Card }
  | { type: 'ieyasu'; seat: number }
  | { type: 'discard'; seat: number; count: number }

export interface GameResultTeamScore {
  team: Team
  total: number
  penalty: number
  members: {
    seat: number
    role: RoleId
    honor: number
    multiplier: number
    daimyo: number
    score: number
  }[]
}

export interface GameResult {
  type: 'scored' | 'swordmaster'
  winnerTeam: Team
  teams: GameResultTeamScore[]
  /** seat of last player standing, for swordmaster */
  swordmasterSeat?: number
}

export interface LogEntry {
  n: number
  text: string
}

export interface GameState {
  playerCount: number
  players: PlayerState[]
  deck: Card[]
  discard: Card[]
  turnSeat: number
  phase: Phase
  /** weapons played by the turn player this turn */
  weaponsPlayed: number
  pending: Pending | null
  rng: number
  log: LogEntry[]
  logN: number
  result: GameResult | null
  turnCount: number
  /** set when a defeat was dealt by a teammate and ended the game */
  friendlyEndTeam: Team | null
  /** faster duels: everyone's starting Honor is capped at this (null = full) */
  honorCap: number | null
}

// ---------- Intents (what a seat asks the engine to do) ----------

export type Intent =
  | { t: 'playWeapon'; card: number; target: number }
  | { t: 'playAction'; card: number; target?: number; propertyCard?: number }
  | { t: 'playProperty'; card: number; target?: number }
  | { t: 'nobunaga' }
  | { t: 'endTurn' }
  | { t: 'respondParry'; card: number | null }
  | { t: 'respondForced'; card: number | null }
  | { t: 'respondBushido'; discardWeapon?: number; loseHonor?: boolean; discardBushido?: boolean }
  | { t: 'respondIeyasu'; fromDiscard: boolean }
  | { t: 'respondDiscard'; cards: number[] }

// ---------- Redacted view sent to each client ----------

export interface PublicPlayer {
  seat: number
  name: string
  character: CharacterId
  maxResilience: number
  resilience: number
  honor: number
  handCount: number
  properties: Card[]
  harmless: boolean
  /** revealed role: shogun always; everyone at game end / 3p */
  role: RoleId | null
}

export interface PlayerView {
  seat: number
  playerCount: number
  you: { hand: Card[]; role: RoleId; team: Team }
  players: PublicPlayer[]
  deckCount: number
  discardTop: Card | null
  discardCount: number
  turnSeat: number
  phase: Phase
  weaponsPlayed: number
  weaponsAllowed: number
  /** pending prompt if it's addressed to this seat */
  prompt: Pending | null
  /** who everyone is waiting for (seat), when prompt is not ours */
  waitingFor: number | null
  log: LogEntry[]
  result: GameResult | null
  /** the room's pace: starting Honor cap chosen by the host (null = full) */
  honorCap: number | null
}
