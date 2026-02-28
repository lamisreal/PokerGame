'use strict';
/* ══════════════════════════════════════════════════════════
   client.js  –  Socket.IO multiplayer client
   ══════════════════════════════════════════════════════════ */

const socket = io('https://pokergame-sodn.onrender.com');          // connects to same origin

/* ── State ─────────────────────────────────────────────────── */
let MY_SID        = null;
let MY_SEAT       = null;   // null if spectator
let MY_ROLE       = null;   // 'player' | 'spectator'
let IS_HOST       = false;  // first player to join = host
let IS_SUPER_ADMIN = false; // name === 'lamisreal'
let MY_NAME       = '';
let CALL_AMT      = 0;
let BIG_BLIND     = 10;
let EQUITY_VAL    = 0;
let _lastState    = null;   // cache of last received game_state
let _voluntaryLeave = false; // true when player clicks "Thoát ra" themselves
let _countdownInterval = null;  // client-side visual tick
let _countdownVal      = 0;     // remaining seconds shown
let _turnTimerSeat     = null;  // seat index that owns the running turn timer
let _turnTimerInterval = null;  // setInterval handle for turn timer tick

/* ── DOM shortcuts ─────────────────────────────────────────── */
const $id  = id => document.getElementById(id);
const $app = () => $id('app');

/* ══════════════════ TURN TIMER ═══════════════════════════════ */

const TIMER_CIRC = 87.96; // 2π × r(14)

function _startTurnTimer(seat, secs) {
  _stopTurnTimer();
  _turnTimerSeat = seat;
  const el = document.getElementById(`seat-${seat}`);
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'seat-timer';
  div.id = `turn-timer-${seat}`;
  div.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 32 32">
      <circle class="timer-bg"   cx="16" cy="16" r="14"/>
      <circle class="timer-ring" cx="16" cy="16" r="14"
        stroke-dasharray="${TIMER_CIRC}"
        stroke-dashoffset="0"
        style="animation:turn-drain ${secs}s linear forwards"/>
    </svg>
    <span class="timer-num" id="turn-timer-num-${seat}">${secs}</span>`;
  el.appendChild(div);
  let remaining = secs;
  _turnTimerInterval = setInterval(() => {
    remaining--;
    const numEl = document.getElementById(`turn-timer-num-${seat}`);
    if (numEl) {
      numEl.textContent = remaining > 0 ? remaining : 0;
      if (remaining <= 10) numEl.classList.add('timer-urgent');
    }
    if (remaining <= 0) _stopTurnTimer();
  }, 1000);
}

function _stopTurnTimer() {
  if (_turnTimerInterval) { clearInterval(_turnTimerInterval); _turnTimerInterval = null; }
  if (_turnTimerSeat !== null) {
    const old = document.getElementById(`turn-timer-${_turnTimerSeat}`);
    if (old) old.remove();
    _turnTimerSeat = null;
  }
}

socket.on('turn_timer_start', data => _startTurnTimer(data.seat, data.seconds));
socket.on('turn_timer_stop',  ()   => _stopTurnTimer());

/* ══════════════════ LOBBY ═════════════════════════════════════ */

// Persistent device token – stays in localStorage forever on this browser
function _deviceToken() {
  let t = localStorage.getItem('poker_token');
  if (!t) {
    t = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,
      c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
    localStorage.setItem('poker_token', t);
  }
  return t;
}
const MY_TOKEN = _deviceToken();

document.addEventListener('DOMContentLoaded', () => {
  uiDisableActions();

  // Pre-fill saved name from localStorage
  const savedName = localStorage.getItem('poker_name') || '';
  if (savedName) {
    $id('player-name').value = savedName;
    socket.emit('get_player_info', { name: savedName, token: MY_TOKEN });
  }

  $id('player-name').addEventListener('input', () => {
    const n = $id('player-name').value.trim();
    $id('lobby-returning-info').style.display = 'none';
    if (n.length >= 2) socket.emit('get_player_info', { name: n, token: MY_TOKEN });
  });

  $id('btn-join').addEventListener('click', doJoin);
  $id('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') doJoin();
  });

  $id('btn-game-start').addEventListener('click', () => socket.emit('start_game', {}));

  $id('btn-reset-room').addEventListener('click', () => {
    if (confirm('⚠️ Reset toàn bộ phòng? Tất cả người chơi sẽ bị đưa về lobby và mọi dữ liệu sẽ bị xóa.')) {
      socket.emit('reset_room');
    }
  });

  // Player controls
  $id('btn-stand-up').addEventListener('click', () => {
    if (confirm('Bạn muốn đứng lên và vào chế độ xem?')) socket.emit('stand_up');
  });
  $id('btn-leave').addEventListener('click', () => {
    if (confirm('Bạn có chắc muốn thoát ra khỏi phòng?')) {
      _voluntaryLeave = true;
      socket.emit('leave_room');
    }
  });
  $id('btn-sit-down').addEventListener('click', () => socket.emit('sit_down'));

  // Action buttons
  $id('btn-fold') .addEventListener('click', () => sendAction('fold'));
  $id('btn-check').addEventListener('click', () => sendAction('check'));
  $id('btn-call') .addEventListener('click', () => sendAction('call'));
  $id('btn-allin').addEventListener('click', () => sendAction('allin'));
  $id('btn-raise').addEventListener('click', () => {
    const area = $id('raise-area');
    area.style.display = area.style.display === 'none' ? 'block' : 'none';
  });
  $id('btn-raise-confirm').addEventListener('click', () => {
    const amt = parseInt($id('raise-amount').value, 10) || 0;
    sendAction('raise', amt);
    $id('raise-area').style.display = 'none';
  });
});

function doJoin() {
  const name = ($id('player-name').value || '').trim();
  if (!name) { $id('player-name').focus(); return; }
  const btn = $id('btn-join');
  if (btn && btn.dataset.nameInUse) {
    const el = $id('lobby-returning-info');
    if (el) { el.style.display = 'block'; el.className = 'returning-broke';
      el.textContent = `🚫 Tên "${name}" đang có người dùng trong phòng. Hãy chọn tên khác.`; }
    return;
  }
  MY_NAME = name;
  localStorage.setItem('poker_name', name);
  $id('btn-join').disabled    = true;
  $id('player-name').disabled = true;
  $id('lobby-returning-info').style.display = 'none';
  socket.emit('join_game', { name, token: MY_TOKEN });
}

/* ══════════════════ SOCKET EVENTS ═════════════════════════════ */

socket.on('connected', data => {
  MY_SID = data.sid;
});

socket.on('player_info', data => {
  const el  = $id('lobby-returning-info');
  const btn = $id('btn-join');
  if (!el) return;

  if (data.inUse) {
    el.style.display = 'block';
    el.className = 'returning-broke';
    el.textContent = `🚫 Tên "${data.name}" đang có người dùng trong phòng. Hãy chọn tên khác.`;
    if (btn) btn.dataset.nameInUse = '1';
    return;
  }

  if (btn) delete btn.dataset.nameInUse;

  if (data.known) {
    el.style.display = 'block';
    if (data.chips > 0) {
      el.className = 'returning-ok';
      el.textContent = `✅ Chào mừng trở lại, ${data.name}! Số tiền hiện tại: $${data.chips}`;
    } else {
      el.className = 'returning-broke';
      el.textContent = `⚠️ Tài khoản “${data.name}” đã hết tiền. Hãy đổi tên khác để chơi lại.`;
    }
  } else {
    el.style.display = 'none';
  }
});

socket.on('join_rejected', data => {
  // Re-enable join form and show message
  $id('btn-join').disabled    = false;
  $id('player-name').disabled = false;
  const el = $id('lobby-returning-info');
  if (el) {
    el.style.display = 'block';
    el.className = 'returning-broke';
    el.textContent = `❌ ${data.msg}`;
  }
});

socket.on('joined', data => {
  MY_ROLE        = data.role;
  MY_SEAT        = data.seat;
  IS_HOST        = data.isHost === true;
  IS_SUPER_ADMIN = (MY_NAME.toLowerCase() === 'lamisreal');
  uiHideLobby(data.role);
  // If state was already received before this event, update sit-down button now
  if (data.role === 'spectator' && _lastState) {
    _updateSitDownBtn(_lastState);
  }
});

socket.on('game_state', state => {
  // Always sync host / super-admin status from server
  IS_HOST       = (state.hostSid === MY_SID);
  IS_SUPER_ADMIN = (state.superAdminSid === MY_SID);
  _lastState = state;
  renderState(state);
});

socket.on('stood_up', () => {
  // We are now a spectator
  MY_ROLE = 'spectator';
  MY_SEAT = null;
  $id('player-controls').style.display  = 'none';
  $id('start-banner').style.display     = 'none';
  $id('action-buttons').style.display   = 'none';
  $id('action-info').style.display      = 'none';
  $id('raise-area').style.display       = 'none';
  $id('spectator-banner').style.display = 'flex';
  uiDisableActions();
  // Update sit-down button using cached state (server will also broadcast state)
  if (_lastState) _updateSitDownBtn(_lastState);
});

socket.on('kicked', () => {
  // Leave room – go back to lobby
  const wasVoluntary = _voluntaryLeave;
  _voluntaryLeave = false;
  MY_ROLE = null; MY_SEAT = null; IS_HOST = false;
  $id('app').style.display   = 'none';
  $id('lobby').style.display = 'flex';
  $id('btn-join').disabled    = false;
  $id('player-name').disabled = false;
  const savedName = localStorage.getItem('poker_name') || '';
  $id('player-name').value = savedName;
  const el = $id('lobby-returning-info');
  if (el) {
    el.style.display = 'block';
    el.className = 'returning-broke';
    el.textContent = wasVoluntary
      ? '👋 Bạn đã ra khỏi phòng.'
      : '⚠️ Bạn đã bị đuổi ra khỏi phòng bởi quản trị viên.';
  }
  $id('lobby-hint').textContent = '';
});

socket.on('your_turn', data => {
  CALL_AMT = data.callAmount;
  // Monte Carlo equity for own hole cards
  const me = state_players_by_seat[MY_SEAT];
  if (me && me.holeCards && me.holeCards[0] !== null) {
    const hc   = me.holeCards.map(cd => new Card(cd.rank, cd.suit));
    const comm = (_currentCommunity || []).map(cd => new Card(cd.rank, cd.suit));
    EQUITY_VAL = monteCarloEquity(hc, comm, _currentPlayerCount || 2, 400);
  } else {
    EQUITY_VAL = 0;
  }
  uiEnableActions(data.canCheck, CALL_AMT, EQUITY_VAL, BIG_BLIND);
});

socket.on('turn_changed', data => {
  // Highlight which seat is acting
  uiHighlightActive(data.seat);
  // If it's not our turn, disable buttons
  if (data.seat !== MY_SEAT) uiDisableActions();
});

socket.on('action_log', data => {
  addLog(data.msg, data.seat);
});

socket.on('new_hand', data => {
  _stopCountdown();
  _stopTurnTimer();
  uiSetPhase('Pre-Flop');
  $id('hand-label').textContent = `Hand #${data.handNum}`;
  uiClearCommunity();
  uiSetStatus(MY_SEAT ?? 0, '');
  for (let i = 0; i < 6; i++) uiSetStatus(i, '');
});

socket.on('hand_ended', data => {
  _stopTurnTimer();
  uiShowMessage(`🏆 ${data.winner} wins!`, `Pot: $${data.pot}`, null);
  uiDisableActions();
});

socket.on('showdown', data => {
  // Build mini card HTML
  function sdCard(c, extraClass) {
    if (!c || c.rank == null) return '<div class="sd-card sd-back"></div>';
    const red = c.isRed ? 'sd-red' : 'sd-black';
    const suitMap = {'\u2665':'\u2665','\u2666':'\u2666','\u2660':'\u2660','\u2663':'\u2663'};
    const s = suitMap[c.suit] || c.suit;
    return `<div class="sd-card ${red}${extraClass?' '+extraClass:''}"><span class="sd-rank">${c.rank}</span><span class="sd-suit">${s}</span></div>`;
  }

  // Community cards row (5 board cards)
  const communityHtml = (data.community || []).map(c => sdCard(c, 'sd-community')).join('');
  const communityRow  = communityHtml
    ? `<div class="sd-community-row">${communityHtml}</div>`
    : '';

  // Only show winners
  const winners  = data.results.filter(r => r.is_winner);
  const potTotal = data.results.reduce((a, r) => a + (r.won || 0), 0);

  const rows = winners.map(r => {
    const cards = r.hole_cards.map(c => sdCard(c)).join('');
    return `
      <div class="sd-row sd-winner-row">
        <div class="sd-left">
          <span class="sd-icon">\ud83c\udfc6</span>
          <span class="sd-name">${r.name}</span>
          <span class="sd-hand">${r.hand_name}</span>
        </div>
        <div class="sd-cards">${cards}</div>
        <div class="sd-won">+$${r.won}</div>
      </div>`;
  }).join('');

  const body = `${communityRow}<div class="sd-pot-line">\ud83c\udfb0 Pot: <b>$${potTotal}</b></div>${rows}`;
  _stopTurnTimer();
  uiShowMessage('\ud83c\udfc6 Showdown', body, null, 'showdown');
  uiDisableActions();
  // Reveal cards on table
  for (const r of data.results) {
    uiRevealHole(r.seat, r.hole_cards);
    if (r.is_winner) {
      document.getElementById(`seat-${r.seat}`)?.classList.add('winner');
    } else {
      document.getElementById(`seat-${r.seat}`)?.classList.add('loser');
    }
  }
});

socket.on('error', data => {
  addLog(`⚠️ ${data.msg}`, null);
});

socket.on('countdown_start', data => {
  _startCountdown(data.seconds || 10);
});

socket.on('countdown_cancel', () => {
  _stopCountdown();
});

socket.on('room_reset', () => {
  // Server wiped the room – bring everyone back to a clean lobby
  _stopCountdown();
  MY_ROLE = null; MY_SEAT = null; IS_HOST = false; IS_SUPER_ADMIN = false;
  _lastState = null; _voluntaryLeave = false;
  $id('app').style.display   = 'none';
  $id('lobby').style.display = 'flex';
  $id('btn-join').disabled    = false;
  $id('player-name').disabled = false;
  $id('btn-reset-room').style.display = 'none';
  const savedName = localStorage.getItem('poker_name') || '';
  $id('player-name').value = savedName;
  const el = $id('lobby-returning-info');
  if (el) {
    el.style.display = 'block';
    el.className     = 'returning-broke';
    el.textContent   = '🔄 Phòng đã được reset. Hãy tham gia lại!';
  }
  $id('lobby-hint').textContent = '';
});

/* ══════════════════ RENDER STATE ══════════════════════════════ */

function _updateSitDownBtn(state) {
  const canSit = MY_ROLE === 'spectator' && state.activeSeats < 6 && state.phase === 'waiting';
  $id('btn-sit-down').style.display = canSit ? 'inline-block' : 'none';
}

function _startCountdown(secs) {
  _stopCountdown();
  _countdownVal = secs;
  const secsEl = $id('countdown-secs');
  const barEl  = $id('countdown-bar');
  const wrap   = $id('full-table-countdown');
  wrap.style.display = 'flex';
  secsEl.textContent = _countdownVal;
  if (barEl) barEl.style.width = '100%';
  _countdownInterval = setInterval(() => {
    _countdownVal--;
    secsEl.textContent = Math.max(_countdownVal, 0);
    if (barEl) barEl.style.width = `${(_countdownVal / secs) * 100}%`;
    if (_countdownVal <= 0) _stopCountdown();
  }, 1000);
}

function _stopCountdown() {
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
  const wrap = $id('full-table-countdown');
  if (wrap) wrap.style.display = 'none';
}

let _currentCommunity   = [];
let _currentPlayerCount = 2;
const state_players_by_seat = {};  // seat -> player data (updated each render)

function resetAllSeats() {
  for (let i = 0; i < 6; i++) {
    const seatEl = $id(`seat-${i}`);
    if (!seatEl) continue;

    // Remove kick buttons
    seatEl.querySelectorAll('.kick-btn-super').forEach(b => b.remove());
    // Reset classes
    seatEl.classList.remove('active-player', 'folded', 'winner', 'loser');
    // Name → default "Ghế X"
    const nameEl = $id(`name-${i}`) || seatEl.querySelector('.player-name');
    if (nameEl) nameEl.textContent = `Ghế ${i}`;
    // Chips / bet / status → blank
    const chipsEl = $id(`chips-${i}`);
    if (chipsEl) chipsEl.textContent = '';
    const betEl = $id(`bet-${i}`);
    if (betEl) betEl.textContent = '';
    uiSetStatus(i, '');
    uiClearHole(i);
    // Dealer button
    const dealerEl = $id(`dealer-${i}`);
    if (dealerEl) dealerEl.style.display = 'none';
  }
}

function renderState(state) {
  resetAllSeats();

  _currentCommunity   = state.community;
  _currentPlayerCount = state.players.filter(p => !p.folded && p.active).length;

  // Cache player data by seat for equity calc
  for (let k in state_players_by_seat) delete state_players_by_seat[k];
  for (const p of state.players) state_players_by_seat[p.seat] = p;

  uiSetCommunity(state.community.map(c => new Card(c.rank, c.suit)));
  uiUpdatePot(state.pot);
  uiSetPhase(state.phase.toUpperCase());
  uiShowDealer(state.dealer);

  // Update each seat
  for (const p of state.players) {
    const si = p.seat;
    $id(`chips-${si}`).textContent = fmt(p.chips);
    $id(`bet-${si}`  ).textContent = p.roundBet > 0 ? `Bet: $${p.roundBet}` : '';

    const nameBadge = p.sid === state.hostSid ? ' ♕' : '';
    const meBadge   = p.seat === MY_SEAT      ? ' (Bạn)' : '';
    const nameEl = $id(`name-${si}`) || $id(`seat-${si}`)?.querySelector('.player-name');
    if (nameEl) nameEl.textContent = p.name + meBadge + nameBadge;

    uiSetFolded(si, p.folded);

    if (p.holeCards && p.cardCount > 0) {
      if (p.holeCards[0] !== null) {
        uiRevealHole(si, p.holeCards.map(c => new Card(c.rank, c.suit)));
      } else {
        const wrap = $id(`hole-${si}`);
        if (wrap) {
          wrap.innerHTML = '';
          for (let i = 0; i < p.cardCount; i++) wrap.appendChild(cardEl(null, true));
        }
      }
    } else if (state.phase === 'waiting') {
      uiClearHole(si);
    }

    if (!p.active) {
      uiSetStatus(si, 'Thua', 'busted');
    } else if (p.willStandUp) {
      uiSetStatus(si, 'Đứng lên sau tay…', 'standing-up-status');
    } else if (p.folded) {
      uiSetStatus(si, 'Bỏ bài', 'folded-status');
    } else if (p.isAllIn) {
      uiSetStatus(si, 'ALL-IN', 'allin-status');
    } else {
      uiSetStatus(si, '');
    }

    if (p.isCurrentTurn) uiHighlightActive(si);
  }
  if (!state.players.some(p => p.isCurrentTurn)) uiHighlightActive(-1);

  // ─ Super-admin kick buttons ─
  for (const p of state.players) {
    const si = p.seat;
    const seatEl = $id(`seat-${si}`);
    if (!seatEl) continue;
    // Remove existing kick btn if any
    const existing = seatEl.querySelector('.kick-btn-super');
    if (existing) existing.remove();
    // Add kick btn for other players when I am super admin
    if (IS_SUPER_ADMIN && p.sid !== MY_SID && p.active) {
      const kickBtn = document.createElement('button');
      kickBtn.className  = 'kick-btn-super';
      kickBtn.textContent = '🥾 Kick';
      kickBtn.title       = `Kick ${p.name}`;
      kickBtn.addEventListener('click', () => {
        if (confirm(`Kick ${p.name} ra khỏi phòng?`)) {
          socket.emit('kick_player', { sid: p.sid });
        }
      });
      seatEl.appendChild(kickBtn);
    }
  }
  if (MY_ROLE === 'player') {
    $id('player-controls').style.display = 'flex';

    // Start banner: only show in waiting phase
    if (state.phase === 'waiting') {
      $id('start-banner').style.display = 'flex';
      const canAct   = IS_HOST || IS_SUPER_ADMIN;
      const showStart = canAct && state.canStart;
      $id('btn-game-start').style.display = showStart ? 'inline-block' : 'none';
      $id('start-hint').style.display     = showStart ? 'none' : 'inline';
      $id('start-hint').textContent = canAct
        ? (state.canStart ? '' : 'Cần ít nhất 2 người.')
        : 'Chờ đội trưởng bắt đầu…';
    } else {
      $id('start-banner').style.display = 'none';
    }
  }

  // ─ Spectator controls ─
  _updateSitDownBtn(state);

  // ─ Sync countdown (handles page-reload / late-join) ─
  if (state.countdownActive && !_countdownInterval) _startCountdown(10);
  if (!state.countdownActive) _stopCountdown();

  uiUpdateLobbyList(state);
}

/* ══════════════════ ACTIONS ═══════════════════════════════════ */

function sendAction(action, amount = 0) {
  uiDisableActions();
  socket.emit('player_action', { action, amount });
}

/* ══════════════════ LOBBY UI ══════════════════════════════════ */

function uiHideLobby(role) {
  $id('lobby').style.display = 'none';
  $id('app').style.display   = 'block';

  if (role === 'spectator') {
    $id('spectator-banner').style.display = 'flex';
    $id('action-buttons').style.display   = 'none';
    $id('action-info').style.display      = 'none';
    $id('player-controls').style.display  = 'none';
  } else {
    $id('spectator-banner').style.display = 'none';
    $id('player-controls').style.display  = 'flex';
    // Restore these in case they were hidden by a previous stood_up event
    $id('action-buttons').style.display   = 'flex';
    $id('action-info').style.display      = 'flex';
    uiDisableActions();
  }
}

function uiUpdateLobbyList(state) {
  const ul   = $id('lobby-player-list');
  const sul  = $id('lobby-spectator-list');
  const sbox = $id('lobby-spectators');

  if (!ul) return;

  // Players
  const activePlayers = state.players.filter(p => p.active);
  ul.innerHTML = activePlayers.map(p =>
    `<li class="${p.sid === MY_SID ? 'me' : ''}">${p.name} – $${p.chips}</li>`
  ).join('');

  // Spectators
  if (state.spectators && state.spectators.length > 0) {
    sbox.style.display = 'block';
    sul.innerHTML = state.spectators.map(s => `<li>${s.name}</li>`).join('');
  } else {
    sbox.style.display = 'none';
  }
}

/* ══════════════════ LOG ════════════════════════════════════════ */

function addLog(msg, seat) {
  const body = $id('log-body');
  if (!body) return;
  const d = document.createElement('div');
  d.className = 'log-entry';
  d.innerHTML = msg;
  body.prepend(d);
  // Keep max 60 entries
  while (body.children.length > 60) body.removeChild(body.lastChild);
}

/* ══════════════════ CSS helpers for showdown text ══════════════ */
const style = document.createElement('style');
style.textContent = `
  .red-txt  { color: #e04040; }
  .blk-txt  { color: #ddd; }
  .winner-row { font-weight: bold; color: var(--gold, #d4a843); }
  .won-lbl  { color: #4caf50; margin-left: 8px; }
  .busted { color: #888; }
  .folded-status { color: #aaa; }
  .allin-status { color: #e0a040; }
  .seat.winner { box-shadow: 0 0 0 4px #4caf50, 0 0 20px rgba(76,175,80,.6); }
  .kick-btn-super {
    position: absolute; top: 4px; right: 4px;
    font-size: 10px; padding: 2px 5px;
    background: #c0392b; color: #fff; border: none;
    border-radius: 4px; cursor: pointer; opacity: 0.85;
    z-index: 10;
  }
  .kick-btn-super:hover { opacity: 1; }
  #lobby-returning-info {
    font-size: 13px; margin: 6px 0 0; padding: 6px 10px;
    border-radius: 6px; text-align: center;
  }
  .returning-ok   { background: rgba(76,175,80,.18); color: #81c784; }
  .returning-broke{ background: rgba(220,53,69,.18);  color: #e57373; }
  #full-table-countdown {
    display: none; align-items: center; flex-direction: column; gap: 6px;
    padding: 8px 18px; background: rgba(212,168,67,.15);
    border: 1px solid rgba(212,168,67,.4); border-radius: 8px;
    color: #f0d080; font-weight: 600; font-size: 15px;
    text-align: center;
  }
  #countdown-bar-wrap {
    width: 220px; height: 6px; background: rgba(255,255,255,.15);
    border-radius: 3px; overflow: hidden;
  }
  #countdown-bar {
    height: 100%; width: 100%;
    background: linear-gradient(90deg, #d4a843, #f0e06a);
    border-radius: 3px;
    transition: width 0.9s linear;
  }
  #countdown-secs { color: #ffe066; font-size: 18px; font-weight: 700; }
`;
document.head.appendChild(style);
