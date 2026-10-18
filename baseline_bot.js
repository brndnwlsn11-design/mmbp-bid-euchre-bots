'use strict';
// Imperfect-information Buck player. Input is Engine.viewFor(state, seat) only.
const E = require('./engine');
const I = E._internals;
const rank = c => c[0];
const suit = c => c[1];
const order = {9:0,T:1,J:2,Q:3,K:4,A:5};
const same = {S:'C',C:'S',H:'D',D:'H'};
const partner = s => (s+2)%4;
const team = s => s%2;
const four = hand => ['9','T','J','Q','K','A'].some(r=>hand.filter(c=>rank(c)===r).length===4);
function strength(card, mode, trump) {
  const r=rank(card), s=suit(card);
  if(mode==='trump') {
    if(r==='J'&&s===trump)return 13;
    if(r==='J'&&s===same[trump])return 12;
    if(s===trump)return 5+order[r];
    return order[r]*.8;
  }
  return mode==='low' ? 5-order[r] : order[r];
}
function estimate(hand, mode, trump) {
  let n=0;
  for(const c of hand) {
    const p=strength(c,mode,trump);
    if(mode==='trump')n += p>=12?1.05:p>=10?.86:p>=9?.67:p>=8?.45:p>=7?.27:p>=4?.19:p>=3?.12:.045;
    else n += p>=5?.80:p>=4?.55:p>=3?.29:p>=2?.12:.035;
  }
  if(mode==='trump') {
    const tr=hand.filter(c=>I.effectiveSuit(c,{mode,trump})===trump).length;
    n += Math.max(0,tr-2)*.19;
  }
  return n;
}
function optionsFor(hand) {
  const choices=['S','H','D','C'].map(s=>({mode:'trump',suit:s,value:estimate(hand,'trump',s)}));
  choices.push({mode:'high',value:estimate(hand,'high')},{mode:'low',value:estimate(hand,'low')});
  return choices.sort((a,b)=>b.value-a.value);
}
function choose(view, memory={}) {
  const acts=view.legal||[];
  if(!acts.length)return null;
  const hand=view.hand, phase=view.phase;
  if(phase==='bidding') {
    // A legitimate four-of-a-kind is declared before any bidding information is obtained.
    if(acts.some(a=>a.type==='misdeal') && view.bidding.bids.every(b=>b===null))return {type:'misdeal'};
    const best=optionsFor(hand)[0];
    const bids=acts.filter(a=>a.type==='bid');
    const required=view.bidding.highBid;
    const under=view.seat===view.dealer && required===0;
    let target=Math.max(3,Math.min(6,Math.floor(best.value+.95)));
    if(best.mode!=='trump')target=Math.max(4,target);
    if(best.value>5.15)target=6;
    const chosen=bids.find(a=>a.amount===target);
    if(chosen && (best.value>=2.2 || under))return chosen;
    if(under)return bids.find(a=>a.amount===3)||bids[0];
    return acts.find(a=>a.type==='pass') || bids[0];
  }
  if(phase==='declare') {
    const best=optionsFor(hand).find(o=>o.mode==='trump'||(view.contract.amount>=4&&view.contract.amount<=6));
    return acts.find(a=>a.mode===best.mode && (best.mode!=='trump'||a.suit===best.suit))||acts[0];
  }
  if(phase==='decline') {
    // Defenders get one point per trick; declining yields zero. Usually play.
    // Without information about partner's cards, play is the defensible default.
    return acts.find(a=>a.type==='play')||acts[0];
  }
  if(phase==='exchange') {
    const c=view.contract;
    const scored=acts.map(a=>({a,p:strength(a.card,c.mode,c.trump)})).sort((a,b)=>a.p-b.p);
    return view.seat===c.bidder?scored[0].a:scored[scored.length-1].a;
  }
  if(phase==='play') {
    const c=view.contract, trick=view.trick;
    const scored=acts.map(a=>({a,p:strength(a.card,c.mode,c.trump)}));
    if(!trick.plays.length) {
      // Lead winners while they're still likely to stand, based on public seen cards.
      const seen=new Set(memory.seen||[]);
      const suitRemaining = card => {
        const effective=I.effectiveSuit(card,c);
        const higher=I.makeDeck().filter(x=>I.effectiveSuit(x,c)===effective && I.power(x,c,{aceLowInLow:false})>I.power(card,c,{aceLowInLow:false}));
        return higher.filter(x=>!seen.has(x)&&!hand.includes(x)).length;
      };
      scored.sort((x,y)=> (suitRemaining(x.a.card)*-2+x.p*.2)-(suitRemaining(y.a.card)*-2+y.p*.2));
      return scored[scored.length-1].a;
    }
    const current=I.trickWinner(trick.plays,c,{aceLowInLow:false});
    const winningTeam=team(current);
    if(winningTeam===team(view.seat))return scored.sort((a,b)=>a.p-b.p)[0].a;
    const winners=scored.filter(x=>I.trickWinner([...trick.plays,{seat:view.seat,card:x.a.card}],c,{aceLowInLow:false})===view.seat);
    if(winners.length)return winners.sort((a,b)=>a.p-b.p)[0].a;
    return scored.sort((a,b)=>a.p-b.p)[0].a;
  }
  if(phase==='handOver')return acts.find(a=>a.type==='nextHand');
  return acts[0];
}
module.exports={choose,estimate,optionsFor};
