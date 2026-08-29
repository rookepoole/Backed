# when you available

A group meeting coordinator that closes the loop — built for
[Cortex Research Group](https://campai.cortexresearch.group), Season 2 Episode 5.

**Live:** https://aunysillyme.github.io/whenyouavailable/

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
2. **Sync a calendar.** Paste the secret `.ics` address Google/Apple/Outlook
   publish, drop an `.ics` file (parsed locally, nothing uploaded), or just tap
   slots to cycle free → maybe → busy. All of it optional.
3. **The board suggests.** A time is only clean if it is clean for everyone, so
   one person's conflict is the table's conflict.
4. **Stake five chips** on the times you will actually turn up for, stacked if
   you mean it. You cannot chip everything, and you cannot stake a slot you
   marked busy. The board closes itself the moment no chip left in anyone's hand
   can catch the leader.
5. **Show up, or don't.** Turn up and your stake comes back. Don't, and it
   burns, and you are short next time someone asks when you available.

Then the notetaker writes the meeting into the room's record and deals a fresh
board, with chips carrying across. The room is the team; meetings are rounds
inside it.

## Running it

`index.html` is one self-contained file. Open it, or serve the directory. No
build step, no bundler, no dependency — Google Fonts is the only external
request.

Multiplayer needs the room worker (`worker/`). Without it the app falls back to
a table in this browser and says so on the board rather than pretending.

## Limits, stated not hidden

- Timezones read as local; only the trailing-`Z` UTC form converts exactly.
- Recurrence handles `DAILY`/`WEEKLY` with `INTERVAL`, `BYDAY`, `COUNT`,
  `UNTIL`. Monthly and yearly are treated as one-off.
- All-day events soften a slot to *maybe*, never *busy*. A judgment call that
  can be wrong.
- Availability is self-reported after sync. The chips are what make honesty
  cost something.
- No verified identity. Names are typed, not proven.
