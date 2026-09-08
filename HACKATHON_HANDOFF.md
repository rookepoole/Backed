# BACKED — Hackathon Handoff

## 30-second pitch

**BACKED is a group meeting coordinator that turns availability into commitment.** The problem with scheduling tools is that “I’m free” is nearly costless, so a calendar full of green boxes still leaves the organizer chasing people and wondering who will actually show. BACKED gives everyone five scarce units of backing to spend on the times they will genuinely protect. The board watches the math and locks itself the instant no remaining backing can change the winner. No accounts, local calendar parsing, and the live room runs browser-to-browser over WebRTC.

## Short form / submission pitch

**BACKED makes groups commit to a meeting instead of merely marking themselves free.** Everyone gets five scarce units to back the times they will actually protect; the room locks automatically once the winner is mathematically uncatchable.

## Pain point

Scheduling products optimize for *overlap*, but overlap is not commitment. Organizers still have to interpret weak availability signals, confirm manually, remind everyone, and absorb no-shows.

## Judge demo — 60 seconds

1. Open the site and click **Open judge-ready demo**.
2. Point out the room **purpose** at the top — scheduling is attached to a goal.
3. Show the five backing units in the left rail.
4. On any card, switch **CLEAR → MAYBE → BUSY** to show privacy-preserving conflict signaling.
5. Click **+1 BACK THIS TIME** and show the live leader/gap/unspent metrics.
6. Explain the lock rule: once `gap > unspent`, nothing anyone can still spend can change the answer.
7. If the demo is not yet locked, add backing until it locks and show the black/acid **DECISION LOCKED** banner.
8. Mark attendance and add a decision note.
9. Show **ROOM MEMORY** so the app closes the loop instead of ending at a date poll.

## Technical talking points

- Static front-end; no app server or database.
- PeerJS performs the WebRTC handshake; room payloads use WebRTC DataConnections.
- Host-authoritative model: guests send actions, host validates and rebroadcasts canonical state.
- Host state persists in localStorage, enabling the host browser to resume the room.
- `.ics` calendar data is parsed locally; raw calendar contents never go to the host or another peer.
- Pure state machine is independently tested with `npm test`.

## Why it is a real remix, not a reskin

The supplied build used a casino/felt metaphor and a Cloudflare Durable Object as the authoritative multiplayer room. BACKED changes both the product metaphor and architecture: editorial commitment board, explicit room purpose, host-browser authority, WebRTC peer transport, persistent guest identity, and a modular/tested client core.

## Build ledger

### IMPLEMENTED

- BACKED identity + full editorial visual rewrite
- responsive desktop/mobile layout
- create room / join room via URL code
- WebRTC host/guest transport using PeerJS DataConnections
- host-authoritative action validation
- persistent guest identity
- host room persistence / resume
- five-unit backing budget
- busy/maybe/clear marks
- automatic mathematically inevitable lock
- deterministic tie breaker
- custom candidate time proposals
- local `.ics` import
- attendance consequence for next round budget
- notes + previous-room history
- seeded judge demo
- Node test suite

### TESTED

- JavaScript syntax checks pass for `app.mjs`, `core.mjs`, and `ics.js`
- DOM ID/reference audit: no missing app-referenced IDs and no duplicate IDs
- `npm test`: **5/5 passing**
- repository grep: no Cloudflare Worker URL, `workers.dev`, Durable Object, or original product name in runtime files

### NOT FULLY NETWORK-TESTED IN THIS BUILD ENVIRONMENT

The execution container cannot resolve the public PeerJS CDN/signaling host, so a real two-browser internet handshake could not be exercised here. The app uses documented PeerJS 1.5.5 APIs (`new Peer()`, `peer.connect`, `connection.on('data')`) and degrades visibly if the library/signaling service is unreachable.

### NEXT 10-MINUTE POLISH IF TIME EXISTS

- Deploy to an HTTPS static host and test one host + two guests on separate networks.
- Add a tiny TURN config only if the judge network blocks direct WebRTC.
- Capture a clean OG/social preview image after deployment.
- Optional: add host-transfer protocol so a room survives the original host leaving.
