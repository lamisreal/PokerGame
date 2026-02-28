'use strict';
/* ══════════════════════════════════════════════════════════
   ai.js  –  AI Player Decision Maker
   Inspired by decisionmaker.py from dickreuter/Poker
   ══════════════════════════════════════════════════════════
   Strategy:
     1. Calculate win equity via Monte Carlo
     2. Calculate pot odds (call-size / (pot + call-size))
     3. Apply position & betting-history adjustments
     4. Decide: fold / check / call / raise / all-in
   ══════════════════════════════════════════════════════════ */

// Personality archetypes – similar to "strategies" in the original bot
const AI_PERSONALITIES = [
  { name: 'Tight-Passive',    aggFactor: 0.6, bluffFreq: 0.05 },
  { name: 'Loose-Aggressive', aggFactor: 1.4, bluffFreq: 0.18 },
  { name: 'Tag-Optimal',      aggFactor: 1.0, bluffFreq: 0.10 },
  { name: 'Maniac',           aggFactor: 1.8, bluffFreq: 0.30 },
  { name: 'Rock',             aggFactor: 0.5, bluffFreq: 0.02 },
];

/**
 * Determine the AI action for a bot player.
 *
 * @param {object} player        – { holeCards, chips, totalBet, seatIndex }
 * @param {object} gameState     – { community, pot, currentBet, bigBlind, activePlayers, phase }
 * @param {number} personality   – index into AI_PERSONALITIES (0-4)
 * @returns {{ action: string, amount?: number }}
 *   action is one of: 'fold' | 'check' | 'call' | 'raise' | 'allin'
 */
function aiDecide(player, gameState, personality = 2) {
  const pers        = AI_PERSONALITIES[personality % AI_PERSONALITIES.length];
  const { holeCards }   = player;
  const { community, pot, currentBet, bigBlind, activePlayers, phase } = gameState;

  const callAmount  = Math.max(0, currentBet - player.totalBet);
  const canCheck    = callAmount === 0;
  const hasEnough   = player.chips > callAmount;

  // ── 1. Monte Carlo equity ────────────────────────────────
  const numOpps  = Math.max(1, activePlayers - 1);
  const equity   = monteCarloEquity(holeCards, community, numOpps, 600);

  // ── 2. Pot odds ──────────────────────────────────────────
  const potOdds  = callAmount > 0
    ? callAmount / (pot + callAmount)
    : 0;

  // ── 3. Adjusted equity (personality & bluff) ────────────
  const isBluff  = Math.random() < pers.bluffFreq;
  let adjEquity  = equity * pers.aggFactor;
  if (isBluff) adjEquity = Math.min(0.85, adjEquity + 0.25);

  // ── 4. Thresholds (vary by phase) ───────────────────────
  //   phase: 'preflop' | 'flop' | 'turn' | 'river'
  const thresholds = {
    preflop: { fold: 0.30, call: 0.45, raise: 0.62, allin: 0.82 },
    flop:    { fold: 0.28, call: 0.42, raise: 0.60, allin: 0.80 },
    turn:    { fold: 0.26, call: 0.40, raise: 0.58, allin: 0.78 },
    river:   { fold: 0.24, call: 0.38, raise: 0.55, allin: 0.75 },
  };
  const t = thresholds[phase] || thresholds.river;

  // ── 5. Decision tree ────────────────────────────────────
  // All-in
  if (adjEquity >= t.allin || player.chips <= callAmount + bigBlind) {
    return { action: 'allin' };
  }
  // Raise
  if (adjEquity >= t.raise && player.chips > callAmount * 2) {
    const factor     = 2 + Math.floor(Math.random() * 2);          // 2x or 3x
    const raiseTotal = Math.min(player.chips, currentBet * factor + bigBlind * 2);
    return { action: 'raise', amount: Math.max(raiseTotal, currentBet + bigBlind) };
  }
  // Call if equity > pot odds (basic poker math)
  if (adjEquity > potOdds + t.call * 0.3 && hasEnough) {
    if (canCheck) return { action: 'check' };
    return { action: 'call' };
  }
  // Check if free
  if (canCheck) return { action: 'check' };
  // Fold
  if (adjEquity < t.fold) return { action: 'fold' };
  // Default: call
  if (!hasEnough) return { action: 'allin' };
  return { action: 'call' };
}
