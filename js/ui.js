'use strict';
/* ══════════════════════════════════════════════════════════
   ui.js  –  DOM rendering helpers
   ══════════════════════════════════════════════════════════ */

/** Format chips as currency string */
function fmt(n) { return '$' + Number(n).toLocaleString(); }

/** Build a .card DOM element */
function cardEl(card, faceDown = false) {
  const el = document.createElement('div');
  el.className = 'card';
  if (faceDown) {
    el.classList.add('back');
    return el;
  }
  el.classList.add(card.isRed ? 'red' : 'black');
  el.innerHTML = `<span class="rank">${card.rank}</span><span class="suit">${card.suit}</span>`;
  return el;
}

// ── Seat updates ──────────────────────────────────────────────────────────────

function uiUpdateChips(seatIdx, chips) {
  document.getElementById(`chips-${seatIdx}`).textContent = fmt(chips);
}

function uiUpdateBet(seatIdx, bet) {
  const el = document.getElementById(`bet-${seatIdx}`);
  el.textContent = bet > 0 ? `Bet: ${fmt(bet)}` : '';
}

function uiClearBets() {
  for (let i = 0; i < 6; i++) uiUpdateBet(i, 0);
}

function uiSetStatus(seatIdx, text, cls = '') {
  const el = document.getElementById(`status-${seatIdx}`);
  el.textContent = text;
  el.className = 'player-status' + (cls ? ` ${cls}` : '');
}

function uiClearStatus() {
  for (let i = 0; i < 6; i++) uiSetStatus(i, '');
}

function uiHighlightActive(seatIdx) {
  for (let i = 0; i < 6; i++) {
    const s = document.getElementById(`seat-${i}`);
    s.classList.toggle('active-player', i === seatIdx);
  }
}

function uiSetFolded(seatIdx, folded) {
  document.getElementById(`seat-${seatIdx}`).classList.toggle('folded', folded);
}

function uiShowDealer(dealerSeat) {
  for (let i = 0; i < 6; i++) {
    document.getElementById(`dealer-${i}`).style.display =
      i === dealerSeat ? 'flex' : 'none';
  }
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function uiDealHole(seatIdx, cards, showFace) {
  const wrap = document.getElementById(`hole-${seatIdx}`);
  wrap.innerHTML = '';
  for (const card of cards) {
    wrap.appendChild(cardEl(card, !showFace));
  }
}

function uiRevealHole(seatIdx, cards) {
  const wrap = document.getElementById(`hole-${seatIdx}`);
  wrap.innerHTML = '';
  for (const card of cards) {
    wrap.appendChild(cardEl(card, false));
  }
}

function uiClearHole(seatIdx) {
  document.getElementById(`hole-${seatIdx}`).innerHTML = '';
}

function uiSetCommunity(cards) {
  const wrap = document.getElementById('community-cards');
  wrap.innerHTML = '';
  for (const card of cards) {
    wrap.appendChild(cardEl(card, false));
  }
}

function uiClearCommunity() {
  document.getElementById('community-cards').innerHTML = '';
}

// ── Pot & phase ───────────────────────────────────────────────────────────────

function uiUpdatePot(pot) {
  document.getElementById('pot-display').textContent = 'Pot: ' + fmt(pot);
}

function uiSetPhase(label) {
  document.getElementById('phase-label').textContent = label;
}

// ── Action buttons ────────────────────────────────────────────────────────────

function uiEnableActions(canCheck, callAmt, equity, bigBlind) {
  // Ensure containers are visible (may have been hidden by stood_up)
  document.getElementById('action-buttons').style.display = 'flex';
  document.getElementById('action-info').style.display    = 'flex';

  const $f = document.getElementById('btn-fold');
  const $x = document.getElementById('btn-check');
  const $c = document.getElementById('btn-call');
  const $r = document.getElementById('btn-raise');
  const $a = document.getElementById('btn-allin');

  $f.disabled = false;
  $x.disabled = !canCheck;
  $c.disabled = canCheck;      // can't call if can check
  $r.disabled = false;
  $a.disabled = false;

  // Label
  $c.textContent = canCheck ? 'Check' : `Call ${fmt(callAmt)}`;

  // Info bar
  document.getElementById('call-amount-label').textContent =
    canCheck ? 'You can check' : `Call: ${fmt(callAmt)}`;
  document.getElementById('equity-label').textContent =
    `Equity: ${(equity * 100).toFixed(1)}%`;

  // Raise default
  const raiseMin = Math.max(callAmt + bigBlind, bigBlind * 2);
  document.getElementById('raise-amount').value = raiseMin;
  document.getElementById('raise-area').style.display = 'none';
}

function uiDisableActions() {
  ['btn-fold','btn-check','btn-call','btn-raise','btn-allin'].forEach(id => {
    document.getElementById(id).disabled = true;
  });
  document.getElementById('raise-area').style.display = 'none';
  document.getElementById('call-amount-label').textContent = '';
  document.getElementById('equity-label').textContent = '';
}

// ── Draggable message box ─────────────────────────────────

(function () {
  let dragging = false, ox = 0, oy = 0;

  document.addEventListener('DOMContentLoaded', () => {
    const handle = document.getElementById('message-drag-handle');
    const box    = document.getElementById('message-box');

    handle.addEventListener('mousedown', e => {
      // Switch from transform-center to absolute coords first time
      const r = box.getBoundingClientRect();
      box.style.transform = 'none';
      box.style.left = r.left + 'px';
      box.style.top  = r.top  + 'px';

      dragging = true;
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      box.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      let nx = e.clientX - ox;
      let ny = e.clientY - oy;
      // Keep within viewport
      nx = Math.max(0, Math.min(nx, window.innerWidth  - box.offsetWidth));
      ny = Math.max(0, Math.min(ny, window.innerHeight - box.offsetHeight));
      box.style.left = nx + 'px';
      box.style.top  = ny + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.getElementById('message-box').classList.remove('dragging');
    });
  });
})();

// ── Message box ───────────────────────────────────────────────────────────────

function uiShowMessage(title, body, onOk, mode = '') {
  document.getElementById('message-title').textContent = title;
  document.getElementById('message-body').innerHTML = body;

  // Reset position to top-center each time
  const box = document.getElementById('message-box');
  box.style.transform = 'translateX(-50%)';
  box.style.left = '50%';
  box.style.top  = '70px';

  // Apply mode class (e.g. 'showdown' for wider box)
  box.className = mode ? `mode-${mode}` : '';

  // Restart slide-down animation
  box.style.animation = 'none';
  void box.offsetHeight; // force reflow
  box.style.animation  = '';

  document.getElementById('message-overlay').style.display = 'block';
  const btn = document.getElementById('message-ok');
  btn.onclick = () => {
    document.getElementById('message-overlay').style.display = 'none';
    if (onOk) onOk();
  };
}

// ── Log ───────────────────────────────────────────────────────────────────────

function uiLog(text, cls = '') {
  const body = document.getElementById('log-body');
  const line = document.createElement('div');
  line.className = 'log-line' + (cls ? ` ${cls}` : '');
  line.textContent = text;
  body.appendChild(line);
  // Auto-scroll
  body.scrollTop = body.scrollHeight;
  // Keep log manageable
  while (body.children.length > 200) body.removeChild(body.firstChild);
}
