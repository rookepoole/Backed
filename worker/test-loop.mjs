const API="https://whenyouavailable-room.aunysillyme.workers.dev";
const CODE="T"+Math.random().toString(36).slice(2,7).toUpperCase();
let pass=0,fail=0;
const ok=(c,m)=>{c?pass++:fail++;console.log((c?"  PASS  ":"  FAIL  ")+m)};
const P=(p,b)=>fetch(API+p,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(async r=>({s:r.status,j:await r.json()}));
const G=p=>fetch(API+p).then(r=>r.json());

const now=Date.now();
const slots=Array.from({length:12},(_,i)=>({id:"s"+i,label:"slot"+i,startsAt:now+i*9e6,endsAt:now+i*9e6+54e5}));

console.log("room",CODE);
// join three
const a=await P(`/room/${CODE}/join`,{name:"Ana",slots});
const b=await P(`/room/${CODE}/join`,{name:"Bo",slots});
const c=await P(`/room/${CODE}/join`,{name:"Cy",slots});
ok(a.j.playerId&&b.j.playerId&&c.j.playerId,"three people joined, each got an id");
ok(a.j.state.slots.length===12,"first through the door set the 12-slot board");
const A=a.j.playerId,B=b.j.playerId,C=c.j.playerId;

// second joiner cannot replace the board
const d=await P(`/room/${CODE}/join`,{name:"Dee",slots:[{id:"x",label:"x",startsAt:now,endsAt:now}]});
ok(d.j.state.slots.length===12&&d.j.state.slots[0].id==="s0","a later joiner cannot replace the board");
const D=d.j.playerId;

// availability
await P(`/room/${CODE}/avail`,{playerId:A,avail:{s0:"busy",s1:"maybe",s2:"nonsense"}});
let v=await G(`/room/${CODE}`);
ok(v.availability.s0.state==="conflict","one busy makes the slot the table's conflict");
ok(v.availability.s1.state==="maybe","one maybe softens the slot");
ok(v.avail[A].s2===undefined,"a junk availability value is dropped, not coerced");
ok(v.synced===1&&v.playerCount===4,"synced count tracks separately from player count");
ok(v.clean.includes("s3")&&!v.clean.includes("s0"),"clean list excludes the conflicted slot");

// cannot chip a slot you marked busy
let e=await P(`/room/${CODE}/chip`,{playerId:A,slotId:"s0"});
ok(e.s===400&&/busy/i.test(e.j.error),"refuses a chip on a slot you marked busy");

// chip budget
for(let i=0;i<5;i++) await P(`/room/${CODE}/chip`,{playerId:A,slotId:"s5"});
e=await P(`/room/${CODE}/chip`,{playerId:A,slotId:"s5"});
ok(e.s===400&&/hand is empty/i.test(e.j.error),"six chips from a five-chip hand is refused");
v=await G(`/room/${CODE}`);
ok(v.totals.find(t=>t.id==="s5").n===5,"exactly five landed");
ok(v.locked===false,"still open while others hold enough to catch it");

// marking a staked slot busy pulls your chips back off it
await P(`/room/${CODE}/chip`,{playerId:B,slotId:"s7"});
await P(`/room/${CODE}/avail`,{playerId:B,avail:{s7:"busy"}});
v=await G(`/room/${CODE}`);
ok(!(v.stakes.s7&&v.stakes.s7[B]),"marking a slot busy takes your chips off it");

// drive to the close
for(let i=0;i<5;i++) await P(`/room/${CODE}/chip`,{playerId:B,slotId:"s5"});
for(let i=0;i<5;i++) await P(`/room/${CODE}/chip`,{playerId:C,slotId:"s5"});
v=await G(`/room/${CODE}`);
// the rule: a board closes when the leader's margin exceeds every chip still
// in every hand. 4 players x 5 chips, so it fires at 11 v 0 with 9 unspent.
ok(v.locked===true&&v.winner==="s5","closes the instant the gap outruns every chip still in hand");
ok(v.gap>v.unspent,"closed with gap "+v.gap+" > unspent "+v.unspent+", so waiting could not change it");
const before=await G(`/room/${CODE}`);
ok(before.totals.find(t=>t.id==="s5").n===11,"the winning slot holds exactly the chips that landed before it closed");

// closed board refuses more
e=await P(`/room/${CODE}/chip`,{playerId:D,slotId:"s6"});
ok(e.s===400&&/closed/i.test(e.j.error),"a closed board refuses another chip");

// attendance
await P(`/room/${CODE}/attend`,{playerId:A,showed:true});
await P(`/room/${CODE}/attend`,{playerId:B,showed:false});
v=await G(`/room/${CODE}`);
ok(v.players[A].chips===5,"showing up returns the stake");
ok(v.players[B].chips===0,"a no-show burns all five");
await P(`/room/${CODE}/attend`,{playerId:B,showed:true});
v=await G(`/room/${CODE}`);
ok(v.players[B].chips===5,"re-marking flips the consequence, never compounds it");

// notes + the record
await P(`/room/${CODE}/note`,{playerId:A,text:"Ana owns the deck, due Friday."});
await P(`/room/${CODE}/note`,{playerId:C,text:"Cy books the room."});
e=await P(`/room/${CODE}/note`,{playerId:A,text:"   "});
ok(e.s===400,"an empty note is refused");
const nx=await P(`/room/${CODE}/next`,{playerId:A,slots});
v=nx.j;
ok(v.history.length===1,"wrapping up writes one record");
const h=v.history[0];
ok(h.label==="slot5"&&h.chipsFor===11,"the record carries the time called and what it won on");
ok(h.notes.length===2,"the record carries the notes people typed");
ok(h.summary===null||typeof h.summary==="string","summary is a string or an honest null, never undefined");
console.log("        summary:",h.summary?JSON.stringify(h.summary.slice(0,90))+"...":"(none - reported, not faked)");
ok(v.locked===false&&Object.keys(v.stakes).length===0,"a fresh board is dealt");
ok(v.players[A].chips===5&&v.players[B].chips===5,"chips carry across the round");
ok(v.synced===0,"everyone is unsynced again on the new board");

// identity
e=await P(`/room/${CODE}/chip`,{playerId:"pFAKE",slotId:"s1"});
ok(e.s===403,"an unknown player is refused");

// /ics was removed: it fetched a user-supplied URL server-side, which is an
// open fetch proxy on a public endpoint, and nothing needed it. Calendar files
// are parsed in the browser instead. Assert it is GONE, not that it behaves.
e=await P(`/ics`,{url:"https://example.com/"});
ok(e.s===404,"the /ics fetch proxy no longer exists");
e=await P(`/ics`,{url:"http://169.254.169.254/latest/meta-data/"});
ok(e.s===404,"and it cannot be pointed at an internal address either");

console.log("\n"+pass+"/"+(pass+fail)+" passed");
process.exit(fail?1:0);
