# Samurai Sword 侍

A faithful browser implementation of the card game **Samurai Sword** (dV Giochi's
BANG!-system game set in feudal Japan) — online multiplayer for 3–7 players, with
**no backend at all**. Missing warriors? The host can seat any number of **bots**
in the lobby, so it plays great with 1 or 2 humans too.

> Card artwork is original (ink & parchment SVG/CSS); the card roster, stats and rules
> follow the official rulebook. Samurai Sword is © daVinci Editrice S.r.l. — this is a
> non-commercial fan project.

## How multiplayer works

WebRTC via [PeerJS](https://peerjs.com). One player **creates a room** and shares the
4-letter code (or the copy-link). Everyone connects **directly to the host's browser**,
which runs the authoritative game engine. PeerJS's free public broker is only used for
the initial handshake — after that all traffic is peer-to-peer.

- No accounts, no API keys, no server to deploy.
- The **host's tab must stay open** — it is the game server.
- Each client only ever receives its own hand and role (redacted views): you cannot
  cheat by opening dev tools.
- Refreshes are survivable: guests auto-rejoin their seat; the host can resume the room
  from the home screen (state is snapshotted to localStorage).

## Develop & test locally

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # engine test suite (rules + fuzzer playing full random games)
npm run build    # production build into dist/
```

To try multiplayer alone, open three browser tabs on the dev URL: create a room in one
tab, join with the code from the two others.

## Deploy on Vercel

Push this repo to GitHub, then **Vercel → Add New Project → import the repo**. Vercel
auto-detects Vite; no configuration needed. Every push to `main` redeploys.

(Any static host works: `npm run build` and serve `dist/`.)

## Project layout

```
src/engine/   pure, deterministic rules engine (no UI/network) + vitest suite
  cards.ts    the full 90-card roster, characters, roles  ← deck counts live here
  game.ts     state machine: turns, combat, prompts, scoring
  view.ts     per-player redaction
  bot.ts      the bot brain — a heuristic policy over the same redacted view
              a human gets (bots cannot cheat); host drives them with a delay
src/net/      PeerJS host/guest sessions, reconnect, localStorage persistence
src/ui/       React screens: home, lobby, the 2.5D table, prompts, scoring reveal
```

### A note on deck composition

Card names, effects, weapon stats and the official type totals (32 weapons /
15 properties / 43 actions) are verified against the official rulebook. The exact
copy-count of a few cards is a documented approximation (marked `[approx]` in
`src/engine/cards.ts`) — adjust a number there if you ever find the official sheet.

## Rules summary

See the in-game card tooltips, or the design doc in
[`docs/2026-07-02-samurai-sword-design.md`](docs/2026-07-02-samurai-sword-design.md)
for the full implemented ruleset (turn structure, harmless status, honor scoring,
Sword Master victory, 3-player variant).
