'use strict';
// Information-set search: the only private cards passed here are view.hand.
const E=require('./engine'), I=E._internals;
const deck=I.makeDeck(), side=s=>s%2, eff=I.effectiveSuit;
const opts={aceLowInLow:false};
const winner=(p,c)=>I.trickWinner(p,c,opts);
const pow=(x,c)=>I.power(x,c,opts);
const legal=(h,p,c)=>I.legalCards(h,p,c);
const rand=(n)=>Math.floor(Math.random()*n);
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){let j=rand(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function sample(view,memory={}){
 const c=view.contract,seat=view.seat,sit=view.sittingOut;
 const seen=new Set([...view.hand,...(memory.plays||[]).map(x=>x.card),...(view.trick?.plays||[]).map(x=>x.card)]);
 const unknown=deck.filter(x=>!seen.has(x));
 const sizes=view.handSizes.map((n,s)=>s===seat||s===sit?0:n);
 const discard=unknown.length-sizes.reduce((a,b)=>a+b,0);
 if(discard<0)throw Error('Inconsistent public card counts');
 const voids=(memory.voids||[[],[],[],[]]).map(a=>new Set(a));
 // A random discard slot accounts for the unused partner's cards in 12/24.
 const assignments=sizes.slice();if(discard)assignments.push(discard);
 const candidates=unknown.map(card=>{
  const v=[];for(let s=0;s<assignments.length;s++)if(s===4||s!==seat&&!voids[s].has(eff(card,c)))v.push(s);
  return {card,v};
 });
 for(let attempt=0;attempt<8;attempt++){
  const hands=[[],[],[],[]],remaining=assignments.slice();hands[seat]=view.hand.slice();
  const items=shuffle(candidates).sort((a,b)=>a.v.length-b.v.length);
  let nodes=0;
  function place(i){if(i===items.length)return true;if(++nodes>4500)return false;
   const {card,v}=items[i];const choices=shuffle(v.filter(s=>remaining[s]>0)).sort((a,b)=>remaining[b]-remaining[a]);
   for(const s of choices){remaining[s]--;if(s<4)hands[s].push(card);
    if(place(i+1))return true;
    if(s<4)hands[s].pop();remaining[s]++;
   }return false;
  }
  if(place(0))return hands;
 }
 // If exact inference is contradictory, refuse to invent an illegal hand silently.
 // The caller may use a lower-confidence rollout, but void constraints are never discarded.
 return null;
}
function apply(h,p,t,card,c,sit){
 const hands=h.map(a=>a.slice()),idx=hands[t].indexOf(card);if(idx<0)throw Error('Invalid simulation card');
 hands[t].splice(idx,1);const plays=p.concat([{seat:t,card}]);
 if(plays.length===(sit==null?4:3)){const w=winner(plays,c);return {h:hands,p:[],t:w,point:side(w)};}
 let next=(t+1)%4;if(next===sit)next=(next+1)%4;
 return {h:hands,p:plays,t:next,point:null};
}
function tactical(h,p,t,c,seen,style=0,counts=[0,0]){
 const cards=legal(h[t],p,c);if(cards.length===1)return cards[0];
 const own=side(t),current=p.length?side(winner(p,c)):null;
 const unplayed=new Set();for(let s=0;s<4;s++)for(const x of h[s])unplayed.add(x);
 let best=cards[0],bv=-Infinity;
 for(const card of cards){
  const es=eff(card,c),trump=c.mode==='trump'&&es===c.trump;
  const power=pow(card,c),rank=power===100?10:power===99?9:power;
  const after=p.concat([{seat:t,card}]);const win=winner(after,c)===t;
  const higher=[...unplayed].filter(x=>x!==card&&eff(x,c)===es&&pow(x,c)>power).length;
  const others=h[t].filter(x=>eff(x,c)===es).length;
  const remaining=h[t].length;
  const bidder=side(c.bidder),target=c.amount>=12?6:c.amount;
  const bidderNeeds=Math.max(0,target-counts[bidder]);
  const defenderNeeds=Math.max(0,7-target-counts[1-bidder]);
  const urgent=(own===bidder?bidderNeeds:defenderNeeds)>=remaining?1:0;
  let value;
  if(!p.length){
   value=2.4/(higher+1)+.16*others+(trump?-.12:0)+rank*.015;
   // Lead a high card when the contract is on the line, but preserve control otherwise.
   if(urgent)value+=higher===0?1.2:0;
   if(!urgent&&higher===0&&remaining>2)value-=.42;
   if(style===1)value+=higher===0?.8:0;
   if(style===2)value+=trump&&others>=3?.65:0;
  }else if(current===own){value=-rank*.17-(trump?.85:0)+(win?-2.8:0);}
  else if(win){value=2.6-rank*.09-(trump?.15:0)+(urgent?1.1:0);}
  else value=-rank*.12-(trump?.6:0);
  value+=Math.random()*.06;
  if(value>bv){bv=value;best=card;}
 }
 return best;
}
function utility(tricks,c,team){
 const bidder=side(c.bidder),target=c.amount>=12?6:c.amount;
 const made=tricks[bidder]>=target;
 const delta=[0,0];
 delta[bidder]=made?(c.amount>=12?c.amount:tricks[bidder]):-c.amount;
 const defender=1-bidder;delta[defender]=tricks[defender]>0?tricks[defender]:-c.amount;
 // Contract-sensitive, with a modest preference for more tricks even when outcome unchanged.
 return delta[team]-delta[1-team]+.12*(tricks[team]-tricks[1-team]);
}
function rollout(h,p,t,c,sit,counts,style){
 const seen=new Set(),tricks=counts.slice();let limit=28;
 while(limit--&&h.some((a,s)=>s!==sit&&a.length)){
  const card=tactical(h,p,t,c,seen,style,tricks),n=apply(h,p,t,card,c,sit);
  seen.add(card);h=n.h;p=n.p;t=n.t;if(n.point!==null)tricks[n.point]++;
 }
 return tricks;
}
// Double-dummy minimax, only on independently sampled plausible hands.
function solve(h,p,t,c,sit,team,depth,cache){
 if(depth===0)return 0;
 const key=t+'|'+p.map(x=>x.seat+x.card).join(',')+'|'+h.map(a=>a.slice().sort().join(',')).join('/');
 if(cache.has(key))return cache.get(key);
 let best=side(t)===team?-99:99;
 for(const card of legal(h[t],p,c)){
  const n=apply(h,p,t,card,c,sit);
  const v=(n.point===team?1:0)+solve(n.h,n.p,n.t,c,sit,team,depth-1,cache);
  if(side(t)===team){if(v>best)best=v;}else if(v<best)best=v;
 }
 cache.set(key,best);return best;
}
function choosePlay(view,memory={}){
 const actions=view.legal.filter(a=>a.type==='play');if(actions.length<=1)return actions[0];
 const c=view.contract,team=side(view.seat),sit=view.sittingOut;
 const n=view.hand.length,late=n<=2;
 // Bounded samples keep the free Node service responsive.
 const samples=late?65:n===3?80:n===4?100:150;
 const scores=actions.map(()=>0);let valid=0;
 for(let k=0;k<samples;k++){
  const h=sample(view,memory);
  if(!h)continue;
  valid++;
  for(let i=0;i<actions.length;i++){
   const step=apply(h,view.trick.plays,view.seat,actions[i].card,c,sit);
   let value;
   if(late){
    const rem=step.h.reduce((s,a)=>s+a.length,0);
    const tricks=view.tricksWon.slice();if(step.point!==null)tricks[step.point]++;
    const extra=solve(step.h,step.p,step.t,c,sit,team,rem,new Map());
    tricks[team]+=extra;tricks[1-team]+=Math.max(0,6-tricks[0]-tricks[1]-extra);
    value=utility(tricks,c,team);
   }else{
    const counts=view.tricksWon.slice();if(step.point!==null)counts[step.point]++;
    const final=rollout(step.h,step.p,step.t,c,sit,counts,k%3);
    value=utility(final,c,team);
   }
   scores[i]+=value;
  }
 }
 if(!valid)return actions.reduce((a,b)=>pow(a.card,c)<pow(b.card,c)?a:b);
 let best=0,bv=-Infinity;
 for(let i=0;i<actions.length;i++){
  const v=scores[i]/Math.max(1,valid) + .00001*(100-pow(actions[i].card,c));
  if(v>bv){best=i;bv=v;}
 }
 return actions[best];
}
module.exports={choosePlay,sample,tactical,solve,utility};
