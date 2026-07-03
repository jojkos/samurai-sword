# Lobby review — owner feedback (to fold into the fix pass)

Captured from playtest of the living-ink lobby. Address after the ink-rollout
workflow lands (these are on top of / may overlap its reviewers' findings).

1. **The 令 red seal in the lobby is decorative but looks clickable** — it's a
   fake affordance. Either remove it or clearly fold it into the header so it
   doesn't read as a button. (screenshot: floating red hanko with 令)

2. **"Begin the duel" button + the "awaiting N more" hint are very hard to read**
   — low contrast: pale text over the torn-paper ink lines. Needs a solid/darker
   text treatment or a backing so both read clearly. The disabled begin button is
   especially washed out.

3. **Have to SCROLL to reach "Leave the gathering"** — the lobby overflows
   vertically when it shouldn't; there's enough screen height. Recompose so the
   whole lobby (code/QR + 7 slots + begin + leave) fits without scrolling on a
   normal desktop viewport (and stays sane on mobile portrait).

4. **Too many per-seat kanji numerals (一–七) read as noise** — don't give every
   player a different decorative glyph. Tone down / simplify the seat plates.

5. **History handling — OWNER WANTS THIS (confirmed).** Make screens real
   URL states so browser back/forward work, via client-side routing (History API
   pushState / popstate — NO full reload), which keeps the in-memory PeerJS
   session alive so it does NOT break the WebRTC connection. Plan:
   - URL ↔ screen map: `/` = home, `/room/<CODE>` = lobby, `/room/<CODE>/duel` =
     game (or keep lobby+game under one room URL and drive by session phase).
     `?join=<CODE>` already handled — fold into the room route.
   - `popstate` (back/forward) drives screen transitions instead of remounting;
     back out of a room = the existing leave() semantics (close session).
   - Guard: don't tear down `sessionRef` on route change; only leave() closes it.
   - Hard reload still recovers via existing host-resume (localStorage) and
     guest-rejoin (sessionStorage) — unchanged.
   - Do this AFTER the ink-rollout workflow finishes (it's mid-edit on App.tsx;
     routing also rewrites App.tsx — sequence to avoid conflicts).

6. **Guest tab-close gap: LEAVE AS-IS for now** (owner ok). sessionStorage per-tab
   stays; a guest who fully closes their tab mid-game loses their seat. Not fixing.
