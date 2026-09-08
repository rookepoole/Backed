import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUDGET, createRoom, ensurePlayer, makeSlots, applyAction,
  budgetLeft, totalsOf, availabilityOf, totalUnspent
} from '../src/core.mjs';

function roomWith(names=['Ana','Bo','Cy']) {
  const r=createRoom('TEST42','Pick a real meeting time',makeSlots('this',new Date('2026-09-07T12:00:00')));
  names.forEach((name,i)=>ensurePlayer(r,'p'+i,name));
  return r;
}

test('busy marks block backing and aggregate to a room conflict',()=>{
  const r=roomWith(); const sid=r.slots[0].id;
  assert.equal(applyAction(r,'p0','mark',{slotId:sid,value:'busy'}).ok,true);
  assert.equal(availabilityOf(r)[sid].state,'conflict');
  const result=applyAction(r,'p0','back',{slotId:sid});
  assert.equal(result.ok,false);
  assert.match(result.error,/conflict/i);
});

test('each participant has a scarce five-unit backing budget',()=>{
  const r=roomWith(); const sid=r.slots[1].id;
  for(let i=0;i<BUDGET;i++) assert.equal(applyAction(r,'p0','back',{slotId:sid}).ok,true);
  assert.equal(budgetLeft(r,'p0'),0);
  assert.equal(applyAction(r,'p0','back',{slotId:sid}).ok,false);
  assert.equal(totalsOf(r).find(x=>x.id===sid).n,5);
});

test('board locks the instant the leader is mathematically uncatchable',()=>{
  const r=roomWith(['Ana','Bo','Cy','Dee']); const winner=r.slots[2].id;
  // 4 players x 5 = 20. At 10, gap===unspent, so one more move can still matter.
  for(let i=0;i<5;i++) applyAction(r,'p0','back',{slotId:winner});
  for(let i=0;i<5;i++) applyAction(r,'p1','back',{slotId:winner});
  assert.equal(r.locked,false);
  applyAction(r,'p2','back',{slotId:winner});
  assert.equal(r.locked,true);
  assert.equal(r.winner,winner);
  assert.equal(r.decidedBy,'inevitable');
  assert.ok(11 > totalUnspent(r));
});

test('a fully spent tie resolves by conflict load then earliest time',()=>{
  const r=roomWith(['Ana','Bo']);
  const a=r.slots[0].id, b=r.slots[1].id;
  // make the earlier option slightly worse on availability so b should win.
  applyAction(r,'p0','mark',{slotId:a,value:'maybe'});
  for(let i=0;i<5;i++) applyAction(r,'p0','back',{slotId:a});
  for(let i=0;i<5;i++) applyAction(r,'p1','back',{slotId:b});
  assert.equal(r.locked,true);
  assert.equal(r.decidedBy,'tie');
  assert.equal(r.winner,b);
});

test('marking a staked time busy automatically retracts that backing',()=>{
  const r=roomWith(); const sid=r.slots[3].id;
  applyAction(r,'p0','back',{slotId:sid});
  applyAction(r,'p0','back',{slotId:sid});
  assert.equal(budgetLeft(r,'p0'),3);
  applyAction(r,'p0','mark',{slotId:sid,value:'busy'});
  assert.equal(budgetLeft(r,'p0'),5);
});
