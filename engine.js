'use strict';

/*
 * Bid Euchre rules engine (house rules).
 *
 * This file knows ONLY the rules of the game. It has no screen and no
 * networking, so it can be tested on its own and later plugged into a server.
 *
 * Seats are numbered 0-3 clockwise around the table. "Left" of seat N is
 * seat N+1. Partners sit across (0 & 2 are team 0, 1 & 3 are team 1).
 *
 * Cards are two-character strings: rank + suit, e.g. "JH" = jack of hearts,
 * "TS" = ten of spades. Ranks: 9 T J Q K A. Suits: S H D C.
 */

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['9', 'T', 'J', 'Q', 'K', 'A'];
const BIDS = [3, 4, 5, 6, 12, 24];
const SAME_COLOR = { S: 'C', C: 'S', H: 'D', D: 'H' };
const HIGH_ORDER = { '9': 0, T: 1, J: 2, Q: 3, K: 4, A: 5 };

const DEFAULT_OPTIONS = {
  targetScore: 52,
  // In a "low" hand, is the ace the LOWEST card (best) or still the highest (worst)?
  aceLowInLow: false,
};

const teamOf = (seat) => seat % 2;
const leftOf = (seat) => (seat + 1) % 4;
const rightOf = (seat) => (seat + 3) % 4;
const partnerOf = (seat) => (seat + 2) % 4;

const rankOf = (card) => card[0];
const suitOf = (card) => card[1];

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- card strength helpers ---------- */

// The suit a card "counts as" this hand. In a trump hand, the left bower
// (jack of the same color as trump) counts as trump.
function effectiveSuit(card, contract) {
  if (
    contract.mode === 'trump' &&
    rankOf(card) === 'J' &&
    suitOf(card) === SAME_COLOR[contract.trump]
  ) {
    return contract.trump;
  }
  return suitOf(card);
}

// Higher number = stronger card (when compared within the same effective suit).
function power(card, contract, options) {
  const r = rankOf(card);
  if (contract.mode === 'trump') {
    if (r === 'J' && suitOf(card) === contract.trump) return 100; // right bower
    if (r === 'J' && suitOf(card) === SAME_COLOR[contract.trump]) return 99; // left bower
    return HIGH_ORDER[r];
  }
  if (contract.mode === 'high') return HIGH_ORDER[r];
  // low: smaller is better
  if (r === 'A' && options.aceLowInLow) return 100;
  return 5 - HIGH_ORDER[r];
}

function trickWinner(plays, contract, options) {
  const ledSuit = effectiveSuit(plays[0].card, contract);
  let pool = plays.filter((p) => effectiveSuit(p.card, contract) === ledSuit);
  if (contract.mode === 'trump') {
    const trumps = plays.filter((p) => effectiveSuit(p.card, contract) === contract.trump);
    if (trumps.length) pool = trumps;
  }
  let best = pool[0];
  for (const p of pool) {
    if (power(p.card, contract, options) > power(best.card, contract, options)) best = p;
  }
  return best.seat;
}

function legalCards(hand, trickPlays, contract) {
  if (!trickPlays.length) return hand.slice();
  const led = effectiveSuit(trickPlays[0].card, contract);
  const follow = hand.filter((c) => effectiveSuit(c, contract) === led);
  return follow.length ? follow : hand.slice();
}

/* ---------- game setup ---------- */

function newGame(userOptions = {}, rng = Math.random) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const dealer = Number.isInteger(options.dealer) ? options.dealer : Math.floor(rng() * 4);
  delete options.dealer;
  const state = {
    options,
    scores: [0, 0],
    dealer,
    handNumber: 1,
    winner: null,
    history: [],
  };
  dealHand(state, rng);
  return state;
}

function dealHand(state, rng) {
  const deck = shuffle(makeDeck(), rng);
  state.hands = [0, 1, 2, 3].map((i) => deck.slice(i * 6, i * 6 + 6));
  state.phase = 'bidding';
  const order = [1, 2, 3, 4].map((k) => (state.dealer + k) % 4); // left of dealer ... dealer last
  state.bidding = {
    order,
    index: 0,
    bids: [null, null, null, null], // per seat: null (not yet), 'pass', or a number
    highBid: 0,
    highBidder: null,
    forcedUnder: false,
  };
  state.turn = order[0];
  state.contract = null;
  state.declineDecider = null;
  state.exchange = null;
  state.sittingOut = null;
  state.trick = null;
  state.tricksWon = [0, 0];
  state.handResult = null;
  state.lastTrick = null;
}

/* ---------- actions ---------- */

// Apply one player's action. Returns { ok: true, state } or { ok: false, error }.
// The original state is never modified.
function act(state, seat, action, rng = Math.random) {
  const s = JSON.parse(JSON.stringify(state));
  const err = (msg) => ({ ok: false, error: msg });
  if (!action || typeof action.type !== 'string') return err('Bad action.');
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) return err('Bad seat.');

  if (action.type === 'misdeal') {
    if (s.phase !== 'bidding') return err('Misdeal must be declared during bidding.');
    if (!hasFourOfRank(s.hands[seat])) return err('You need four cards of the same rank to declare a misdeal.');
    dealHand(s, rng); // void hand; same dealer, same score, same hand number
    return { ok: true, state: s };
  }

  switch (s.phase) {
    case 'bidding':
      return doBid(s, seat, action, err);
    case 'declare':
      return doDeclare(s, seat, action, err);
    case 'decline':
      return doDeclineChoice(s, seat, action, err);
    case 'exchange':
      return doExchange(s, seat, action, err);
    case 'play':
      return doPlay(s, seat, action, err);
    case 'handOver':
      if (action.type !== 'nextHand') return err('The hand is over. Start the next hand.');
      s.dealer = leftOf(s.dealer);
      s.handNumber += 1;
      dealHand(s, rng);
      return { ok: true, state: s };
    case 'gameOver':
      return err('The game is over.');
    default:
      return err('Unknown phase.');
  }
}

function hasFourOfRank(hand) {
  return RANKS.some((rank) => hand.filter((card) => rankOf(card) === rank).length === 4);
}

function doBid(s, seat, action, err) {
  if (seat !== s.turn) return err('It is not your turn to bid.');
  const b = s.bidding;
  const isDealer = seat === s.dealer;

  if (action.type === 'pass') {
    if (isDealer && b.highBid === 0) return err('Everyone passed, so the dealer must bid.');
    b.bids[seat] = 'pass';
  } else if (action.type === 'bid') {
    if (!BIDS.includes(action.amount)) return err('That is not an allowed bid.');
    if (action.amount <= b.highBid) return err('You must bid higher than the current bid.');
    b.bids[seat] = action.amount;
    if (isDealer && b.highBid === 0) b.forcedUnder = action.amount === 3;
    b.highBid = action.amount;
    b.highBidder = seat;
  } else {
    return err('You need to bid or pass.');
  }

  b.index += 1;
  if (b.index >= 4) {
    s.contract = { bidder: b.highBidder, amount: b.highBid, mode: null, trump: null };
    s.phase = 'declare';
    s.turn = b.highBidder;
  } else {
    s.turn = b.order[b.index];
  }
  return { ok: true, state: s };
}

function doDeclare(s, seat, action, err) {
  const c = s.contract;
  if (seat !== c.bidder) return err('Only the bid winner declares trump.');
  if (action.type !== 'declare') return err('You need to declare trump, high, or low.');

  if (action.mode === 'trump') {
    if (!SUITS.includes(action.suit)) return err('Pick a trump suit.');
    c.mode = 'trump';
    c.trump = action.suit;
    // Defenders may decline a trump game, except on a forced dealer bid.
    if (s.bidding.forcedUnder) { beginPlay(s); return { ok: true, state: s }; }
    // Defenders may decline a trump game. The defender to the declarer's left speaks for the team.
    s.phase = 'decline';
    s.declineDecider = leftOf(c.bidder);
    s.turn = s.declineDecider;
  } else if (action.mode === 'high' || action.mode === 'low') {
    if (c.amount < 4 || c.amount > 6) return err('High or low can only be declared on a bid of 4, 5, or 6.');
    c.mode = action.mode;
    c.trump = null;
    // High/low cannot be declined: defenders must play.
    beginPlay(s);
  } else {
    return err('Choose trump, high, or low.');
  }
  return { ok: true, state: s };
}

function doDeclineChoice(s, seat, action, err) {
  if (seat !== s.declineDecider) return err('The defender to the declarer\'s left decides for the defenders.');
  const c = s.contract;
  if (action.type === 'decline') {
    finishHand(s, true);
  } else if (action.type === 'play') {
    if (c.amount === 12) {
      s.phase = 'exchange';
      s.exchange = { given: {} };
      s.turn = null;
    } else {
      if (c.amount === 24) s.sittingOut = partnerOf(c.bidder);
      beginPlay(s);
    }
  } else {
    return err('Choose to play or decline.');
  }
  return { ok: true, state: s };
}

function doExchange(s, seat, action, err) {
  const c = s.contract;
  const partner = partnerOf(c.bidder);
  if (seat !== c.bidder && seat !== partner) return err('Only the bidder and their partner swap cards.');
  if (action.type !== 'give') return err('Choose a card to give.');
  if (s.exchange.given[seat] !== undefined) return err('You already chose your card.');
  if (!s.hands[seat].includes(action.card)) return err('You do not hold that card.');
  s.exchange.given[seat] = action.card;

  const gB = s.exchange.given[c.bidder];
  const gP = s.exchange.given[partner];
  if (gB !== undefined && gP !== undefined) {
    // Swap: each gives their chosen card to the other, then the partner sits out.
    s.hands[c.bidder] = s.hands[c.bidder].filter((x) => x !== gB).concat(gP);
    s.hands[partner] = [];
    s.sittingOut = partner;
    s.exchange = null;
    beginPlay(s);
  }
  return { ok: true, state: s };
}

function beginPlay(s) {
  const c = s.contract;
  let leader;
  if (c.mode === 'low') leader = leftOf(c.bidder);
  else if (c.mode === 'high') leader = rightOf(c.bidder);
  else leader = c.bidder;
  s.phase = 'play';
  s.trick = { leader, plays: [] };
  s.turn = leader;
}

function activeSeatCount(s) {
  return s.sittingOut === null ? 4 : 3;
}

function nextActiveSeat(s, seat) {
  let n = leftOf(seat);
  if (n === s.sittingOut) n = leftOf(n);
  return n;
}

function doPlay(s, seat, action, err) {
  if (seat !== s.turn) return err('It is not your turn.');
  if (action.type !== 'play') return err('Play a card.');
  const hand = s.hands[seat];
  if (!hand.includes(action.card)) return err('You do not hold that card.');
  const legal = legalCards(hand, s.trick.plays, s.contract);
  if (!legal.includes(action.card)) return err('You must follow suit.');

  s.hands[seat] = hand.filter((c) => c !== action.card);
  s.trick.plays.push({ seat, card: action.card });

  if (s.trick.plays.length < activeSeatCount(s)) {
    s.turn = nextActiveSeat(s, seat);
    return { ok: true, state: s };
  }

  // Trick complete.
  const winner = trickWinner(s.trick.plays, s.contract, s.options);
  s.tricksWon[teamOf(winner)] += 1;
  s.lastTrick = { plays: s.trick.plays, winner };
  if (s.tricksWon[0] + s.tricksWon[1] >= 6) {
    finishHand(s, false);
  } else {
    s.trick = { leader: winner, plays: [] };
    s.turn = winner;
  }
  return { ok: true, state: s };
}

/* ---------- scoring ---------- */

function finishHand(s, declined) {
  const { bidder, amount } = s.contract;
  const bt = teamOf(bidder);
  const dt = 1 - bt;
  const delta = [0, 0];
  let made = null;

  if (declined) {
    delta[bt] = amount >= 12 ? amount : 6;
  } else {
    const bt_tricks = s.tricksWon[bt];
    const dt_tricks = s.tricksWon[dt];
    made = amount >= 12 ? bt_tricks === 6 : bt_tricks >= amount;
    if (made) delta[bt] = amount >= 12 ? amount : bt_tricks; // overtricks count on 3-6 bids
    else delta[bt] = -amount; // set
    delta[dt] = dt_tricks > 0 ? dt_tricks : -amount; // defenders: 1 per trick, or set if none
  }

  s.scores = [s.scores[0] + delta[0], s.scores[1] + delta[1]];
  s.handResult = {
    handNumber: s.handNumber,
    declined,
    bidderTeam: bt,
    bidder,
    amount,
    mode: s.contract.mode,
    trump: s.contract.trump,
    made,
    tricks: s.tricksWon.slice(),
    delta,
    scores: s.scores.slice(),
  };

  if (!Array.isArray(s.history)) s.history = [];
  s.history.push(JSON.parse(JSON.stringify(s.handResult)));

  const target = s.options.targetScore;
  const reached = s.scores.filter((x) => x >= target).length > 0;
  if (reached && s.scores[0] !== s.scores[1]) {
    s.winner = s.scores[0] > s.scores[1] ? 0 : 1;
    s.phase = 'gameOver';
  } else {
    s.phase = 'handOver';
  }
  s.turn = null;
  s.trick = null;
}

/* ---------- what a player is allowed to do / see ---------- */

function legalActions(s, seat) {
  const out = [];
  if (s.phase === 'bidding' && hasFourOfRank(s.hands[seat])) out.push({ type: 'misdeal' });
  switch (s.phase) {
    case 'bidding':
      if (seat === s.turn) {
        if (!(seat === s.dealer && s.bidding.highBid === 0)) out.push({ type: 'pass' });
        for (const amount of BIDS) if (amount > s.bidding.highBid) out.push({ type: 'bid', amount });
      }
      break;
    case 'declare':
      if (seat === s.contract.bidder) {
        for (const suit of SUITS) out.push({ type: 'declare', mode: 'trump', suit });
        if (s.contract.amount >= 4 && s.contract.amount <= 6) {
          out.push({ type: 'declare', mode: 'high' }, { type: 'declare', mode: 'low' });
        }
      }
      break;
    case 'decline':
      if (seat === s.declineDecider && !s.bidding.forcedUnder) out.push({ type: 'play' }, { type: 'decline' });
      break;
    case 'exchange': {
      const partner = partnerOf(s.contract.bidder);
      if ((seat === s.contract.bidder || seat === partner) && s.exchange.given[seat] === undefined) {
        for (const card of s.hands[seat]) out.push({ type: 'give', card });
      }
      break;
    }
    case 'play':
      if (seat === s.turn) {
        for (const card of legalCards(s.hands[seat], s.trick.plays, s.contract)) out.push({ type: 'play', card });
      }
      break;
    case 'handOver':
      out.push({ type: 'nextHand' });
      break;
    default:
      break;
  }
  return out;
}

// What one player is allowed to see. Other players' cards are never included.
function viewFor(s, seat) {
  return {
    seat,
    phase: s.phase,
    dealer: s.dealer,
    handNumber: s.handNumber,
    scores: s.scores.slice(),
    history: (s.history || []).map((r) => ({ ...r, scores: r.scores.slice(), delta: r.delta.slice() })),
    winner: s.winner,
    turn: s.turn,
    hand: s.hands[seat].slice(),
    handSizes: s.hands.map((h) => h.length),
    bidding: {
      bids: s.bidding.bids.slice(),
      highBid: s.bidding.highBid,
      highBidder: s.bidding.highBidder,
    },
    contract: s.contract,
    declineDecider: s.declineDecider,
    sittingOut: s.sittingOut,
    exchange: s.exchange ? { youGave: s.exchange.given[seat] !== undefined } : null,
    trick: s.trick,
    lastTrick: s.lastTrick || null,
    tricksWon: s.tricksWon.slice(),
    handResult: s.handResult,
    legal: legalActions(s, seat),
  };
}

module.exports = {
  SUITS,
  RANKS,
  BIDS,
  newGame,
  act,
  legalActions,
  viewFor,
  // exposed for testing
  _internals: { trickWinner, legalCards, effectiveSuit, power, teamOf, leftOf, rightOf, partnerOf, makeDeck },
};
