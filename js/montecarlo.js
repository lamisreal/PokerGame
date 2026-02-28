'use strict';
/* ══════════════════════════════════════════════════════════
   montecarlo.js  –  Monte Carlo equity estimation
   Inspired by montecarlo_python.py from dickreuter/Poker
   ══════════════════════════════════════════════════════════
   Simulates many random run-outs to estimate win probability.
   ══════════════════════════════════════════════════════════ */

/**
 * Estimate win equity for `holeCards` against `numOpponents` opponents,
 * given the current `community` cards already dealt.
 *
 * @param {Card[]} holeCards     – Player's 2 hole cards
 * @param {Card[]} community     – 0-5 community cards currently on board
 * @param {number} numOpponents  – number of active opponents (1-5)
 * @param {number} iterations    – simulation count (default 800)
 * @returns {number}             – win equity 0.0 – 1.0
 */
function monteCarloEquity(holeCards, community, numOpponents, iterations = 800) {
  if (!holeCards || holeCards.length < 2) return 0.5;

  numOpponents = Math.max(1, Math.min(numOpponents, 5));

  // Build set of known cards (hole + community)
  const known = new Set([...holeCards, ...community].map(c => c.toString()));

  // Full deck excluding known cards
  const allCards = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const key = rank + suit;
      if (!known.has(key)) allCards.push(new Card(rank, suit));
    }

  const commNeeded = 5 - community.length;   // how many more community cards to deal
  const holeNeeded = numOpponents * 2;       // opponent hole cards
  const totalNeeded = commNeeded + holeNeeded;

  let wins = 0, ties = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Shuffle allCards in-place (partial Fisher-Yates for totalNeeded)
    for (let i = 0; i < totalNeeded; i++) {
      const j = i + Math.floor(Math.random() * (allCards.length - i));
      const tmp = allCards[i]; allCards[i] = allCards[j]; allCards[j] = tmp;
    }

    // Assign
    const simComm = [...community, ...allCards.slice(0, commNeeded)];
    const opponentHoles = [];
    for (let o = 0; o < numOpponents; o++) {
      opponentHoles.push([
        allCards[commNeeded + o * 2],
        allCards[commNeeded + o * 2 + 1]
      ]);
    }

    // Evaluate hero
    const heroScore = bestHand([...holeCards, ...simComm]).score;

    // Compare against every opponent
    let wonAll = true, tiedAny = false;
    for (const oppHole of opponentHoles) {
      const oppScore = bestHand([...oppHole, ...simComm]).score;
      if (oppScore > heroScore) { wonAll = false; break; }
      if (oppScore === heroScore) tiedAny = true;
    }

    if (wonAll) {
      if (tiedAny) ties++;
      else          wins++;
    }
  }

  return (wins + ties * 0.5) / iterations;
}
