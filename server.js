'use strict';

/*
 * Bid Euchre server.
 *
 * Serves the game page and keeps every table's game state. Players' browsers
 * talk to it in two ways:
 *   - they OPEN a live stream (GET /api/events) and the server pushes the
 *     latest table state down it whenever anything changes;
 *   - they SEND moves (POST /api/action) which the server checks against the
 *     rules engine before applying.
 *
 * Each player only ever receives their OWN cards. The server holds everyone's
 * hands but never sends them to anyone else.
 *
 * No outside packages needed: `node server.js` is all it takes.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Engine = require('./engine.js');
const Bot = require('./bot.js');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'rooms.json');
const INDEX_FILE = path.join(__dirname, 'index.html');
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I or L: easy to read out loud
const MAX_ROOMS = 300;
const ROOM_TTL_MS = 3 * 24 * 60 * 60 * 1000; // forget tables idle for 3 days

// room = { code, seats: [ {name, token} | null ] x4, game, lastActive, clients:Set }
const rooms = new Map();
const botTimers = new Map();
function isBot(room, seat) { return !!(room.seats[seat] && room.seats[seat].bot); }
function updateBotMemory(room, oldGame, seat, action, newGame) {
  if (!newGame || !oldGame || oldGame.handNumber !== newGame.handNumber || action.type === 'misdeal' || action.type === 'newGame') { room.botMemory={seen:[],plays:[],voids:[[],[],[],[]]}; return; }
  // A defender's 'play' in the decline phase means 'defend', not a card play.
  if(action.type!=='play' || oldGame.phase!=='play' || !action.card || !oldGame.trick || !Array.isArray(oldGame.trick.plays))return;
  if(!room.botMemory)room.botMemory={seen:[],plays:[],voids:[[],[],[],[]]};
  const m=room.botMemory, led=oldGame.trick.plays[0];
  if(led){const suit=Engine._internals.effectiveSuit(led.card,oldGame.contract);
    if(Engine._internals.effectiveSuit(action.card,oldGame.contract)!==suit && !m.voids[seat].includes(suit))m.voids[seat].push(suit);
  }
  m.plays.push({seat,card:action.card});
  if(!m.seen.includes(action.card))m.seen.push(action.card);
}
function scheduleBots(room) {
  if (!room.game || botTimers.has(room.code)) return;
  const game = room.game;
  let next = -1;
  if (game.phase === 'exchange') {
    next = [game.contract.bidder, (game.contract.bidder+2)%4].find(i => isBot(room,i) && Engine.legalActions(game,i).some(a => a.type === 'give')) ?? -1;
  } else if (game.phase === 'handOver') {
    // Humans control advancing to the next hand whenever one is present.
    if (room.seats.every(s => s && s.bot)) next = room.seats.findIndex(s => s && s.bot);
  } else next = game.turn;
  if (next < 0 || !isBot(room,next)) return;
  const timer = setTimeout(() => {
    botTimers.delete(room.code);
    if (!room.game || !isBot(room,next)) return;
    try {
      const view = Engine.viewFor(room.game,next);
      const action = Bot.choose(view,room.botMemory || {seen:[]});
      if (!action) { console.error('Bot returned no action', {room:room.code, phase:room.game.phase, seat:next}); return; }
      const result = Engine.act(room.game,next,action);
      if (result.ok) { updateBotMemory(room,room.game,next,action,result.state); room.game=result.state; broadcast(room); }
      else console.error('Bot action rejected:',result.error,action);
    } catch (error) {
      console.error('Bot turn failed', {room:room.code, phase:room.game && room.game.phase, seat:next}, error);
      // Do not kill the Node process and disconnect every player.
    }
  }, 450+Math.floor(Math.random()*350));
  botTimers.set(room.code,timer);
}

const PIECES = ['hat','car','dog','thimble','iron','boot','ship','wheelbarrow'];
const COLORS = ['red','blue','green','gold','purple','silver'];
const EMOTES = ['Uff da.','Sure.','Interesting.','Good for you.',"That's different.",'Would ya look at that.',"Let's take a look.","I'm not looking good."];
function profile(body) {
  return { piece: PIECES.includes(body.piece) ? body.piece : 'hat', color: COLORS.includes(body.color) ? body.color : 'gold' };
}
function publicSeat(s, room, i) {
  return s ? { name: s.name, connected: !!s.bot || isConnected(room, i), bot: !!s.bot, piece: s.piece || 'hat', color: s.color || 'gold' } : null;
}


/* ---------- saving (best effort) so a restart does not wipe games ---------- */

function loadRooms() {
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const r of list) rooms.set(r.code, { ...r, clients: new Set() });
    console.log('Loaded ' + rooms.size + ' saved table(s).');
  } catch (e) {
    /* nothing saved yet: fine */
  }
}

let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const list = [...rooms.values()].map(({ clients, ...rest }) => rest);
      fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(list));
      fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
    } catch (e) {
      console.error('Could not save tables:', e.message);
    }
  }, 1000);
}

/* ---------- helpers ---------- */

function newCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('No table codes left');
}

const newToken = () => crypto.randomBytes(16).toString('hex');
const isConnected = (room, seat) => [...room.clients].some((c) => c.seat === seat);

function publicInfo(room) {
  return {
    exists: true,
    code: room.code,
    started: !!room.game,
    seats: room.seats.map((s, i) => publicSeat(s, room, i)),
  };
}

function snapshot(room, seat) {
  return {
    code: room.code,
    started: !!room.game,
    you: seat,
    seats: room.seats.map((s, i) => publicSeat(s, room, i)),
    game: room.game ? Engine.viewFor(room.game, seat) : null,
    emote: room.emote && room.emote.until > Date.now() ? room.emote : null,
    host: room.hostSeat === seat,
  };
}

function sendTo(client, room) {
  try {
    client.res.write('data: ' + JSON.stringify(snapshot(room, client.seat)) + '\n\n');
  } catch (e) {
    /* connection is gone; its close handler will clean up */
  }
}

function broadcast(room) {
  room.lastActive = Date.now();
  if (room.game && room.game.lastTrick) {
    if (!room.botMemory) room.botMemory = {seen:[],plays:[],voids:[[],[],[],[]]};
    for (const play of room.game.lastTrick.plays) {
      if (!room.botMemory.seen.includes(play.card)) room.botMemory.seen.push(play.card);
    }
  }
  for (const client of room.clients) sendTo(client, room);
  saveSoon();
  scheduleBots(room);
}

function seatForToken(room, token) {
  if (!token) return -1;
  return room.seats.findIndex((s) => s && s.token === token);
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 20000) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Bad request'));
      }
    });
    req.on('error', reject);
  });
}

function cleanName(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16);
}

/* ---------- routes ---------- */

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(INDEX_FILE));
  }
  if (req.method === 'GET' && p === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  // Public info about a table (used by people who have not sat down yet)
  if (req.method === 'GET' && p === '/api/room') {
    const room = rooms.get((url.searchParams.get('code') || '').toUpperCase());
    return json(res, 200, room ? publicInfo(room) : { exists: false });
  }

  // Live stream of table state for one seated player
  if (req.method === 'GET' && p === '/api/events') {
    const room = rooms.get((url.searchParams.get('code') || '').toUpperCase());
    if (!room) return json(res, 404, { error: 'No such table.' });
    const seat = seatForToken(room, url.searchParams.get('token'));
    if (seat < 0) return json(res, 403, { error: 'You are not seated at this table.' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const client = { res, seat };
    room.clients.add(client);
    const keepAlive = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch (e) {
        /* closed */
      }
    }, 20000);
    req.on('close', () => {
      clearInterval(keepAlive);
      room.clients.delete(client);
      broadcast(room); // so others see this player as disconnected
    });
    broadcast(room); // sends the new client its state, and tells others it connected
    return;
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }

    if (p === '/api/create') {
      if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: 'Too many tables right now. Try again later.' });
      const code = newCode();
      rooms.set(code, { code, seats: [null, null, null, null], game: null, lastActive: Date.now(), clients: new Set() });
      saveSoon();
      return json(res, 200, { code });
    }

    const room = rooms.get(String(body.code || '').toUpperCase());
    if (!room) return json(res, 404, { error: 'No such table. Check the code.' });

    if (p === '/api/join') {
      const seat = body.seat;
      if (!Number.isInteger(seat) || seat < 0 || seat > 3) return json(res, 400, { error: 'Pick a seat.' });

      // Already seated with a valid token? Just confirm.
      const existing = seatForToken(room, body.token);
      if (existing >= 0) return json(res, 200, { token: room.seats[existing].token, seat: existing });

      const taken = room.seats[seat];
      if (!taken) {
        if (room.game) return json(res, 400, { error: 'That game has already started.' });
        const name = cleanName(body.name);
        if (!name) return json(res, 400, { error: 'Enter your name first.' });
        if (room.seats.some((s) => s && s.name.toLowerCase() === name.toLowerCase())) {
          return json(res, 400, { error: 'Someone at this table already has that name.' });
        }
        const token = newToken();
        room.seats[seat] = { name, token, ...profile(body) };
        if (room.hostSeat === undefined) room.hostSeat = seat;
        if (room.seats.every(Boolean)) {room.game = Engine.newGame();room.botMemory={seen:[],plays:[],voids:[[],[],[],[]]};}
        broadcast(room);
        return json(res, 200, { token, seat });
      }

      // Taking over a seat whose player dropped off (e.g. switched phone): must match the name.
      if (!taken.bot && !isConnected(room, seat) && cleanName(body.name).toLowerCase() === taken.name.toLowerCase()) {
        taken.token = newToken();
        broadcast(room);
        return json(res, 200, { token: taken.token, seat });
      }
      return json(res, 400, { error: 'That seat is taken.' });
    }

    const seat = seatForToken(room, body.token);
    if (seat < 0) return json(res, 403, { error: 'You are not seated at this table.' });

    if (p === '/api/add-bot') {
      if (seat !== room.hostSeat) return json(res, 403, {error:'Only the table host can add bots.'});
      if (room.game) return json(res, 400, {error:'Add bots before the game starts.'});
      const target = body.seat;
      if (!Number.isInteger(target) || target<0 || target>3 || room.seats[target]) return json(res,400,{error:'Choose an empty seat.'});
      const pieces=['hat','car','dog','thimble','iron','boot','ship','wheelbarrow'];
      const colors=['red','blue','green','gold','purple','silver'];
      room.seats[target]={name:'BuckBot '+(target+1),token:null,bot:true,piece:pieces[target],color:colors[target]};
      if (room.seats.every(Boolean)) {room.game=Engine.newGame();room.botMemory={seen:[],plays:[],voids:[[],[],[],[]]};}
      broadcast(room);
      return json(res,200,{ok:true});
    }
    if (p === '/api/emote') {
      if (!room.game) return json(res, 400, { error: 'Wait for the game to start.' });
      const phrase = body.phrase;
      if (!EMOTES.includes(phrase)) return json(res, 400, { error: 'Unknown emote.' });
      if (room.emote && room.emote.seat === seat && Date.now() - (room.emote.until - 4200) < 1200) return json(res, 429, { error: 'Give it a moment.' });
      room.emote = { seat, phrase, until: Date.now() + 4200 };
      broadcast(room);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/leave') {
      if (room.game) return json(res, 400, { error: 'The game has started, so seats are locked.' });
      room.seats[seat] = null;
      for (const c of [...room.clients]) if (c.seat === seat) c.res.end();
      broadcast(room);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/action') {
      if (!room.game) return json(res, 400, { error: 'The game has not started yet.' });
      const action = body.action;
      let result;
      if (action && action.type === 'newGame') {
        if (room.game.phase !== 'gameOver') return json(res, 400, { error: 'The game is not over yet.' });
        room.game = Engine.newGame({ dealer: (room.game.dealer + 1) % 4 });
        room.botMemory={seen:[],plays:[],voids:[[],[],[],[]]};
        result = { ok: true };
      } else {
        result = Engine.act(room.game, seat, action);
        if (result.ok) { updateBotMemory(room,room.game,seat,action,result.state); room.game = result.state; }
      }
      if (!result.ok) return json(res, 400, { error: result.error });
      broadcast(room);
      return json(res, 200, { ok: true });
    }
  }

  json(res, 404, { error: 'Not found.' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    try {
      json(res, 500, { error: 'Something went wrong on the server.' });
    } catch (err) {
      /* already responded */
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && now - room.lastActive > ROOM_TTL_MS) rooms.delete(code);
  }
}, 60 * 60 * 1000).unref();

if (require.main === module) {
  loadRooms();
  server.listen(PORT, () => console.log('Bid euchre is running on port ' + PORT));
}

module.exports = { server, rooms };
