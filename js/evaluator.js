'use strict';
/* ══════════════════════════════════════════════════════════
   evaluator.js  – 5/7-card hand evaluator
   ══════════════════════════════════════════════════════════
   Returns an integer "score" where higher score = better hand.
   Score structure (32-bit integer):
     bits 28-24  category (0-8)
     remaining bits encode kickers / tiebreakers
   ══════════════════════════════════════════════════════════ */

const HAND_NAMES = [
  'High Card','One Pair','Two Pair','Three of a Kind',
  'Straight','Flush','Full House','Four of a Kind','Straight Flush'
];

/**
 * Evaluate a 5-card hand.
 * @param {Card[]} five  – exactly 5 Card objects
 * @returns {number}     – integer hand score (higher = better)
 */
function evalFive(five) {
  // Sort descending by value
  const cards = [...five].sort((a, b) => b.value - a.value);
  const vals  = cards.map(c => c.value);    // descending
  const suits = cards.map(c => c.suit);

  const isFlush    = suits.every(s => s === suits[0]);
  const isStraight = _isStraight(vals);

  // Count frequencies
  const freq = {};
  for (const v of vals) freq[v] = (freq[v] || 0) + 1;
  const counts = Object.values(freq).sort((a,b) => b-a);  // e.g. [3,1,1]

  let category, tiebreakers;

  if (isFlush && isStraight) {
    category     = 8;
    tiebreakers  = [_straightHigh(vals)];
  } else if (counts[0] === 4) {
    category     = 7;
    const quad   = _groupVals(freq, 4)[0];
    const kicker = _groupVals(freq, 1)[0];
    tiebreakers  = [quad, kicker];
  } else if (counts[0] === 3 && counts[1] === 2) {
    category     = 6;
    const trip   = _groupVals(freq, 3)[0];
    const pair   = _groupVals(freq, 2)[0];
    tiebreakers  = [trip, pair];
  } else if (isFlush) {
    category     = 5;
    tiebreakers  = vals;  // all 5 for tie-breaking
  } else if (isStraight) {
    category     = 4;
    tiebreakers  = [_straightHigh(vals)];
  } else if (counts[0] === 3) {
    category     = 3;
    const trip   = _groupVals(freq, 3)[0];
    const kicks  = _groupVals(freq, 1).sort((a,b)=>b-a);
    tiebreakers  = [trip, ...kicks];
  } else if (counts[0] === 2 && counts[1] === 2) {
    category     = 2;
    const pairs  = _groupVals(freq, 2).sort((a,b)=>b-a);
    const kicker = _groupVals(freq, 1)[0];
    tiebreakers  = [...pairs, kicker];
  } else if (counts[0] === 2) {
    category     = 1;
    const pair   = _groupVals(freq, 2)[0];
    const kicks  = _groupVals(freq, 1).sort((a,b)=>b-a);
    tiebreakers  = [pair, ...kicks];
  } else {
    category     = 0;
    tiebreakers  = vals;
  }

  return _encode(category, tiebreakers);
}

/** Encode category + up-to-5 tiebreaker values into one integer */
function _encode(cat, tb) {
  // Each value 0-12 fits in 4 bits; category 0-8 needs 4 bits
  // Total: 4 + 5*4 = 24 bits – comfortably fits in 32-bit int
  let score = cat * (13 ** 5);
  for (let i = 0; i < 5; i++) {
    score += ((tb[i] || 0) + 1) * (13 ** (4 - i));
  }
  return score;
}

/** Card values sorted descending for a straight? */
function _isStraight(vals) {
  // Normal: consecutive descending
  if (vals[0] - vals[4] === 4 && new Set(vals).size === 5) return true;
  // Wheel: A-2-3-4-5  (vals: [12,3,2,1,0])
  if (vals[0] === 12 && vals[1] === 3 && vals[2] === 2 && vals[3] === 1 && vals[4] === 0) return true;
  return false;
}

/** Highest card of straight (handles wheel = 3) */
function _straightHigh(vals) {
  if (vals[0] === 12 && vals[1] === 3) return 3; // wheel: 5-high
  return vals[0];
}

/** Get card values that appear `count` times, sorted descending */
function _groupVals(freq, count) {
  return Object.entries(freq)
    .filter(([,c]) => c === count)
    .map(([v]) => Number(v))
    .sort((a,b) => b-a);
}

/* ──────────────────────────────────────────────────────────
   Best 5 from N cards (N=6 or 7)
   ────────────────────────────────────────────────────────── */

/** All C(n,5) combinations (indices) */
function combos5(n) {
  const result = [];
  for (let a = 0; a < n-4; a++)
    for (let b = a+1; b < n-3; b++)
      for (let c = b+1; c < n-2; c++)
        for (let d = c+1; d < n-1; d++)
          for (let e = d+1; e < n; e++)
            result.push([a,b,c,d,e]);
  return result;
}

/**
 * @param {Card[]} cards  – 2-7 cards
 * @returns {{ score:number, name:string, bestFive:Card[] }}
 */
function bestHand(cards) {
  if (cards.length < 5) {
    // Not enough community cards yet; return placeholder
    return { score: 0, name: 'Waiting…', bestFive: [] };
  }
  if (cards.length === 5) {
    const score = evalFive(cards);
    return { score, name: HAND_NAMES[_category(score)], bestFive: cards };
  }
  let best = -1, bestFive = null;
  for (const idx of combos5(cards.length)) {
    const hand  = idx.map(i => cards[i]);
    const score = evalFive(hand);
    if (score > best) { best = score; bestFive = hand; }
  }
  return { score: best, name: HAND_NAMES[_category(best)], bestFive };
}

function _category(score) {
  return Math.floor(score / (13 ** 5));
}

/**
 * Compare two players' hands given community cards.
 * Returns  1 if p1 wins, -1 if p2 wins, 0 if tie.
 * @param {Card[]} hole1   player 1 hole cards
 * @param {Card[]} hole2   player 2 hole cards
 * @param {Card[]} comm    community cards (0-5)
 */
function compareHands(hole1, hole2, comm) {
  const s1 = bestHand([...hole1, ...comm]).score;
  const s2 = bestHand([...hole2, ...comm]).score;
  return s1 > s2 ? 1 : s1 < s2 ? -1 : 0;
}
