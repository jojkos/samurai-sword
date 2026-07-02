# Samurai Sword — browser game, one-shot design spec

Date: 2026-07-02. Approved direction from brainstorming session.

## Goal

A faithful, polished browser implementation of dV Giochi's **Samurai Sword** (BANG! game
system, feudal Japan, no player elimination) playable online with friends, deployed as a
static site on Vercel with **no backend**.

## Decisions (user-approved)

- **Multiplayer**: PeerJS WebRTC. Host's browser is authoritative; guests join via room
  code through PeerJS's free public broker. No accounts, no keys, no server code.
- **No bots** — online multiplayer only (3–7 humans). Testable locally with several tabs.
- **Art**: "ink & parchment" feudal-Japan style. The **card roster is the original one**
  (real names, stats, effects of all 90 cards + 12 characters + 7 roles), but artwork is
  original SVG/CSS (sumi-e brush style, washi texture, hanko seals) because the printed
  game's illustrations are copyrighted and this deploys publicly.
- **Stack**: Vite + React + TypeScript, vitest for the rules engine. Deploy: Vercel
  zero-config (`vite build`).
- **"3D"**: 2.5D via CSS 3D transforms (perspective table, card flips/deals), no WebGL.

## Rules source of truth

Official dV Giochi rulebook (read in full, EN/ES editions). Key mechanics implemented:

- Roles by player count — 3p: Shogun+2 Ninja (special rules); 4p: Shogun, Samurai, 2 of
  3 Ninjas (random); 5p: +Ronin, 2 Ninja; 6p: 1 Samurai, Ronin, 3 Ninja; 7p: 2 Samurai,
  Ronin, 3 Ninja. Shogun face-up, others secret. Ninja cards carry 1/2/3 stars.
- Honor: Shogun 5, others 4 (3 in 4–5p games). 3p: Shogun 6, Ninjas 3.
- Initial hands clockwise from Shogun: 4,5,5,6,6,7,7.
- Turn: **Recover** (0 resilience → refill; Bushido flip happens at end of this phase) →
  **Draw 2** → **Play** any number, max 1 Weapon (+1 per Focus, +1 Goemon; 3p Shogun +1)
  → **Discard** to 7.
- Distance = min seat distance skipping Harmless players; +1 per Armor of target,
  +1 vs Benkei; Kojirō ignores difficulty. Weapon needs difficulty ≥ distance.
- Harmless = 0 resilience OR empty hand: not weapon-targetable, immune to Battle Cry /
  Jiu-jitsu, skipped in distance counting. Still in the game.
- Parry stops a weapon (out of turn). Hanzō may parry with a weapon card unless it is
  his last hand card (also vs Battle Cry).
- Defeat (losing last resilience, incl. via Battle Cry / Jiu-jitsu): victim gives 1 honor
  to the defeater; victim stays at 0 resilience (harmless) until own Recover phase.
- Deck exhausted: reshuffle discards AND every player loses 1 honor to the box.
- Game end: any player at 0 honor → reveal & score. Score = honor × multiplier:
  3p Shogun ×2 / Ninja ×1; 4p Shogun ×1, Samurai ×2, most-starred Ninja ×2 other ×1;
  5p all ×1, Ronin ×2; 6p Samurai ×2, Ronin ×3, others ×1; 7p all ×1, Ronin ×3.
  +1 per Daimyo in hand (never multiplied; 0 for Ronin). If the game ended because a
  player was defeated by a teammate: that team −3 ("mortal blow") and no Sword Master
  victory. Ties: Ninja beat all; Shogun team beats Ronin.
- **Sword Master victory**: the moment only one player has resilience left, that
  player's team instantly wins (unless friendly-fire end).
- 3p special: Shogun draws 3, plays 2 weapons, doubles score, never loses honor to
  Bushido (discards it instead), no Sword Master victory.

### Cards (originals)

Actions (43): Parry ×15, Geisha ×6, Diversion ×5, Jiu-jitsu ×4, Battle Cry ×4,
Tea Ceremony ×4, Daimyo ×3, Breathing ×2.
Properties (15): Focus ×5, Armor ×4, Quick Draw ×4, Bushido ×2.
Weapons (32): Bokken 1/1 ×6, Kiseru 1/2 ×3, Bō 1/2 ×3, Shuriken 3/1 ×4,
Kusarigama 2/2 ×4, Nagayari 2/1 ×3, Kanabō 3/2 ×2, Naginata 4/1 ×2, Daikyū 5/2 ×1,
Tanegashima 5/1 ×1, Wakizashi 1/3 ×1, Katana 2/3 ×1, Nodachi 3/3 ×1.

> Note: card NAMES, type totals (32/15/43), all effects, weapon stats, 6× Bokken and
> 1× each of Wakizashi/Katana/Nodachi are verified from the rulebook + reviews. The
> remaining per-card copy counts are a documented approximation (BGG's official list is
> paywalled/Cloudflare-blocked); all live in `src/engine/cards.ts`, one line to adjust.

Characters (12): Benkei 5 (+1 difficulty to be attacked), Chiyome 4 (only weapons hurt
her), Ginchiyo 4 (−1 weapon wound, min 1), Goemon 5 (+1 weapon/turn), Hanzō 4 (weapon
as parry), Hideyoshi 4 (draws 3), Ieyasu 5 (first draw may come from discard pile),
Kojirō 5 (ignores difficulty), Musashi 5 (+1 weapon wound), Nobunaga 5 (pay 1
resilience—not last—for 1 card), Tomoe 5 (draw on successful weapon hit), Ushiwaka 4
(draw 1 per weapon wound suffered).

## Architecture

Three isolated layers:

- `src/engine/` — pure deterministic rules engine. Seeded PRNG in state. API:
  `createGame(config) → GameState`, `applyIntent(state, seat, intent) → GameState`
  (throws on illegal moves), `viewFor(state, seat) → PlayerView` (redaction),
  pending-prompt model for interrupts (parry, Jiu-jitsu/Battle Cry responses, Bushido
  choice, Breathing target, Ieyasu draw source, discard-to-7).
- `src/net/` — PeerJS. Host registers `ss-<CODE>`, keeps engine state, applies intents,
  broadcasts per-seat redacted views. Guests send intents, render views. Seat tokens in
  localStorage allow rejoin after refresh; host snapshots state to localStorage and
  reclaims its peer id on reload.
- `src/ui/` — React screens: Home (create/join) → Lobby → Table → Endgame reveal.
  Table: elliptical seating, own hand fan, target highlighting, interrupt modals,
  game log, secret role peek. CSS 3D: perspective table, card flip/deal animations.

Anti-cheat by construction: a guest's client never receives other players' hands or
secret roles — redaction happens on the host before sending.

## Testing

- vitest engine suite: setup per player count, distance/harmless math, combat + parry,
  defeat honor transfer, friendly-fire end, reshuffle honor loss, Sword Master victory,
  full scoring tables (Daimyo, ties, multipliers), every character ability, Bushido
  pass/discard, 3-player Shogun rules.
- `npm run build` clean; manual multi-tab game locally.

## Out of scope (v1)

Bots, Rising Sun expansion, spectators, chat (use voice), mobile-portrait layout
(landscape/desktop first, though it should degrade gracefully).
