import {
  BUDGET, cleanCode, randomCode, makeSlots, createRoom, ensurePlayer,
  applyAction, totalsOf, availabilityOf, totalUnspent, budgetLeft,
  spentBy, seedDemo
} from './core.mjs';

const $ = (id) => document.getElementById(id);
const HOST_PREFIX = 'backed-room-';
const HOST_KEY = (code) => `backed:host:${code}`;
const ROOM_KEY = (code) => `backed:room:${code}`;
const NAME_KEY = 'backed:name';
const GUEST_KEY = 'backed:guest';
const COLORS = ['#ff5c35','#141414','#2f8d68','#8657d6','#c27a00','#3b77c3','#9a4355','#53706b'];

let room = null;
let playerId = null;
let code = null;
let preset = 'this';
let mode = 'idle'; // host | guest | demo
let peer = null;
let hostConn = null;
let peerConns = new Set();
let toastTimer = null;

const initialCode = cleanCode(new URLSearchParams(location.search).get('room') || '');
const guestId = getGuestId();

function getGuestId() {
  let id = localStorage.getItem(GUEST_KEY);
  if (!id) {
    const bytes = new Uint8Array(10); crypto.getRandomValues(bytes);
    id = 'g_' + Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem(GUEST_KEY,id);
  }
  return id;
}

function hostPeerId(roomCode) { return HOST_PREFIX + roomCode.toLowerCase(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function colorFor(id='') { let h=0; for (let i=0;i<id.length;i++) h=((h<<5)-h)+id.charCodeAt(i); return COLORS[Math.abs(h)%COLORS.length]; }
function fmtTime(ms) { return new Date(ms).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); }
function fmtDate(ms) { return new Date(ms).toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'}); }
function fmtLong(ms) { return new Date(ms).toLocaleString([], {weekday:'long', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}); }

function toast(message, kind='ok') {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').className = 'toast show' + (kind==='error'?' error':'');
  toastTimer = setTimeout(()=>$('toast').className='toast', 2600);
}

function setNetwork(label, state='waiting') {
  $('netText').textContent = label;
  $('netDot').className = state==='live'?'live':state==='dead'?'dead':'';
}

function setupLanding() {
  $('nameInput').value = localStorage.getItem(NAME_KEY) || '';
  const isOwner = initialCode && localStorage.getItem(HOST_KEY(initialCode)) === guestId;
  if (initialCode) {
    $('landingCode').textContent = initialCode;
    $('purposeField').classList.add('hidden');
    $('presetField').classList.add('hidden');
    $('launchMode').textContent = isOwner ? 'RESUME YOUR ROOM' : 'JOIN A ROOM';
    $('primaryBtn').innerHTML = isOwner ? 'RESUME P2P ROOM <span>↗</span>' : 'JOIN P2P ROOM <span>↗</span>';
    $('launchStatus').textContent = isOwner ? 'This browser owns the saved room state.' : 'You’ll connect directly to the room host over WebRTC.';
  } else {
    const next = randomCode();
    $('landingCode').textContent = next;
    $('launchMode').textContent = 'CREATE A ROOM';
  }
}

function persistHost() {
  if (mode !== 'host' || !room) return;
  try { localStorage.setItem(ROOM_KEY(room.code), JSON.stringify(room)); } catch {}
}

function loadHostRoom(roomCode) {
  try {
    const raw = localStorage.getItem(ROOM_KEY(roomCode));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function showRoom() {
  $('landing').classList.add('hidden');
  $('roomScreen').classList.remove('hidden');
  window.scrollTo({top:0,behavior:'instant'});
  render();
}

function createOrJoin() {
  const name = $('nameInput').value.trim().slice(0,24);
  if (!name) { $('launchStatus').textContent='Give the room a name to put beside your backing.'; $('nameInput').focus(); return; }
  localStorage.setItem(NAME_KEY,name);

  if (initialCode) {
    const owner = localStorage.getItem(HOST_KEY(initialCode)) === guestId;
    if (owner) resumeHost(initialCode,name);
    else joinGuest(initialCode,name);
    return;
  }

  const purpose = $('purposeInput').value.trim();
  if (!purpose) { $('launchStatus').textContent='Name the thing the group is actually trying to get done.'; $('purposeInput').focus(); return; }
  const newCode = cleanCode($('landingCode').textContent) || randomCode();
  startNewHost(newCode,name,purpose);
}

function startNewHost(roomCode,name,purpose) {
  code=roomCode; mode='host'; playerId=guestId;
  room=createRoom(code,purpose,makeSlots(preset));
  ensurePlayer(room,playerId,name);
  localStorage.setItem(HOST_KEY(code),guestId);
  persistHost();
  history.replaceState({},'',`${location.pathname}?room=${encodeURIComponent(code)}`);
  showRoom();
  startHostPeer();
}

function resumeHost(roomCode,name) {
  code=roomCode; mode='host'; playerId=guestId;
  room=loadHostRoom(code);
  if (!room) {
    $('launchStatus').textContent='The saved room state is missing in this browser. Create a fresh room instead.';
    return;
  }
  ensurePlayer(room,playerId,name); persistHost(); showRoom(); startHostPeer();
}

function startHostPeer() {
  if (!window.Peer) { setNetwork('P2P LIBRARY MISSING','dead'); toast('PeerJS could not load. The host board still works locally.','error'); return; }
  setNetwork('OPENING P2P','waiting');
  try { peer = new Peer(hostPeerId(code), {debug:0}); }
  catch (e) { setNetwork('LOCAL ONLY','dead'); toast('Could not start WebRTC signaling.','error'); return; }
  peer.on('open', ()=>{ setNetwork('P2P HOST LIVE','live'); broadcastState(); });
  peer.on('connection', conn => wireIncoming(conn));
  peer.on('disconnected', ()=>setNetwork('SIGNALING LOST','dead'));
  peer.on('close', ()=>setNetwork('HOST CLOSED','dead'));
  peer.on('error', err => {
    if (err?.type === 'unavailable-id') {
      setNetwork('CODE IN USE','dead'); toast('That room code is already live. Make a new room code.','error');
    } else {
      setNetwork('P2P DEGRADED','dead'); toast(`WebRTC: ${err?.type || 'connection error'}`,'error');
    }
  });
}

function wireIncoming(conn) {
  peerConns.add(conn);
  conn.on('data', msg => handlePeerMessage(conn,msg));
  conn.on('close', ()=>peerConns.delete(conn));
  conn.on('error', ()=>peerConns.delete(conn));
}

function handlePeerMessage(conn,msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'join') {
    const pid = ensurePlayer(room, String(msg.guestId||'').slice(0,80), msg.name);
    conn._backedPid = pid;
    room.players[pid].lastSeen=Date.now();
    persistHost();
    sendState(conn,pid);
    broadcastState();
    render();
    return;
  }
  if (msg.type === 'action') {
    const pid = conn._backedPid;
    if (!pid || !room.players[pid]) { conn.send({type:'error',message:'Join the room before acting.'}); return; }
    const result=applyAction(room,pid,msg.action,msg.payload||{});
    if (!result.ok) { conn.send({type:'error',message:result.error}); return; }
    room.players[pid].lastSeen=Date.now();
    persistHost(); broadcastState(); render();
  }
}

function sendState(conn,pid=conn._backedPid) {
  if (!conn?.open) return;
  try { conn.send({type:'state',state:clone(room),playerId:pid}); } catch {}
}
function broadcastState() { for (const conn of peerConns) sendState(conn); }

function joinGuest(roomCode,name) {
  code=roomCode; mode='guest'; room=null; playerId=null;
  showRoom(); setNetwork('FINDING HOST','waiting');
  $('roomPurpose').textContent='Connecting to the room host…';
  if (!window.Peer) { setNetwork('P2P LIBRARY MISSING','dead'); toast('PeerJS could not load.','error'); return; }
  peer = new Peer();
  peer.on('open', ()=>{
    hostConn=peer.connect(hostPeerId(code), {reliable:true});
    hostConn.on('open', ()=>{
      setNetwork('P2P CONNECTED','live');
      hostConn.send({type:'join',guestId,name});
    });
    hostConn.on('data', msg=>{
      if (msg?.type === 'state') { room=msg.state; playerId=msg.playerId; render(); }
      if (msg?.type === 'error') toast(msg.message,'error');
    });
    hostConn.on('close', ()=>{ setNetwork('HOST LEFT','dead'); toast('The host browser left the room.','error'); });
    hostConn.on('error', ()=>{ setNetwork('P2P ERROR','dead'); toast('Could not connect to the room host.','error'); });
  });
  peer.on('error', err=>{
    if (err?.type === 'peer-unavailable') { setNetwork('HOST NOT FOUND','dead'); toast('No live host owns this room code right now.','error'); }
    else { setNetwork('P2P ERROR','dead'); toast(`WebRTC: ${err?.type || 'connection error'}`,'error'); }
  });
}

function openDemo() {
  code='DEMO42'; mode='demo'; playerId='you'; room=seedDemo(code); ensurePlayer(room,playerId,$('nameInput').value.trim()||'You');
  setNetwork('DEMO / LOCAL','live'); showRoom();
  toast('Demo loaded with four participants already in motion.');
}

function dispatch(action,payload={}) {
  if (!room || !playerId) return toast('Still connecting to the room.','error');
  if (mode === 'guest') {
    if (!hostConn?.open) return toast('The host connection is not open.','error');
    hostConn.send({type:'action',action,payload});
    return;
  }
  const result=applyAction(room,playerId,action,payload);
  if (!result.ok) return toast(result.error,'error');
  if (mode === 'host') { persistHost(); broadcastState(); }
  render();
}

function sortedTotals() { return room ? totalsOf(room).slice().sort((a,b)=>b.n-a.n) : []; }

function render() {
  if (!room) {
    $('roomCode').textContent=code||'------';
    return;
  }
  $('roomCode').textContent=room.code;
  $('roomPurpose').textContent=room.purpose;
  $('roundNo').textContent=room.round || 1;

  const players=Object.keys(room.players);
  const ranked=sortedTotals();
  const leader=ranked[0]?.n||0;
  const runner=ranked[1]?.n||0;
  $('peopleMetric').textContent=players.length;
  $('participantCount').textContent=players.length;
  $('leaderMetric').textContent=leader;
  $('gapMetric').textContent=Math.max(0,leader-runner);
  $('unspentMetric').textContent=totalUnspent(room);

  renderBudget(); renderParticipants(); renderSlots(); renderDecision(); renderNotes(); renderHistory();
}

function renderBudget() {
  const total=room.players[playerId]?.budget ?? BUDGET;
  const attendanceMarked=Boolean(room.locked && room.attendance[playerId]);
  const left=attendanceMarked ? total : budgetLeft(room,playerId);
  $('budgetLabel').textContent=attendanceMarked?'NEXT ROUND BUDGET':'YOUR BACKING';
  $('budgetText').textContent=`${left} / ${total}`;
  $('budgetTokens').innerHTML='';
  for (let i=0;i<BUDGET;i++) {
    const d=document.createElement('div'); d.className='budget-token'+(i>=left?' spent':''); $('budgetTokens').appendChild(d);
  }
}

function renderParticipants() {
  const entries=Object.entries(room.players).sort((a,b)=>(a[1].joinedAt||0)-(b[1].joinedAt||0));
  $('participants').innerHTML=entries.map(([pid,p])=>{
    const left=budgetLeft(room,pid); const mine=pid===playerId?' · YOU':'';
    return `<div class="person"><div class="person-name"><i class="avatar" style="background:${colorFor(pid)}"></i>${escapeHtml(p.name)}${mine}</div><small>${left}/${p.budget ?? BUDGET} LEFT</small></div>`;
  }).join('');
}

function renderSlots() {
  const av=availabilityOf(room); const totals=Object.fromEntries(totalsOf(room).map(x=>[x.id,x.n]));
  const ranked=sortedTotals(); const leaderId=(ranked[0]?.n||0)>0?ranked[0].id:null;
  $('slotGrid').innerHTML='';
  for (const slot of room.slots) {
    const state=av[slot.id]?.state||'clean';
    const mine=room.backs[slot.id]?.[playerId]||0;
    const myMark=room.marks[playerId]?.[slot.id]||'clear';
    const card=document.createElement('article');
    card.className=`slot ${state}${leaderId===slot.id?' leader':''}`;
    const proposed=slot.proposedBy?` · proposed by ${escapeHtml(room.players[slot.proposedBy]?.name||'guest')}`:'';
    card.innerHTML=`
      <div class="slot-top"><span class="slot-date">${fmtDate(slot.startsAt)}${proposed}</span><span class="slot-state ${state}">${state==='conflict'?'conflict':state}</span></div>
      <div class="slot-time">${fmtTime(slot.startsAt)}</div>
      <div class="slot-score"><b>${totals[slot.id]||0}</b> BACKED${mine?` <span class="mine">YOU ×${mine}</span>`:''}</div>
      <div class="slot-actions">
        <button class="back-btn" type="button" ${room.locked||myMark==='busy'||budgetLeft(room,playerId)<1?'disabled':''}>+1 BACK THIS TIME</button>
        <select class="mark-select" aria-label="My availability for ${fmtLong(slot.startsAt)}">
          <option value="clear" ${myMark==='clear'?'selected':''}>CLEAR</option>
          <option value="maybe" ${myMark==='maybe'?'selected':''}>MAYBE</option>
          <option value="busy" ${myMark==='busy'?'selected':''}>BUSY</option>
        </select>
      </div>`;
    card.querySelector('.back-btn').addEventListener('click',()=>dispatch('back',{slotId:slot.id}));
    card.querySelector('.mark-select').addEventListener('change',e=>dispatch('mark',{slotId:slot.id,value:e.target.value}));
    $('slotGrid').appendChild(card);
  }
}

function renderDecision() {
  if (!room.locked) {
    $('decisionBanner').classList.add('hidden'); $('nextRoundBtn').classList.add('hidden'); return;
  }
  const slot=room.slots.find(s=>s.id===room.winner); const ranked=sortedTotals();
  $('decisionBanner').classList.remove('hidden'); $('nextRoundBtn').classList.remove('hidden');
  $('decisionTime').textContent=slot?fmtLong(slot.startsAt):'Time locked';
  if (room.decidedBy==='tie') $('decisionReason').textContent=`All backing was spent in a tie. The room broke it using fewer conflicts, then the earlier time.`;
  else $('decisionReason').textContent=`Locked at ${ranked[0]?.n||0} vs ${ranked[1]?.n||0}. The ${room.lockedGap ?? Math.max(0,(ranked[0]?.n||0)-(ranked[1]?.n||0))}-point gap was larger than the ${room.lockedUnspent ?? totalUnspent(room)} backing still unspent, so no remaining move could change the winner.`;
  const mine=room.attendance[playerId];
  $('showedBtn').textContent=mine==='showed'?'✓ I SHOWED UP':'I SHOWED UP';
  $('missedBtn').textContent=mine==='noshow'?'✓ I MISSED IT':'I MISSED IT';
}

function renderNotes() {
  $('notesList').innerHTML=room.notes.length?room.notes.map(n=>`<div class="note-item"><b>${escapeHtml(n.name)}</b><p>${escapeHtml(n.text)}</p></div>`).join(''):'<div class="empty">No notes yet. Capture the decision, owner, or next step.</div>';
}

function renderHistory() {
  const list=(room.history||[]).slice().reverse();
  $('historyList').innerHTML=list.length?list.map(h=>{
    const when=h.startsAt?fmtLong(h.startsAt):'Unknown time';
    const attendance=(h.people||[]).filter(p=>p.attendance==='showed').length;
    return `<div class="history-item"><div class="history-time">${escapeHtml(when)}</div><div class="history-fact">${h.backed||0} backed · ${h.runnerUp||0} runner-up · ${h.settledIn||'—'} min to lock · ${attendance}/${(h.people||[]).length} showed</div></div>`;
  }).join(''):'<div class="empty">This room has no completed locks yet.</div>';
}

async function copyInvite() {
  const url=`${location.origin}${location.pathname}?room=${encodeURIComponent(room?.code||code)}`;
  try { await navigator.clipboard.writeText(url); toast('Invite copied. The host browser needs to stay open.'); }
  catch { const ta=document.createElement('textarea');ta.value=url;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('Invite copied.'); }
}

async function importIcs(file) {
  if (!file || !room) return;
  try {
    const text=await file.text();
    const starts=room.slots.map(s=>s.startsAt); const ends=room.slots.map(s=>s.endsAt);
    const from=Math.min(...starts)-86400000, to=Math.max(...ends)+86400000;
    const windows=window.ICS.parse(text,from,to); const marks=window.ICS.applyTo(room.slots,windows);
    dispatch('bulkMarks',{marks});
    const count=Object.keys(marks).length;
    $('calendarStatus').textContent=`${count} candidate time${count===1?'':'s'} flagged from ${file.name}. Event details stayed local.`;
  } catch (e) {
    $('calendarStatus').textContent='Could not read that calendar file.'; toast('Calendar import failed.','error');
  }
}

// Landing interactions
$('primaryBtn').addEventListener('click',createOrJoin);
$('demoBtn').addEventListener('click',openDemo);
$('presetButtons').addEventListener('click',e=>{
  const btn=e.target.closest('[data-preset]'); if(!btn)return; preset=btn.dataset.preset;
  [...$('presetButtons').children].forEach(x=>x.classList.toggle('active',x===btn));
});
$('homeBtn').addEventListener('click',()=>{ location.href=location.pathname; });
$('shareBtn').addEventListener('click',copyInvite);
$('unbackBtn').addEventListener('click',()=>dispatch('unback'));
$('customBtn').addEventListener('click',()=>{
  const value=$('customAt').value; if(!value)return toast('Choose a date and time first.','error');
  dispatch('propose',{startsAt:new Date(value).getTime()}); $('customAt').value='';
});
$('showedBtn').addEventListener('click',()=>dispatch('attend',{showed:true}));
$('missedBtn').addEventListener('click',()=>dispatch('attend',{showed:false}));
$('addNoteBtn').addEventListener('click',()=>{ const text=$('notesInput').value.trim(); if(!text)return toast('Write a note first.','error'); dispatch('note',{text}); $('notesInput').value=''; });
$('nextRoundBtn').addEventListener('click',()=>dispatch('next',{preset:'next'}));
$('icsBtn').addEventListener('click',()=>$('icsInput').click());
$('icsInput').addEventListener('change',e=>{ const f=e.target.files?.[0]; if(f)importIcs(f); e.target.value=''; });

setupLanding();
