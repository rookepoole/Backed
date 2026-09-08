export const BUDGET = 5;
export const SLOT_MINUTES = 90;

export function cleanCode(value = '') {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
}

export function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

export function makeSlots(kind = 'this', now = new Date()) {
  const base = new Date(now); base.setHours(0,0,0,0);
  const days = [];
  if (kind === 'weekend') {
    const cursor = new Date(base);
    while (days.length < 6) {
      cursor.setDate(cursor.getDate() + 1);
      if (cursor.getDay() === 6 || cursor.getDay() === 0) days.push(new Date(cursor));
    }
  } else {
    const offset = kind === 'next' ? 8 : 1;
    for (let i=0;i<6;i++) {
      const d = new Date(base); d.setDate(d.getDate() + offset + i); days.push(d);
    }
  }
  const bands = [[18,30],[20,0]];
  let n=0;
  return days.flatMap(day => bands.map(([h,m]) => {
    const t = new Date(day); t.setHours(h,m,0,0);
    return { id:`s${n++}`, startsAt:t.getTime(), endsAt:t.getTime()+SLOT_MINUTES*60000 };
  }));
}

export function createRoom(code, purpose, slots) {
  return {
    version: 2,
    code: cleanCode(code),
    purpose: String(purpose || 'Get everyone in the same room').trim().slice(0,120),
    createdAt: Date.now(), round: 1,
    slots: (slots || makeSlots()).slice(0,24),
    players: {}, marks: {}, backs: {},
    locked: false, winner: null, decidedBy: null, tiedWith: 0, lockedGap:0, lockedUnspent:0,
    firstBackAt: null, lockedAt: null,
    attendance: {}, notes: [], history: []
  };
}

export function ensurePlayer(room, id, name) {
  const pid = String(id).slice(0,80);
  const safeName = String(name || 'Guest').trim().slice(0,24) || 'Guest';
  if (!room.players[pid]) room.players[pid] = { name:safeName, budget:BUDGET, joinedAt:Date.now() };
  else room.players[pid].name = safeName;
  if (!room.marks[pid]) room.marks[pid] = {};
  return pid;
}

export function spentBy(room, pid) {
  let n=0;
  for (const sid of Object.keys(room.backs || {})) n += room.backs[sid]?.[pid] || 0;
  return n;
}

export function budgetLeft(room, pid) {
  return Math.max(0, (room.players[pid]?.budget ?? BUDGET) - spentBy(room,pid));
}

export function totalsOf(room) {
  return room.slots.map(slot => {
    let n=0; const map=room.backs[slot.id] || {};
    for (const pid of Object.keys(map)) n += map[pid] || 0;
    return { id:slot.id, n };
  });
}

export function availabilityOf(room) {
  const out={};
  for (const slot of room.slots) {
    let busy=0, maybe=0;
    for (const pid of Object.keys(room.players)) {
      const mark = room.marks[pid]?.[slot.id];
      if (mark === 'busy') busy++;
      if (mark === 'maybe') maybe++;
    }
    out[slot.id] = { busy, maybe, state:busy?'conflict':maybe?'maybe':'clean' };
  }
  return out;
}

export function totalUnspent(room) {
  return Object.keys(room.players).reduce((sum,pid)=>sum+budgetLeft(room,pid),0);
}

export function settle(room) {
  if (room.locked) return room;
  const ranked = totalsOf(room).sort((a,b)=>b.n-a.n);
  if (ranked.length < 2 || ranked[0].n === 0) return room;
  const unspent = totalUnspent(room);
  const gap = ranked[0].n - ranked[1].n;
  if (gap > unspent) {
    room.locked = true; room.winner = ranked[0].id; room.decidedBy='inevitable'; room.lockedAt=Date.now(); room.lockedGap=gap; room.lockedUnspent=unspent;
    return room;
  }
  if (unspent === 0) {
    const top = ranked[0].n;
    const tied = ranked.filter(x=>x.n===top).map(x=>x.id);
    if (tied.length > 1) {
      const av = availabilityOf(room);
      const byId = Object.fromEntries(room.slots.map(s=>[s.id,s]));
      tied.sort((a,b)=> av[a].busy-av[b].busy || av[a].maybe-av[b].maybe || byId[a].startsAt-byId[b].startsAt);
      room.locked=true; room.winner=tied[0]; room.decidedBy='tie'; room.tiedWith=tied.length; room.lockedAt=Date.now(); room.lockedGap=0; room.lockedUnspent=0;
    }
  }
  return room;
}

function slotExists(room, sid) { return room.slots.some(s=>s.id===sid); }

export function applyAction(room, pid, action, payload={}) {
  if (!room.players[pid]) return { ok:false, error:'Unknown participant.' };
  if (action === 'bulkMarks') {
    const incoming = payload && typeof payload.marks === 'object' ? payload.marks : {};
    room.marks[pid] = {};
    for (const [sid,value] of Object.entries(incoming)) {
      if (!slotExists(room,sid)) continue;
      if (value === 'busy' || value === 'maybe') room.marks[pid][sid] = value;
      if (value === 'busy' && room.backs[sid]) delete room.backs[sid][pid];
    }
    settle(room); return {ok:true};
  }
  if (action === 'mark') {
    const sid=String(payload.slotId||''); const value=payload.value;
    if (!slotExists(room,sid)) return {ok:false,error:'That time is not on the board.'};
    if (value === 'busy' || value === 'maybe') room.marks[pid][sid]=value;
    else delete room.marks[pid][sid];
    if (value === 'busy' && room.backs[sid]) delete room.backs[sid][pid];
    settle(room); return {ok:true};
  }
  if (action === 'back') {
    const sid=String(payload.slotId||'');
    if (room.locked) return {ok:false,error:'The decision is already locked.'};
    if (!slotExists(room,sid)) return {ok:false,error:'That time is not on the board.'};
    if (room.marks[pid]?.[sid] === 'busy') return {ok:false,error:'You marked this time as a conflict.'};
    if (budgetLeft(room,pid) < 1) return {ok:false,error:'You have no backing left.'};
    room.backs[sid] ||= {}; room.backs[sid][pid]=(room.backs[sid][pid]||0)+1;
    room.firstBackAt ||= Date.now(); settle(room); return {ok:true};
  }
  if (action === 'unback') {
    if (room.locked) return {ok:false,error:'The decision is already locked.'};
    for (const sid of Object.keys(room.backs)) delete room.backs[sid][pid];
    return {ok:true};
  }
  if (action === 'propose') {
    if (room.locked) return {ok:false,error:'Start the next round before proposing another time.'};
    const at=Number(payload.startsAt);
    if (!Number.isFinite(at) || at < Date.now()-3600000) return {ok:false,error:'Choose a future time.'};
    if (room.slots.length >= 24) return {ok:false,error:'This board already has 24 times.'};
    const id='p'+Math.random().toString(36).slice(2,9);
    room.slots.push({id,startsAt:at,endsAt:at+SLOT_MINUTES*60000,proposedBy:pid});
    room.slots.sort((a,b)=>a.startsAt-b.startsAt); return {ok:true};
  }
  if (action === 'note') {
    const text=String(payload.text||'').trim().slice(0,800);
    if (!text) return {ok:false,error:'Write a note first.'};
    room.notes.push({name:room.players[pid].name,text,at:Date.now()});
    if (room.notes.length > 100) room.notes=room.notes.slice(-100);
    return {ok:true};
  }
  if (action === 'attend') {
    if (!room.locked) return {ok:false,error:'Nothing is locked yet.'};
    const showed=payload.showed===true;
    room.attendance[pid]=showed?'showed':'noshow';
    const staked=room.backs[room.winner]?.[pid]||0;
    room.players[pid].budget=showed?BUDGET:Math.max(1,BUDGET-staked);
    return {ok:true};
  }
  if (action === 'next') {
    if (!room.locked) return {ok:false,error:'Lock a decision before starting the next round.'};
    room.history.push(makeRecord(room));
    room.history=room.history.slice(-30);
    room.round += 1;
    room.slots = makeSlots(payload.preset || 'next');
    room.backs={}; room.marks={}; room.attendance={}; room.notes=[];
    room.locked=false; room.winner=null; room.decidedBy=null; room.tiedWith=0; room.lockedGap=0; room.lockedUnspent=0; room.firstBackAt=null; room.lockedAt=null;
    for (const id of Object.keys(room.players)) room.marks[id]={};
    return {ok:true};
  }
  return {ok:false,error:'Unknown action.'};
}

export function makeRecord(room) {
  const slot=room.slots.find(s=>s.id===room.winner);
  const ranked=totalsOf(room).sort((a,b)=>b.n-a.n);
  const stakeMap=room.backs[room.winner]||{};
  const people=Object.keys(stakeMap).map(pid=>({name:room.players[pid]?.name||'Guest',backs:stakeMap[pid],attendance:room.attendance[pid]||'unmarked'})).sort((a,b)=>b.backs-a.backs);
  const mins=room.firstBackAt&&room.lockedAt?Math.max(1,Math.round((room.lockedAt-room.firstBackAt)/60000)):null;
  return {
    at:Date.now(), purpose:room.purpose, startsAt:slot?.startsAt||null,
    backed:ranked[0]?.n||0, runnerUp:ranked[1]?.n||0, settledIn:mins,
    decidedBy:room.decidedBy, people, notes:room.notes.map(n=>({...n}))
  };
}

export function seedDemo(code='DEMO42') {
  const room=createRoom(code,'Ship the launch before Friday without another scheduling thread',makeSlots('this'));
  const ids=['mara','dev','sam','iz']; const names=['Mara','Dev','Sam','Iz'];
  ids.forEach((id,i)=>ensurePlayer(room,id,names[i]));
  room.marks.dev[room.slots[2].id]='busy'; room.marks.sam[room.slots[5].id]='maybe'; room.marks.iz[room.slots[8].id]='busy';
  const add=(sid,pid,n)=>{room.backs[sid]||={};room.backs[sid][pid]=n;};
  add(room.slots[3].id,'mara',2); add(room.slots[3].id,'dev',2); add(room.slots[3].id,'sam',1);
  add(room.slots[7].id,'iz',2); add(room.slots[7].id,'sam',1); add(room.slots[9].id,'mara',1); add(room.slots[9].id,'dev',1);
  room.firstBackAt=Date.now()-8*60000;
  room.history=[{at:Date.now()-6*86400000,purpose:'Pick the pricing review',startsAt:Date.now()-5*86400000,backed:9,runnerUp:4,settledIn:11,decidedBy:'inevitable',people:[{name:'Mara',backs:3,attendance:'showed'},{name:'Dev',backs:3,attendance:'showed'},{name:'Iz',backs:2,attendance:'showed'},{name:'Sam',backs:1,attendance:'noshow'}],notes:[{name:'Mara',text:'Three pricing tiers. Dev owns the migration notes.'}]}];
  return room;
}
