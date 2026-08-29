# when you available

A group meeting coordinator that closes the loop — built for
[Cortex Research Group](https://campai.cortexresearch.group), Season 2 Episode 5.

**Live:** https://aunysillyme.github.io/wya/

## The thesis

The availability grid is what causes the no-show. A green box costs nothing, so
saying yes costs nothing, so nobody turns up. Reminders cannot repair a
commitment that was never made.

Every tool in this space collects availability and stops: When2Meet finds the
overlap and hands confirming and reminding back to the organiser, and Doodle,
Rallly and the When2Meet clones do the same. Meanwhile no-shows run 20-30% at
corporate campuses and ~32% across events, and the research is consistent that
the weakest formats are the ones where not attending costs nothing.

So this does not add reminders. It makes the yes expensive enough not to need
them.

## How it works

1. **Get in.** The room code mints itself into the url, so the address bar is
   the invite. Name only, no account. First person through the door sets the
   times from three one-tap presets.
2. **Sync a calendar.** Sign in with Google, paste the secret `.ics` address
   Google/Apple/Outlook publish, drop an `.ics` file (parsed in your browser,
   nothing uploaded), or just tap slots to cycle free → maybe → busy. Every one
   of them optional, and the whole step has a Skip button.
3. **The board suggests.** A time is only clean if it is clean for everyone, so
   one person's conflict is the table's conflict. Anyone at the table can also
   propose a specific date and time, and the slot carries the name of whoever
   asked for it.
4. **Stake five chips** on the times you will actually turn up for, stacked if
   you mean it. You cannot chip everything, and you cannot stake a slot you
   marked busy. The board closes itself the moment no chip left in anyone's hand
   can catch the leader.
5. **Show up, or don't.** Turn up and your stake comes back. Don't, and it
   burns, and you are short next time someone asks when you available.

Then the AI notetaker writes the meeting into the room's record and deals a
fresh board, with chips carrying across. The room is the team; meetings are
rounds inside it.

## The record

Every fact in a meeting's record is composed from state the room holds — the
time called, what it won on, minutes from first chip to close, who staked what,
who showed. The model is handed only the notes people typed, and asked for two
or three sentences that name decisions and owners.

If that call fails, or returns a shape we did not expect, the record says there
is no summary rather than inventing one. An honest gap beats a confident fake.

## Running it

`index.html` is one self-contained file. Open it, or serve the directory. No
build step, no bundler, no dependency — Google Fonts and (only if you use it)
Google Identity Services are the external requests.

Multiplayer needs the room worker (`worker/`), a Durable Object addressed by
name. Without it the app falls back to a table in this browser and says so on
the board rather than pretending. `worker/test-loop.mjs` drives the whole loop
against the deployed worker: 31 assertions, entry through the record and the
next round.

## Google sign-in

Optional, and inert until a client ID is wired in. To turn it on:

1. Google Cloud Console → **APIs & Services → the credentials page**, on the
   project with the Calendar API enabled (`claude-mcp-auny`).
2. **Create an OAuth client ID → Web application.**
3. **Authorised JavaScript origins:** `https://aunysillyme.github.io`
   No redirect URI is needed — this is the GIS token flow, not a redirect flow,
   so there is no client secret anywhere and no backend in the path.
4. Try it live by appending `?gclient=<CLIENT_ID>` to the url.
5. To make it the default, set `GOOGLE_CLIENT_ID` in `index.html`.

The scope is `calendar.freebusy`, deliberately the narrowest one that answers
the question: it returns busy intervals and nothing else — no titles, no guests,
no locations. The token is short-lived and dropped when the tab closes.

Without a client ID the button says so and points at the `.ics` options, which
need no account and reach the same result.

## Limits, stated not hidden

- Timezones read as local; only the trailing-`Z` UTC form converts exactly.
- Recurrence handles `DAILY`/`WEEKLY` with `INTERVAL`, `BYDAY`, `COUNT`,
  `UNTIL`. Monthly and yearly are treated as one-off.
- All-day events soften a slot to *maybe*, never *busy*. A judgment call that
  can be wrong.
- Availability is self-reported after sync. The chips are what make honesty
  cost something.
- No verified identity. Names are typed, not proven.
