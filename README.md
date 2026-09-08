# BACKED

**Commitment-first group scheduling over WebRTC.**

> Don't vote for when you're free. Back the time you'll actually protect.

BACKED is a clean-room product/visual remix of the supplied scheduling repo for Cortex Research Group Season 2, Episode 5. It keeps the strongest underlying mechanic — scarce commitment and an automatic mathematical close — but replaces the casino/felt framing, the Cloudflare Durable Object backend, the hosted-worker dependency, and the single-page explainer flow.

## The pain point

Availability tools answer **when could people meet?** They do not answer **which time will people actually defend and show up for?** A green checkbox is cheap, so five weak “yes” votes can look stronger than one person saying “I will protect this time.”

BACKED gives each participant **five units of backing**. You can stack all five on one time or spread them across several. The room locks the moment the leading time becomes mathematically uncatchable by all unspent backing combined.

## What changed in the remix

- **New product identity:** BACKED; editorial commitment board instead of casino/felt table.
- **New room primitive:** every room has a concrete *purpose* so the schedule is attached to an outcome, not just a date grid.
- **WebRTC multiplayer:** no Cloudflare Worker or application database. The host browser is authoritative and guests send actions over WebRTC data channels.
- **Host-authoritative state:** guests request actions; the host validates the rule and rebroadcasts the canonical room snapshot. That prevents peer divergence.
- **No hard-wired competitor infrastructure:** there are no `workers.dev`, Durable Object, or competitor deployment URLs in the app.
- **Local calendar privacy:** `.ics` files are parsed in the browser; only `busy` / `maybe` marks for candidate slots are shared.
- **Persistent guest identity:** a random local guest ID survives reloads without sign-in.
- **Decision record:** attendance, notes, and prior locks live in the room state.
- **Judge-ready demo:** one click loads a seeded room with participants, conflicts, backing, and history.
- **Pure/testable decision core:** room math is separated into `src/core.mjs` and covered with Node tests.

## WebRTC architecture

```
                       PeerJS Cloud
                    signaling / handshake
                           only
                            │
           ┌────────────────┴────────────────┐
           │                                 │
      Host browser  ◄════ WebRTC ════► Guest browser
   canonical room state       data       action requests
           │                                 │
           ├════ WebRTC ════► Guest browser  │
           └════ WebRTC ════► Guest browser  │

Calendar .ics ──► parsed locally ──► busy/maybe slot marks only
```

The host browser owns the canonical state. A guest never directly mutates its local copy: it sends an action (`back`, `mark`, `note`, etc.), the host validates it with the same pure core used by tests, then the host broadcasts the resulting state.

PeerJS is loaded from jsDelivr and uses PeerJS Cloud for signaling. The actual DataConnection payloads are WebRTC peer-to-peer. For production at meaningful scale, self-host PeerServer and add TURN rather than relying on the public signaling service.

## Decision rule

For each candidate time:

- `backed(time)` = total backing currently placed on that time
- `gap` = leader backing − runner-up backing
- `unspent` = every participant's remaining backing added together

The board locks when:

```
gap > unspent
```

At that point no possible arrangement of every remaining unit can catch the leader, so waiting for more input cannot change the answer.

If every unit is spent and the top score is tied, BACKED chooses:

1. fewer hard conflicts,
2. then fewer `maybe` marks,
3. then the earlier time.

## Calendar behavior

`.ics` files are parsed locally. Supported behavior inherited/adapted from the supplied repo includes:

- RFC 5545 folded lines
- `DAILY` / `WEEKLY` RRULE expansion with `INTERVAL`, `BYDAY`, `COUNT`, and `UNTIL`
- cancelled and transparent events ignored
- all-day events become `maybe`, not hard `busy`
- UTC `Z` timestamps handled exactly; floating/TZID values are interpreted in the viewer's local timezone

No event title, attendee, description, or raw calendar file is sent to peers.

## Run it

The app is static. Serve the directory over HTTP(S):

```bash
npm run serve
```

Then open:

```text
http://localhost:8080
```

For real remote WebRTC rooms, deploy the directory to an **HTTPS static host** so guests can open the invite URL from other devices/networks.

## Test it

```bash
npm test
```

Current suite covers:

- conflicts blocking backing
- five-unit scarcity
- automatic inevitable close
- full-spend tie resolution
- pulling backing when a slot becomes a hard conflict

## Repo map

```text
BACKED/
├── index.html          # application shell
├── styles.css          # editorial visual system
├── src/
│   ├── app.mjs         # UI + host-authoritative WebRTC transport
│   ├── core.mjs        # pure room rules / state transitions
│   └── ics.js          # local calendar parser
├── tests/
│   └── core.test.mjs   # decision-rule tests
├── package.json
├── HACKATHON_HANDOFF.md
└── README.md
```

## Known constraints

- The **host browser must stay open**. If it leaves, the room is no longer authoritative or joinable until that host/browser resumes its saved room.
- PeerJS Cloud is public signaling infrastructure, not a production SLA.
- A TURN server is not bundled; some restrictive/symmetric-NAT networks may fail to establish a direct connection.
- There is no verified identity. Guest IDs are random and persistent locally, but names are self-asserted.
- The room state is sent as snapshots and is optimized for small groups, not hundreds of participants.

## Why this is stronger for a 30-minute judging environment

The core idea is visible in seconds: **five scarce commitments, one inevitable lock**. The app opens with a one-click seeded demo, the product has a clear pain point, the network architecture is materially different from the supplied competitor repo, and every decision-critical rule can be tested without a deployed backend.
