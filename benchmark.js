'use strict';
const E=require('./engine'), Master=require('./bot'), Baseline=require('./baseline_bot');
function rng(seed){let x=seed>>>0;return ()=>((x=Math.imul(x,1664525)+1013904223>>>0)/4294967296);}
function game(seed,masterTeam){let state=E.newGame({dealer:seed%4},rng(seed)),m={seen:[],plays:[],voids:[[],[],[],[]]},actions=0;
while(state.phase!=='gameOver'&&actions<4000){let seat=state.phase==='exchange'?[state.contract.bidder,(state.contract.bidder+2)%4].find(i=>E.legalActions(state,i).some(a=>a.type==='give')):state.turn;if(seat===null)seat=0;
const v=E.viewFor(state,seat),a=(seat%2===masterTeam?Master:Baseline).choose(v,m);if(!a)throw Error('Missing action '+state.phase);const result=E.act(state,seat,a,rng(seed*71+actions));if(!result.ok)throw Error(result.error);
if(a.type==='play'){if(state.trick && state.trick.plays.length){const led=E._internals.effectiveSuit(state.trick.plays[0].card,state.contract);if(E._internals.effectiveSuit(a.card,state.contract)!==led&&!m.voids[seat].includes(led))m.voids[seat].push(led);}m.plays.push({seat,card:a.card});m.seen.push(a.card);}
if(result.state.handNumber!==state.handNumber||a.type==='misdeal')m={seen:[],plays:[],voids:[[],[],[],[]]};state=result.state;actions++;}
if(actions>=4000)throw Error('Game stalled');return {winner:state.winner,scores:state.scores,actions};}
let win=0,loss=0,tie=0,actions=0;const N=Number(process.argv[2]||100),start=Date.now();for(let i=0;i<N;i++){const team=i%2, result=game(10001+Math.floor(i/2),team);actions+=result.actions;if(result.winner===team)win++;else if(result.winner===null)tie++;else loss++;}console.log(JSON.stringify({games:N,masterWins:win,baselineWins:loss,ties:tie,masterWinRate:win/N,actions,elapsedMs:Date.now()-start}));
