/* when you available - the room worker.

   One Durable Object per room, addressed by name, so idFromName(CODE) is the
   whole room system. No database, no schema.

   Every rule that decides anything lives HERE and never in the client. A client
   that decides when the board is closed can decide it in its own favour. The
   frontend mirrors this maths for its solo fallback, but the mirror never wins. */

const CHIPS = 5;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", ...CORS },
  });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const p = url.pathname.split("/").filter(Boolean);

    /* Fetch a calendar feed the browser cannot reach. Google, Apple and Outlook
       each publish a secret .ics address and none of them send CORS headers, so
       this hop is the only way a paste-a-link flow can work at all. The feed is
       returned to the browser and parsed there - it is never stored here. */
    if (p[0] === "ics" && req.method === "POST") {
      let feed;
      try {
        feed = (await req.json()).url;
      } catch {
        return json({ error: "Couldn't read that request." }, 400);
      }
      if (typeof feed !== "string" || !feed.trim())
        return json({ error: "Paste the address first." }, 400);
      let u;
      try {
        u = new URL(feed.trim().replace(/^webcal:\/\//i, "https://"));
      } catch {
        return json({ error: "That doesn't look like a link." }, 400);
      }
      if (u.protocol !== "https:" && u.protocol !== "http:")
        return json({ error: "Only http and https calendar links." }, 400);
      try {
        const r = await fetch(u.toString(), {
          headers: { "user-agent": "when-you-available/1.0" },
          redirect: "follow",
        });
        if (!r.ok) return json({ error: "The calendar returned " + r.status + "." }, 502);
        const text = (await r.text()).slice(0, 4_000_000);
        if (!/BEGIN:VCALENDAR/i.test(text))
          return json({ error: "That link isn't a calendar feed." }, 422);
        return json({ ics: text });
      } catch {
        return json({ error: "Couldn't reach that calendar." }, 502);
      }
    }

    if (p[0] === "room" && p[1]) {
      const code = p[1].toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
      if (!code) return json({ error: "No room." }, 400);
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      return stub.fetch(
        new Request("https://room/" + code + "/" + (p[2] || ""), {
          method: req.method,
          body: req.method === "POST" ? req.body : undefined,
          headers: req.headers,
        })
      );
    }
    return json({ error: "Not found." }, 404);
  },
};

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  blank(code) {
    return {
      code,
      slots: [],
      players: {},
      avail: {},
      stakes: {},
      attendance: {},
      locked: false,
      winner: null,
      lockedAt: null,
      firstChipAt: null,
      notes: [],
      history: [],
    };
  }

  async fetch(req) {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const code = parts[0];
    const act = parts[1] || "";

    if (req.method === "GET") {
      const r = (await this.state.storage.get("r")) || this.blank(code);
      return json(this.view(r));
    }

    let body = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Couldn't read that request." }, 400);
    }

    /* Serialised. Two people staking in the same instant must not both read the
       same pre-write state and both believe they were the one who closed it. */
    let out;
    await this.state.blockConcurrencyWhile(async () => {
      const r = (await this.state.storage.get("r")) || this.blank(code);
      out = await this.apply(act, body, r);
      if (!out.error) await this.state.storage.put("r", r);
    });
    /* An error must not come back 200. The client tests res.ok before reading
       the body, so a 200 with an {error} payload lands in the board as state. */
    if (out.error) return json({ error: out.error }, out.status || 400);
    return json(out.body || this.view(out.room));
  }

  async apply(act, b, r) {
    if (act === "join") {
      const name = String(b.name || "").trim().slice(0, 24);
      if (!name) return { error: "Type a name so people know who staked what." };
      /* First through the door sets the board. Everyone after joins the board
         that already exists - the times belong to the room, not the person. */
      if (!r.slots.length) {
        const slots = Array.isArray(b.slots) ? b.slots : [];
        const clean = slots
          .filter((s) => s && s.id && Number.isFinite(+s.startsAt))
          .slice(0, 24)
          .map((s) => ({
            id: String(s.id).slice(0, 24),
            label: String(s.label || "").slice(0, 40),
            startsAt: +s.startsAt,
            endsAt: +s.endsAt || +s.startsAt + 5400000,
          }));
        if (!clean.length) return { error: "That table has no times on it." };
        r.slots = clean;
      }
      const pid = "p" + Math.random().toString(36).slice(2, 10);
      r.players[pid] = { name, chips: CHIPS, synced: false };
      r.avail[pid] = {};
      return { room: r, body: { playerId: pid, state: this.view(r) } };
    }

    const me = b.playerId && r.players[b.playerId] ? b.playerId : null;
    if (!me) return { error: "This table doesn't know you. Rejoin from the link.", status: 403 };

    switch (act) {
      case "avail": {
        const a = b.avail && typeof b.avail === "object" ? b.avail : {};
        const clean = {};
        for (const s of r.slots) {
          /* Anything that is not one of the two flagged states is dropped, not
             coerced. A junk value must never read as free and win a slot. */
          if (a[s.id] === "maybe" || a[s.id] === "busy") clean[s.id] = a[s.id];
        }
        r.avail[me] = clean;
        r.players[me].synced = true;
        /* A slot you have just marked busy cannot keep your chips on it. */
        if (!r.locked)
          for (const sid of Object.keys(clean))
            if (clean[sid] === "busy" && r.stakes[sid]) delete r.stakes[sid][me];
        this.settle(r);
        return { room: r };
      }

      case "chip": {
        if (r.locked) return { error: "The board already closed." };
        const sid = String(b.slotId || "");
        if (!r.slots.some((s) => s.id === sid)) return { error: "No such time." };
        if ((r.avail[me] || {})[sid] === "busy")
          return { error: "You marked that one busy." };
        if (this.spentBy(r, me) >= r.players[me].chips)
          return { error: "Your hand is empty." };
        r.stakes[sid] = r.stakes[sid] || {};
        r.stakes[sid][me] = (r.stakes[sid][me] || 0) + 1;
        if (!r.firstChipAt) r.firstChipAt = Date.now();
        this.settle(r);
        return { room: r };
      }

      /* Anyone at the table can put a time on it, not just whoever opened the
         room. The proposer's name rides on the slot: a time somebody actually
         asked for reads differently from one the preset generated. */
      case "propose": {
        if (r.locked) return { error: "The board already closed." };
        const at = +b.startsAt;
        if (!Number.isFinite(at)) return { error: "Pick a date and a time." };
        if (at < Date.now() - 60000) return { error: "That one's already been and gone." };
        if (r.slots.length >= 24)
          return { error: "The table is full. Wrap this round up first." };
        if (r.slots.some((s) => Math.abs(s.startsAt - at) < 60000))
          return { error: "That time is already on the table." };
        r.slots.push({
          id: "u" + Math.random().toString(36).slice(2, 8),
          label: String(b.label || "").slice(0, 40),
          startsAt: at,
          endsAt: at + 5400000,
          by: me,
          byName: r.players[me].name,
        });
        r.slots.sort((x, y) => x.startsAt - y.startsAt);
        return { room: r };
      }

      case "unchip": {
        if (r.locked) return { error: "The board already closed." };
        for (const sid of Object.keys(r.stakes)) delete r.stakes[sid][me];
        return { room: r };
      }

      case "note": {
        const text = String(b.text || "").trim().slice(0, 1000);
        if (!text) return { error: "Type something first." };
        r.notes.push({ playerId: me, name: r.players[me].name, text, at: Date.now() });
        if (r.notes.length > 300) r.notes = r.notes.slice(-300);
        return { room: r };
      }

      case "attend": {
        if (!r.locked) return { error: "Nothing has been called yet." };
        const showed = b.showed === true;
        r.attendance[me] = showed ? "showed" : "noshow";
        const staked = (r.stakes[r.winner] || {})[me] || 0;
        /* Turn up and the stake comes back. Don't and it burns, so you are short
           next time someone asks. Re-marking flips it rather than compounding. */
        r.players[me].chips = showed ? CHIPS : Math.max(0, CHIPS - staked);
        return { room: r };
      }

      case "next": {
        if (!r.locked) return { error: "Nothing has been called yet." };
        const record = this.record(r);
        /* The AI half only ever summarises notes people typed. If it fails, or
           comes back a shape we did not expect, the record says there is no
           summary rather than inventing one. */
        if (record.notes.length && this.env.AI) {
          try {
            const res = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
              messages: [
                {
                  role: "system",
                  content:
                    "You summarise meeting notes. Two or three sentences, plain and specific. " +
                    "Name decisions and who owns them. Use ONLY what is in the notes. " +
                    "Never invent a decision, a name, or a next step.",
                },
                {
                  role: "user",
                  content:
                    "Meeting on " + record.label + ".\n\n" +
                    record.notes.map((n) => n.name + ": " + n.text).join("\n"),
                },
              ],
              max_tokens: 220,
            });
            const text =
              res && typeof res.response === "string" ? res.response.trim() : "";
            if (text) {
              record.summary = text.slice(0, 1200);
              record.summarised = true;
            }
          } catch {
            /* left as summary: null - an honest gap beats a confident fake */
          }
        }
        r.history.push(record);
        if (r.history.length > 40) r.history = r.history.slice(-40);

        /* Deal a fresh board. Chips carry across: the room is the team, and the
           meetings are rounds inside it. */
        if (Array.isArray(b.slots) && b.slots.length) {
          r.slots = b.slots
            .filter((s) => s && s.id && Number.isFinite(+s.startsAt))
            .slice(0, 24)
            .map((s) => ({
              id: String(s.id).slice(0, 24),
              label: String(s.label || "").slice(0, 40),
              startsAt: +s.startsAt,
              endsAt: +s.endsAt || +s.startsAt + 5400000,
            }));
        }
        r.stakes = {};
        r.attendance = {};
        r.notes = [];
        r.locked = false;
        r.winner = null;
        r.decidedBy = null;
        r.tiedWith = 0;
        r.lockedAt = null;
        r.firstChipAt = null;
        for (const pid of Object.keys(r.players)) {
          r.avail[pid] = {};
          r.players[pid].synced = false;
        }
        return { room: r };
      }

      default:
        return { error: "Not found.", status: 404 };
    }
  }

  spentBy(r, pid) {
    let n = 0;
    for (const sid of Object.keys(r.stakes)) n += r.stakes[sid][pid] || 0;
    return n;
  }
  unspent(r) {
    let u = 0;
    for (const pid of Object.keys(r.players))
      u += Math.max(0, r.players[pid].chips - this.spentBy(r, pid));
    return u;
  }
  totals(r) {
    return r.slots.map((s) => {
      const m = r.stakes[s.id] || {};
      let n = 0;
      for (const k of Object.keys(m)) n += m[k];
      return { id: s.id, label: s.label, n };
    });
  }

  /* Has the board decided itself? While the leader's margin is within reach of
     every chip still in every hand, waiting can still change the answer. Once it
     is not, waiting cannot, so the board stops asking. */
  settle(r) {
    if (r.locked) return;
    const t = this.totals(r).sort((a, b) => b.n - a.n);
    if (t.length < 2 || t[0].n === 0) return;
    const unspent = this.unspent(r);

    /* The ordinary close: the leader's margin is bigger than every chip still
       in every hand, so waiting can no longer change the answer. */
    if (t[0].n - t[1].n > unspent) {
      r.locked = true; r.winner = t[0].id; r.lockedAt = Date.now();
      r.decidedBy = "lead";
      return;
    }

    /* Nothing left to play and still level. Without this the board sits open
       forever on a dead tie and nobody holds a chip that could move it.
       Broken on the thing the room already agreed matters: the time that suits
       the most people, and the sooner of two that suit equally. */
    if (unspent === 0) {
      const top = t[0].n;
      const tied = t.filter((x) => x.n === top).map((x) => x.id);
      if (tied.length < 2) return;
      const conflict = {};
      for (const s2 of r.slots) {
        let busy = 0, maybe = 0;
        for (const pid of Object.keys(r.players)) {
          const v = (r.avail[pid] || {})[s2.id];
          if (v === "busy") busy++;
          else if (v === "maybe") maybe++;
        }
        conflict[s2.id] = { busy, maybe, at: s2.startsAt };
      }
      tied.sort((x, y) => {
        const a = conflict[x], b = conflict[y];
        if (a.busy !== b.busy) return a.busy - b.busy;
        if (a.maybe !== b.maybe) return a.maybe - b.maybe;
        return a.at - b.at;
      });
      r.locked = true; r.winner = tied[0]; r.lockedAt = Date.now();
      r.decidedBy = "tie";
      r.tiedWith = tied.length;
    }
  }

  /* The record is composed from facts the room holds - the time called, what it
     won on, how long it took, who staked what, who showed. */
  record(r) {
    const slot = r.slots.find((s) => s.id === r.winner) || null;
    const stakes = r.stakes[r.winner] || {};
    const people = Object.keys(stakes)
      .map((pid) => ({
        name: r.players[pid] ? r.players[pid].name : "someone who left",
        chips: stakes[pid],
        attendance: r.attendance[pid] || "unknown",
      }))
      .sort((a, b) => b.chips - a.chips);
    const showed = people.filter((p) => p.attendance === "showed");
    const missed = people.filter((p) => p.attendance === "noshow");
    const t = this.totals(r).sort((a, b) => b.n - a.n);
    const mins =
      r.firstChipAt && r.lockedAt
        ? Math.max(1, Math.round((r.lockedAt - r.firstChipAt) / 60000))
        : null;

    const facts = [];
    facts.push(slot ? "Called for " + slot.label + "." : "A time was called.");
    if (r.decidedBy === "tie")
      facts.push(
        "Tied on " + (t.length ? t[0].n : 0) + " chips with " + ((r.tiedWith || 2) - 1) +
          " other time" + ((r.tiedWith || 2) - 1 === 1 ? "" : "s") +
          ", and took the one fewest people had a conflict with."
      );
    else if (t.length > 1)
      facts.push(
        "Won on " + t[0].n + " chips against " + t[1].n +
          ", and closed early because nothing left in hand could catch it."
      );
    if (mins) facts.push("Settled " + mins + " minute" + (mins === 1 ? "" : "s") + " after the first chip.");
    facts.push(
      people.length + " staked in" +
        (showed.length || missed.length
          ? ": " + showed.length + " turned up" +
            (missed.length
              ? ", " + missed.map((p) => p.name).join(" and ") + " did not"
              : "")
          : ", attendance never marked") + "."
    );

    return {
      at: Date.now(),
      label: slot ? slot.label : "unknown",
      chipsFor: t.length ? t[0].n : 0,
      runnerUp: t.length > 1 ? t[1].n : 0,
      settledIn: mins,
      people,
      notes: r.notes.map((n) => ({ name: n.name, text: n.text, at: n.at })),
      facts,
      summary: null,
      summarised: false,
    };
  }

  view(r) {
    const totals = this.totals(r);
    const sorted = totals.slice().sort((a, b) => b.n - a.n);
    const availability = {};
    for (const s of r.slots) {
      let busy = 0, maybe = 0;
      for (const pid of Object.keys(r.players)) {
        const v = (r.avail[pid] || {})[s.id];
        if (v === "busy") busy++;
        else if (v === "maybe") maybe++;
      }
      /* One person's conflict is the table's conflict, so the worst answer in
         the room sets the slot's state. */
      availability[s.id] = {
        state: busy ? "conflict" : maybe ? "maybe" : "clean",
        busy,
        maybe,
      };
    }
    return {
      code: r.code,
      slots: r.slots,
      players: r.players,
      stakes: r.stakes,
      avail: r.avail,
      availability,
      clean: r.slots.filter((s) => availability[s.id].state === "clean").map((s) => s.id),
      synced: Object.keys(r.players).filter((p) => r.players[p].synced).length,
      playerCount: Object.keys(r.players).length,
      locked: r.locked,
      winner: r.winner,
      decidedBy: r.decidedBy || null,
      tiedWith: r.tiedWith || 0,
      attendance: r.attendance,
      chips: CHIPS,
      totals,
      notes: r.notes,
      history: r.history,
      firstChipAt: r.firstChipAt,
      unspent: this.unspent(r),
      gap: sorted.length > 1 ? sorted[0].n - sorted[1].n : 0,
      leader: sorted.length && sorted[0].n > 0 ? sorted[0].id : null,
    };
  }
}
