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

5. **Routing question (answered in chat):** consider making lobby a real route so
   browser back/forward works. Feasible via client-side routing (pushState, no
   reload) — that would NOT break the WebRTC connection because the session object
   stays in memory. A hard reload still recovers via existing host-resume /
   guest-rejoin. Deferred as a nice-to-have; see chat answer.
