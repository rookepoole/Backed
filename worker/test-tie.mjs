const API="https://whenyouavailable-room.aunysillyme.workers.dev";
const CODE="TIE"+Math.random().toString(36).slice(2,6).toUpperCase();
const P=(p,b)=>fetch(API+p,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(async r=>({s:r.status,j:await r.json()}));
const G=p=>fetch(API+p).then(r=>r.json());
const now=Date.now();
const slots=Array.from({length:4},(_,i)=>({id:"s"+i,label:"slot"+i,startsAt:now+i*9e6,endsAt:now+i*9e6+54e5}));
const a=(await P(`/room/${CODE}/join`,{name:"Ana",slots})).j.playerId;
const b=(await P(`/room/${CODE}/join`,{name:"Bo",slots})).j.playerId;
// Ana puts all 5 on s0, Bo puts all 5 on s1. Perfect tie, zero chips left.
for(let i=0;i<5;i++) await P(`/room/${CODE}/chip`,{playerId:a,slotId:"s0"});
for(let i=0;i<5;i++) await P(`/room/${CODE}/chip`,{playerId:b,slotId:"s1"});
const v=await G(`/room/${CODE}`);
console.log("totals :", v.totals.map(t=>t.id+"="+t.n).join(" "));
console.log("unspent:", v.unspent, " gap:", v.gap);
console.log("locked :", v.locked, " winner:", v.winner);
console.log(v.locked ? "\nRESOLVED" : "\nDEADLOCK - every chip spent, dead tie, board never closes and nobody can move it");
