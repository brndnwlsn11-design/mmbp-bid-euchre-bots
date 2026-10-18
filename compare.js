'use strict';
const E=require('./engine'), V=require('./bot'), old=require('./bot_v15');
const oldMaster=require('./master_v15');
function rng(seed){let x=seed>>>0;return ()=>((x=Math.imul(x,1664525)+1013904223>>>0)/4294967296);}
function run(seed,newTeam){let state=E.newGame({dealer:seed%4},rng(seed));let memory={plays:[],voids:[[],[],[],[]]};let actions=0;
 while(state.phase!=='gameOver'&&actions<4000){let seat=state.phase==='exchange'?[state.contract.bidder,(state.contract.bidder+2)%4].find(i=>E.legalActions(state,i).some(a=>a.type==='give')):state.turn;if(seat==null)seat=0;
 const view=E.viewFor(state,seat);const a=seat%2===newTeam?V.choose(view,memory):(view.phase==='play'?oldMaster.choosePlay(view,memory):old.choose(view,memory));if(!a)throw Error('Missing action');
 const result=E.act(state,seat,a,rng(seed*71+actions));if(!result.ok)throw Error(result.error);
 if(a.type==='play'){if(state.trick?.plays.length){const led=E._internals.effectiveSuit(state.trick.plays[0].card,state.contract);if(E._internals.effectiveSuit(a.card,state.contract)!==led&&!memory.voids[seat].includes(led))memory.voids[seat].push(led);}memory.plays.push({seat,card:a.card});}
 if(result.state.handNumber!==state.handNumber||a.type==='misdeal')memory={plays:[],voids:[[],[],[],[]]};state=result.state;actions++;
 }if(actions>=4000)throw Error('Stall');return {winner:state.winner,actions};}
const pairs=Number(process.argv[2]||10),start=Date.now();let w=0,l=0,t=0,actions=0;
for(let i=0;i<pairs;i++){for(let team=0;team<2;team++){const r=run(90001+i,team);actions+=r.actions;if(r.winner===team)w++;else if(r.winner===null)t++;else l++;}console.log('pair',i+1,'v151',w,'v15',l,'elapsed',((Date.now()-start)/1000).toFixed(1)+'s');}
console.log(JSON.stringify({pairs,games:2*pairs,v151Wins:w,v15Wins:l,ties:t,actions,elapsedMs:Date.now()-start}));
