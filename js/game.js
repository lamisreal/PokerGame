'use strict';
/* ══════════════════════════════════════════════════════════
   game.js  – No-Limit  (standard poker rules)
   6 seats: seat-0 = human,  seats 1-5 = AI bots
   ══════════════════════════════════════════════════════════
   Betting is controlled by a _pendingSeats queue:
     • Initialised at the start of each betting round with
       every active (not folded, not all-in) player in act order.
     • On check/call the player is removed from pending.
     • On raise/all-in every OTHER active player is (re-)added.
     • Round ends when _pendingSeats is empty.
   ══════════════════════════════════════════════════════════ */

const NUM_SEATS   = 6;
const START_CHIPS = 1000;
const SMALL_BLIND =    5;
const BIG_BLIND   =   10;
const AI_DELAY    =  800;   // ms between bot actions

// ── Game state ────────────────────────────────────────────
let G = {};   // filled by initGame / startHand

function initGame() {
  G = {
    deck:          new Deck(),
    players:       [],
    dealer:        0,
    community:     [],
    pot:           0,
    currentBet:    0,
    phase:         'idle',
    handNum:       0,
    awaitingHuman: false,
    _pendingSeats: [],   // seats that still need to act this round
    _aiTimer:      null,
  };

  for (let i = 0; i < NUM_SEATS; i++) {
    G.players.push({
      seatIdx:     i,
      name:        i === 0 ? 'You' : `Bot ${i}`,
      chips:       START_CHIPS,
      holeCards:   [],
      totalBet:    0,
      roundBet:    0,
      folded:      false,
      isAllIn:     false,
      isHuman:     i === 0,
      personality: (i - 1 + AI_PERSONALITIES.length) % AI_PERSONALITIES.length,
      active:      true,
    });
  }

  _attachButtons();
  startHand();
}

// ── Start a new hand ──────────────────────────────────────
function startHand() {
  if (G._aiTimer) { clearTimeout(G._aiTimer); G._aiTimer = null; }

  G.handNum++;
  uiLog(`━━ Hand #${G.handNum} ━━`, 'log-phase');

  G.community  = [];
  G.pot        = 0;
  G.currentBet = 0;
  G.phase      = 'preflop';
  G.awaitingHuman = false;

  const alive = G.players.filter(p => p.active);
  if (alive.length < 2) { _gameOver(); return; }

  for (const p of G.players) {
    p.holeCards = [];
    p.totalBet  = 0;
    p.roundBet  = 0;
    p.folded    = !p.active;
    p.isAllIn   = false;
    if (p.active) {
      uiSetFolded(p.seatIdx, false);
      uiSetStatus(p.seatIdx, '');
    }
  }

  G.deck.reset();
  _advanceDealer();
  uiShowDealer(G.dealer);
  uiClearCommunity();
  uiClearStatus();

  // ── Post blinds ────────────────────────────────────────
  const sb = _nextActiveSeat(G.dealer);
  const bb = _nextActiveSeat(sb);
  _postBlind(sb, SMALL_BLIND);
  _postBlind(bb, BIG_BLIND);
  G.currentBet = BIG_BLIND;
  uiLog(`Dealer: Seat ${G.dealer}  |  SB: Seat ${sb} ($${SMALL_BLIND})  |  BB: Seat ${bb} ($${BIG_BLIND})`, 'log-deal');

  // ── Deal hole cards ─────────────────────────────────────
  for (const p of G.players.filter(p => !p.folded)) {
    p.holeCards = [G.deck.deal(), G.deck.deal()];
    uiDealHole(p.seatIdx, p.holeCards, p.isHuman);
    uiUpdateChips(p.seatIdx, p.chips);
  }

  uiUpdatePot(G.pot);
  uiSetPhase('Pre-Flop');

  // Pre-flop first to act = seat after BB; BB acts LAST (gets option)
  const firstAct = _nextActiveSeat(bb);
  _buildPendingFrom(firstAct, bb);  // includes BB at the end

  _nextTurn();
}

// ── Betting round mechanics ───────────────────────────────

/**
 * Build _pendingSeats starting from startSeat going clockwise,
 * ending AFTER stopSeat (inclusive). Only non-folded, non-all-in, active.
 */
function _buildPendingFrom(startSeat, stopSeat) {
  G._pendingSeats = [];
  let idx = startSeat;
  for (let guard = 0; guard < NUM_SEATS * 2; guard++) {
    const p = G.players[idx];
    if (!p.folded && !p.isAllIn && p.active) {
      G._pendingSeats.push(idx);
    }
    if (idx === stopSeat) break;
    const next = _nextActiveSeat(idx);
    if (next === idx) break;  // no more active seats
    idx = next;
  }
}

/**
 * After a raise: re-queue every active non-folded non-all-in player
 * EXCEPT the raiser, clockwise from the seat after raiser.
 */
function _requeueAfterRaise(raiserSeat) {
  G._pendingSeats = [];
  const startFrom = _nextActiveSeat(raiserSeat);
  if (startFrom === raiserSeat) return;  // only one player left

  let idx = startFrom;
  for (let guard = 0; guard < NUM_SEATS; guard++) {
    const p = G.players[idx];
    if (idx !== raiserSeat && !p.folded && !p.isAllIn && p.active) {
      G._pendingSeats.push(idx);
    }
    const next = _nextActiveSeat(idx);
    if (next === startFrom || next === idx) break;
    idx = next;
  }
}

function _nextTurn() {
  // Drop invalid seats from front
  while (G._pendingSeats.length > 0) {
    const front = G._pendingSeats[0];
    const p = G.players[front];
    if (p.folded || p.isAllIn || !p.active) G._pendingSeats.shift();
    else break;
  }

  // End round if no one left to act
  if (G._pendingSeats.length === 0) { _endBettingRound(); return; }

  // End round if only 1 non-folded player remains
  const notFolded = G.players.filter(p => !p.folded && p.active);
  if (notFolded.length <= 1) { _endBettingRound(); return; }

  const seatIdx = G._pendingSeats[0];
  const p = G.players[seatIdx];
  uiHighlightActive(seatIdx);

  if (p.isHuman) {
    _promptHuman(p);
  } else {
    G._aiTimer = setTimeout(() => _doAiTurn(p), AI_DELAY);
  }
}

function _endBettingRound() {
  uiHighlightActive(-1);
  uiClearBets();
  uiDisableActions();
  for (const p of G.players) p.roundBet = 0;
  G.currentBet = 0;

  switch (G.phase) {
    case 'preflop': _dealFlop();  break;
    case 'flop':    _dealTurn();  break;
    case 'turn':    _dealRiver(); break;
    case 'river':   _showdown();  break;
  }
}

// ── Community card phases ─────────────────────────────────

function _dealFlop() {
  G.phase = 'flop';
  G.community.push(G.deck.deal(), G.deck.deal(), G.deck.deal());
  uiSetCommunity(G.community);
  uiSetPhase('Flop');
  uiLog(`[Flop]  ${G.community.map(c => c.toString()).join('  ')}`, 'log-phase');
  _buildPendingFrom(_nextActiveSeat(G.dealer), G.dealer);
  _nextTurn();
}

function _dealTurn() {
  G.phase = 'turn';
  G.community.push(G.deck.deal());
  uiSetCommunity(G.community);
  uiSetPhase('Turn');
  uiLog(`[Turn]  ${G.community[3].toString()}`, 'log-phase');
  _buildPendingFrom(_nextActiveSeat(G.dealer), G.dealer);
  _nextTurn();
}

function _dealRiver() {
  G.phase = 'river';
  G.community.push(G.deck.deal());
  uiSetCommunity(G.community);
  uiSetPhase('River');
  uiLog(`[River] ${G.community[4].toString()}`, 'log-phase');
  _buildPendingFrom(_nextActiveSeat(G.dealer), G.dealer);
  _nextTurn();
}

// ── Showdown ──────────────────────────────────────────────

function _showdown() {
  G.phase = 'showdown';
  uiSetPhase('Showdown');
  uiLog('[Showdown]', 'log-phase');

  const contenders = G.players.filter(p => !p.folded && p.active);
  for (const p of contenders) uiRevealHole(p.seatIdx, p.holeCards);

  const results = contenders.map(p => ({
    player: p,
    result: bestHand([...p.holeCards, ...G.community]),
  })).sort((a, b) => b.result.score - a.result.score);

  const topScore = results[0].result.score;
  const winners  = results.filter(r => r.result.score === topScore).map(r => r.player);
  const share    = Math.floor(G.pot / winners.length);

  let msgBody = '<ul style="text-align:left;list-style:none;padding:0;line-height:2">';
  for (const { player, result } of results) {
    const w = winners.includes(player);
    const cards = player.holeCards.map(c => c.toString()).join(' ');
    msgBody += `<li style="${w ? 'color:#ffd700;font-weight:700' : 'color:#aaa'}">
      ${player.name} [${cards}]: <b>${result.name}</b>${w ? ' 🏆 +$' + share : ''}
    </li>`;
    uiLog(`${player.name} [${cards}]: ${result.name}${w ? ' ← WINNER' : ''}`, w ? 'log-win' : 'log-deal');
  }
  msgBody += '</ul>';

  for (const w of winners) {
    w.chips += share;
    uiUpdateChips(w.seatIdx, w.chips);
    uiSetStatus(w.seatIdx, '🏆 Winner!', 'winner-badge');
  }
  uiLog(`Pot $${G.pot} → ${winners.map(w => w.name).join(', ')}`, 'log-win');

  for (const p of G.players) {
    if (p.active && p.chips <= 0) {
      p.active = false;
      uiSetStatus(p.seatIdx, '💀 Bust');
      uiLog(`${p.name} is eliminated.`);
    }
  }

  const stillActive = G.players.filter(p => p.active);
  const title = winners.length > 1
    ? `Split Pot! (${winners.map(w => w.name).join(' & ')})`
    : `${winners[0].name} wins!`;
  const savedPot = G.pot;
  uiUpdatePot(0);
  uiShowMessage(title, `<b>Pot: $${savedPot}</b><br/>${msgBody}`, () => {
    stillActive.length < 2 ? _gameOver() : startHand();
  });
}

// ── Human action prompt ───────────────────────────────────

function _promptHuman(p) {
  G.awaitingHuman = true;
  const callAmt = Math.max(0, G.currentBet - p.roundBet);
  const canCheck = callAmt === 0;
  const numOpps  = Math.max(1, G.players.filter(x => !x.folded && !x.isHuman).length);
  const equity   = monteCarloEquity(p.holeCards, G.community, numOpps, 500);
  uiEnableActions(canCheck, Math.min(callAmt, p.chips), equity, BIG_BLIND);
}

// ── Human button handlers ─────────────────────────────────

function _humanFold()  { if (!G.awaitingHuman) return; _doAction(G.players[0], 'fold'); }
function _humanCheck() { if (!G.awaitingHuman) return; _doAction(G.players[0], 'check'); }
function _humanCall()  { if (!G.awaitingHuman) return; _doAction(G.players[0], 'call'); }
function _humanAllIn() { if (!G.awaitingHuman) return; _doAction(G.players[0], 'allin'); }

function _humanRaise() {
  if (!G.awaitingHuman) return;
  const ra = document.getElementById('raise-area');
  ra.style.display = ra.style.display === 'flex' ? 'none' : 'flex';
}

function _humanRaiseConfirm() {
  if (!G.awaitingHuman) return;
  const amt = parseInt(document.getElementById('raise-amount').value, 10);
  const min = G.currentBet + BIG_BLIND;
  if (isNaN(amt) || amt < min) {
    alert(`Minimum raise is $${min}`);
    return;
  }
  document.getElementById('raise-area').style.display = 'none';
  _doAction(G.players[0], 'raise', amt);
}

// ── AI turn ───────────────────────────────────────────────

function _doAiTurn(p) {
  const gameState = {
    community:     G.community,
    pot:           G.pot,
    currentBet:    G.currentBet,
    bigBlind:      BIG_BLIND,
    activePlayers: G.players.filter(x => !x.folded && x.active).length,
    phase:         G.phase,
  };
  const { action, amount } = aiDecide(p, gameState, p.personality);
  _doAction(p, action, amount);
}

// ── Core action processor ─────────────────────────────────

function _doAction(p, action, raiseTarget = 0) {
  G.awaitingHuman = false;
  uiDisableActions();

  // Remove this seat from pending
  G._pendingSeats = G._pendingSeats.filter(s => s !== p.seatIdx);

  const callAmt = Math.max(0, G.currentBet - p.roundBet);

  switch (action) {

    case 'fold': {
      p.folded = true;
      uiSetFolded(p.seatIdx, true);
      uiSetStatus(p.seatIdx, 'Fold', 'folded-badge');
      uiLog(`${p.name} folds.`, 'log-action');
      G._pendingSeats = G._pendingSeats.filter(s => s !== p.seatIdx);

      const remaining = G.players.filter(x => !x.folded && x.active);
      if (remaining.length === 1) {
        const winner = remaining[0];
        winner.chips += G.pot;
        uiUpdateChips(winner.seatIdx, winner.chips);
        uiSetStatus(winner.seatIdx, '🏆 Winner!', 'winner-badge');
        uiLog(`${winner.name} wins pot of $${G.pot} (all folded).`, 'log-win');
        const savedPot = G.pot;
        uiUpdatePot(0);
        uiShowMessage(`${winner.name} wins!`,
          `Everyone else folded.<br/>Won: <b>$${savedPot}</b>`, () => startHand());
        return;
      }
      break;
    }

    case 'check': {
      uiSetStatus(p.seatIdx, 'Check');
      uiLog(`${p.name} checks.`, 'log-action');
      break;
    }

    case 'call': {
      const actual = Math.min(callAmt, p.chips);
      _moveBet(p, actual);
      if (p.chips === 0) {
        p.isAllIn = true;
        uiSetStatus(p.seatIdx, 'All-In', 'allin-badge');
        uiLog(`${p.name} calls $${actual} (all-in).`, 'log-action');
      } else {
        uiSetStatus(p.seatIdx, `Call $${actual}`);
        uiLog(`${p.name} calls $${actual}.`, 'log-action');
      }
      break;
    }

    case 'raise': {
      const maxTotal = p.roundBet + p.chips;
      const raiseTo  = Math.max(G.currentBet + BIG_BLIND, Math.min(raiseTarget, maxTotal));
      const extra    = raiseTo - p.roundBet;
      if (extra <= callAmt) { _doAction(p, 'call'); return; }

      _moveBet(p, extra);
      G.currentBet = p.roundBet;

      if (p.chips === 0) {
        p.isAllIn = true;
        uiSetStatus(p.seatIdx, 'All-In', 'allin-badge');
        uiLog(`${p.name} raises to $${p.roundBet} (all-in).`, 'log-action');
      } else {
        uiSetStatus(p.seatIdx, `Raise $${p.roundBet}`);
        uiLog(`${p.name} raises to $${p.roundBet}.`, 'log-action');
      }
      _requeueAfterRaise(p.seatIdx);
      uiUpdatePot(G.pot);
      _nextTurn();
      return;
    }

    case 'allin': {
      const allInAmt = p.chips;
      _moveBet(p, allInAmt);
      p.isAllIn = true;
      const isRaise = p.roundBet > G.currentBet;
      if (isRaise) G.currentBet = p.roundBet;
      uiSetStatus(p.seatIdx, 'All-In', 'allin-badge');
      uiLog(`${p.name} all-in $${allInAmt}${isRaise ? ' (raise)' : ' (call)'}.`, 'log-action');
      if (isRaise) _requeueAfterRaise(p.seatIdx);
      uiUpdatePot(G.pot);
      _nextTurn();
      return;
    }
  }

  uiUpdatePot(G.pot);
  _nextTurn();
}

// ── Helpers ───────────────────────────────────────────────

function _moveBet(p, amount) {
  amount     = Math.max(0, Math.min(amount, p.chips));
  p.chips   -= amount;
  p.roundBet += amount;
  p.totalBet += amount;
  G.pot      += amount;
  uiUpdateChips(p.seatIdx, p.chips);
  uiUpdateBet(p.seatIdx, p.roundBet);
}

function _postBlind(seatIdx, amount) {
  const p      = G.players[seatIdx];
  const actual = Math.min(amount, p.chips);
  p.chips     -= actual;
  p.roundBet   = actual;
  p.totalBet   = actual;
  G.pot       += actual;
  uiUpdateChips(p.seatIdx, p.chips);
  uiUpdateBet(p.seatIdx, p.roundBet);
}

/** Next seat clockwise that is active (has chips) */
function _nextActiveSeat(from) {
  let idx = (from + 1) % NUM_SEATS;
  for (let i = 0; i < NUM_SEATS; i++) {
    if (G.players[idx].active) return idx;
    idx = (idx + 1) % NUM_SEATS;
  }
  return from;
}

/** Previous seat clockwise that is active */
function _prevActiveSeat(from) {
  let idx = (from - 1 + NUM_SEATS) % NUM_SEATS;
  for (let i = 0; i < NUM_SEATS; i++) {
    if (G.players[idx].active) return idx;
    idx = (idx - 1 + NUM_SEATS) % NUM_SEATS;
  }
  return from;
}

function _advanceDealer() {
  let next = (G.dealer + 1) % NUM_SEATS;
  for (let i = 0; i < NUM_SEATS; i++) {
    if (G.players[next].active) { G.dealer = next; return; }
    next = (next + 1) % NUM_SEATS;
  }
}

// ── Game Over ─────────────────────────────────────────────

function _gameOver() {
  uiHighlightActive(-1);
  uiDisableActions();
  const winner = G.players.find(p => p.active && p.chips > 0);
  const title  = winner ? `${winner.name} wins the game!` : 'Game Over';
  const body   = winner
    ? `🏆 <b>${winner.name}</b> wins with <b>$${winner.chips}</b>!`
    : 'No chips remaining.';
  uiShowMessage(title, body, () => initGame());
}

// ── Button wiring (called once by initGame) ───────────────

function _attachButtons() {
  const rebind = (id, fn) => {
    const el  = document.getElementById(id);
    const neo = el.cloneNode(true);
    el.parentNode.replaceChild(neo, el);
    neo.addEventListener('click', fn);
  };
  rebind('btn-fold',          _humanFold);
  rebind('btn-check',         _humanCheck);
  rebind('btn-call',          _humanCall);
  rebind('btn-raise',         _humanRaise);
  rebind('btn-allin',         _humanAllIn);
  rebind('btn-raise-confirm', _humanRaiseConfirm);
  rebind('btn-new-game', () => {
    document.getElementById('message-overlay').style.display = 'none';
    initGame();
  });
  document.getElementById('raise-amount').addEventListener('keydown', e => {
    if (e.key === 'Enter') _humanRaiseConfirm();
  });
}

// ── Boot ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => initGame());



