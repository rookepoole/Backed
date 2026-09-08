// Calendar parsing stays entirely in the browser.
(function (root) {
  "use strict";

  var DAY = 86400000;
  var DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  // RFC 5545 folds long lines with a leading space or tab.
  function unfold(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
  }

  function parseWhen(raw, params) {
    if (!raw) return null;
    var v = raw.trim();
    var m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    var allDay = !m[4] || (params && /VALUE=DATE(?!-TIME)/i.test(params));
    if (allDay) return { t: new Date(y, mo, d).getTime(), allDay: true };
    var hh = +m[4], mi = +m[5], ss = +m[6];
    if (m[7]) return { t: Date.UTC(y, mo, d, hh, mi, ss), allDay: false };
    return { t: new Date(y, mo, d, hh, mi, ss).getTime(), allDay: false };
  }

  function parseRule(rrule) {
    var out = {};
    String(rrule).split(";").forEach(function (bit) {
      var kv = bit.split("=");
      if (kv.length === 2) out[kv[0].toUpperCase()] = kv[1];
    });
    return out;
  }

  // Project a recurring event forward, but only across the window we care about.
  function expand(ev, from, to) {
    var out = [];
    var len = Math.max(ev.end - ev.start, 0);
    if (!ev.rrule) {
      if (ev.end > from && ev.start < to) out.push({ start: ev.start, end: ev.end, allDay: ev.allDay });
      return out;
    }
    var r = parseRule(ev.rrule);
    var freq = (r.FREQ || "").toUpperCase();
    if (freq !== "DAILY" && freq !== "WEEKLY") {
      if (ev.end > from && ev.start < to) out.push({ start: ev.start, end: ev.end, allDay: ev.allDay });
      return out;
    }
    var interval = Math.max(1, parseInt(r.INTERVAL, 10) || 1);
    var until = r.UNTIL ? (parseWhen(r.UNTIL) || {}).t : null;
    var count = r.COUNT ? parseInt(r.COUNT, 10) : null;
    var byday = r.BYDAY ? r.BYDAY.split(",").map(function (d) {
      return DAYS[d.replace(/^[-+]?\d+/, "").toUpperCase()];
    }).filter(function (d) { return d !== undefined; }) : null;

    var step = freq === "DAILY" ? DAY * interval : DAY * 7 * interval;
    var made = 0;
    // Never walk forever: the board is days wide, so cap the projection.
    for (var t = ev.start, guard = 0; guard < 800; guard++, t += step) {
      if (until !== null && t > until) break;
      if (count !== null && made >= count) break;
      var occ = [t];
      if (freq === "WEEKLY" && byday && byday.length) {
        var weekStart = t - ((new Date(t).getDay() + 7) % 7) * DAY;
        occ = byday.map(function (d) { return weekStart + d * DAY + (t - new Date(t).setHours(0, 0, 0, 0)); });
      }
      for (var i = 0; i < occ.length; i++) {
        var s = occ[i], e = s + len;
        if (s < ev.start) continue;
        if (until !== null && s > until) continue;
        made++;
        if (e > from && s < to) out.push({ start: s, end: e, allDay: ev.allDay });
      }
      if (t > to + step) break;
    }
    return out;
  }

  // Returns busy/maybe windows overlapping [from, to)
  function parse(text, from, to) {
    var lines = unfold(String(text || "")).split("\n");
    var events = [], cur = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^BEGIN:VEVENT/i.test(line)) { cur = {}; continue; }
      if (/^END:VEVENT/i.test(line)) {
        if (cur && cur.start) {
          if (!cur.end) cur.end = cur.start + (cur.allDay ? DAY : 3600000);
          if (!cur.skip) events.push(cur);
        }
        cur = null;
        continue;
      }
      if (!cur) continue;

      var c = line.indexOf(":");
      if (c < 0) continue;
      var left = line.slice(0, c), value = line.slice(c + 1);
      var semi = left.indexOf(";");
      var key = (semi < 0 ? left : left.slice(0, semi)).toUpperCase();
      var params = semi < 0 ? "" : left.slice(semi + 1);

      if (key === "DTSTART") {
        var a = parseWhen(value, params);
        if (a) { cur.start = a.t; cur.allDay = a.allDay; }
      } else if (key === "DTEND") {
        var b = parseWhen(value, params);
        if (b) cur.end = b.t;
      } else if (key === "RRULE") {
        cur.rrule = value;
      } else if (key === "STATUS" && /CANCELLED/i.test(value)) {
        cur.skip = true;
      } else if (key === "TRANSP" && /TRANSPARENT/i.test(value)) {
        cur.skip = true; // marked "free" in the calendar, so not a conflict
      }
    }

    var windows = [];
    events.forEach(function (ev) {
      expand(ev, from, to).forEach(function (w) { windows.push(w); });
    });
    return windows;
  }

  // Map busy windows onto the board. Overlap of any real event = busy;
  // an all-day event only ever softens a slot to maybe.
  function applyTo(slots, windows) {
    var out = {};
    slots.forEach(function (s) {
      var state = "free";
      for (var i = 0; i < windows.length; i++) {
        var w = windows[i];
        if (w.end > s.startsAt && w.start < s.endsAt) {
          if (w.allDay) { if (state === "free") state = "maybe"; }
          else { state = "busy"; break; }
        }
      }
      if (state !== "free") out[s.id] = state;
    });
    return out;
  }

  root.ICS = { parse: parse, applyTo: applyTo, unfold: unfold };
})(typeof module !== "undefined" && module.exports ? module.exports : (typeof window !== "undefined" ? window : globalThis));
