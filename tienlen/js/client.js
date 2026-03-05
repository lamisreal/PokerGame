'use strict';
/* ══════════════════════════════════════════════════════════
   Tiến Lên – client.js
   Connects to SocketIO namespace /tienlen
   ══════════════════════════════════════════════════════════ */

const socket = io('/tienlen');

/* ── State ─────────────────────────────────────────────── */
let MY_SID          = null;
let MY_SEAT         = null;
let MY_ROLE         = null;   // 'player' | 'spectator'
let MY_NAME         = '';
let IS_HOST         = false;
let IS_SUPER_ADMIN  = false;
let LAST_STATE      = null;
let LAST_SCORING    = null;   // cached last round's scoring data
let ROUND_HISTORY    = [];     // full history [{round, players:[{name,change}]}]
let MY_SEAT_OFFSET   = 0;      // how many seats we rotate so "me" is at bottom
let SELECTED_VALUES  = new Set();  // values of cards currently selected
/* -- Trick history (last 3 plays shown on table) ---------- */
let TRICK_HISTORY        = [];    // [{cards, comboType}] index-0 = most recent past, max 3
let _prevTrickKey        = '';    // fingerprint of the trick currently being shown
let _prevTrickData       = null;  // {cards, comboType} kept so we can push it on change
let LAST_RENDERED_ROUND  = 0;     // detect round changes → clear history

/* ── Helpers ────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const ce = (tag, cls='', html='') => {
  const el = document.createElement(tag);
  if (cls)  el.className   = cls;
  if (html) el.innerHTML   = html;
  return el;
};

/* ── Device token ───────────────────────────────────────── */
function _token() {
  let t = localStorage.getItem('tl_token');
  if (!t) {
    t = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,
      c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
    localStorage.setItem('tl_token', t);
  }
  return t;
}
const MY_TOKEN = _token();

/* ══════════════════ LOBBY ══════════════════════════════════ */

// Connection status helpers
function _setConnStatus(connected) {
  const btn = $('btn-join');
  const inf = $('lobby-info');
  if (!btn || !inf) return;   // DOM not ready yet
  if (connected) {
    btn.disabled = false;
    btn.textContent = 'Vào bàn';
    if (inf.dataset.connErr) { inf.textContent = ''; delete inf.dataset.connErr; }
  } else {
    btn.disabled = true;
    btn.textContent = 'Đang kết nối…';
    inf.textContent = '⚠️ Đang kết nối đến server…';
    inf.dataset.connErr = '1';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('tl_name') || '';
  if (saved) $('player-name').value = saved;

  // Start with button disabled until socket connects
  _setConnStatus(false);

  $('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGame();
  });
  $('btn-join').addEventListener('click', joinGame);
  $('btn-game-start').addEventListener('click', () => socket.emit('tl_start'));
  $('btn-leave').addEventListener('click', () => {
    if (confirm('Rời bàn chơi?')) socket.emit('tl_leave');
  });
  $('btn-sit-down').addEventListener('click', () => socket.emit('tl_sit_down'));
  $('btn-pass').addEventListener('click', doPass);
  $('btn-play').addEventListener('click', doPlay);
  $('btn-score-ok').addEventListener('click', () => { $('score-overlay').style.display = 'none'; });
  $('btn-view-scores').addEventListener('click', _showRoundHistory);
  $('btn-history-close').addEventListener('click', () => { $('history-overlay').style.display = 'none'; });
  $('msg-ok').addEventListener('click', () => { $('msg-overlay').style.display = 'none'; });
  $('btn-reset-room').addEventListener('click', () => {
    if (confirm('Reset toàn bộ phòng?')) socket.emit('tl_reset_room');
  });
  $('btn-reset-scores').addEventListener('click', () => {
    if (confirm('Reset bảng điểm tất cả về 0?')) socket.emit('tl_reset_scores');
  });

  // Socket may have already connected before DOMContentLoaded fired – sync now
  _setConnStatus(socket.connected);
});

function joinGame() {
  const name = $('player-name').value.trim();
  if (!name) { $('lobby-info').textContent = '⚠️ Vui lòng nhập tên.'; return; }
  if (!socket.connected) {
    $('lobby-info').textContent = '⚠️ Chưa kết nối server. Vui lòng chờ…';
    return;
  }

  // Client-side duplicate name check against current room occupants
  if (LAST_STATE) {
    const nameLower = name.toLowerCase();
    const allNames = [
      ...(LAST_STATE.players    || []).map(p => (p.name || '').toLowerCase()),
      ...(LAST_STATE.spectators || []).map(s => (s.name || '').toLowerCase()),
    ];
    if (allNames.includes(nameLower)) {
      $('lobby-info').textContent = `⚠️ Tên "${name}" đã có người dùng trong phòng. Vui lòng chọn tên khác.`;
      return;
    }
  }

  MY_NAME = name;
  localStorage.setItem('tl_name', name);
  $('btn-join').disabled = true;
  $('btn-join').textContent = 'Đang vào…';
  socket.emit('tl_join', { name, token: MY_TOKEN });
}

/* ══════════════════ SOCKET EVENTS ══════════════════════════ */

socket.on('connect', () => {
  MY_SID = socket.id;
  _setConnStatus(true);
  _log('✅ Kết nối thành công.');
  if (MY_NAME) socket.emit('tl_join', { name: MY_NAME, token: MY_TOKEN });
});

socket.on('connect_error', err => {
  _setConnStatus(false);
  _log('❌ Không thể kết nối server: ' + err.message);
});

socket.on('disconnect', reason => {
  _setConnStatus(false);
  _log('⚠️ Mất kết nối: ' + reason);
});

socket.on('reconnect', () => {
  _setConnStatus(true);
  if (MY_NAME) socket.emit('tl_join', { name: MY_NAME, token: MY_TOKEN });
});

socket.on('tl_joined', data => {
  MY_ROLE  = data.role;
  MY_SEAT  = data.seat;
  MY_NAME  = data.name;
  IS_HOST  = data.isHost;
  IS_SUPER_ADMIN = (data.name || '').toLowerCase() === 'lamisreal';

  $('lobby').style.display = 'none';
  $('app').style.display   = 'flex';
  $('app').style.flexDirection = 'column';

  // Re-enable join button for future use
  $('btn-join').disabled    = false;
  $('btn-join').textContent = 'Vào bàn';

  // Role-specific UI (mirror Poker's uiHideLobby)
  if (data.role === 'spectator') {
    $('spectator-banner').style.display = 'flex';
    $('action-buttons').style.display   = 'none';
    $('player-controls').style.display  = 'none';
    $('start-banner').style.display     = 'none';
  } else {
    $('spectator-banner').style.display = 'none';
    $('player-controls').style.display  = 'flex';
  }

  _log(`🎮 Xin chào ${MY_NAME}! ${MY_ROLE === 'player' ? `Ghế ${MY_SEAT}` : 'Đang xem'}`);
});

socket.on('tl_error', data => {
  $('lobby-info').textContent = '⚠️ ' + (data.msg || 'Lỗi không xác định.');
  $('btn-join').disabled    = false;
  $('btn-join').textContent = 'Vào bàn';
});

socket.on('tl_join_rejected', data => {
  const msg = data.msg || 'Lỗi không xác định.';
  $('lobby-info').textContent = '⚠️ ' + msg;
  // Re-enable the join button so the user can try a different name
  $('btn-join').disabled = false;
  $('btn-join').textContent = 'Vào bàn';
  MY_NAME = '';
});

socket.on('tl_kicked', () => {
  _showMsg('Bị đuổi', 'Bạn đã bị đuổi khỏi phòng.');
  setTimeout(() => location.reload(), 2000);
});

socket.on('tl_room_reset', () => {
  _stopCountdown();
  _showMsg('Phòng đã reset', 'Phòng đã được reset. Vui lòng tham gia lại.');
  setTimeout(() => location.reload(), 2500);
});

socket.on('tl_game_state', data => {
  LAST_STATE = data;
  // If dealing overlay is still showing, wait for it then render
  if ($('deal-overlay') && $('deal-overlay').style.display !== 'none') {
    _hideDealOverlay(() => _renderState(data));
  } else {
    _renderState(data);
  }
});

socket.on('tl_dealing', data => {
  _showDealOverlay(data.roundNum);
});

socket.on('tl_log', data => _log(data.msg, data.highlight, data.penalty));

socket.on('tl_your_turn', data => {
  _log(`⚡ Đến lượt bạn!`, true);
  _enableActions(data.canPass, data.freePlay);
});

socket.on('tl_turn_changed', data => {
  // handled via tl_turn_timer below
});

socket.on('tl_turn_timer', data => {
  // Start visual countdown on the seat whose turn it now is
  _startCountdown(data.seat, data.seconds || 30);
});

socket.on('tl_scoring', data => {
  LAST_SCORING = data;
  _stopCountdown();
  _showScoring(data);
  if ($('btn-view-scores')) $('btn-view-scores').style.display = 'inline-block';
});

socket.on('tl_round_history', data => {
  ROUND_HISTORY = data.history || [];
  if ($('btn-view-scores'))
    $('btn-view-scores').style.display = ROUND_HISTORY.length > 0 ? 'inline-block' : 'none';
});

socket.on('tl_instant_win', data => {
  const list = (data.instant_wins || [])
    .map(w => `<b>${w.name}</b>: ${w.reason}`)
    .join('<br>');
  _showMsg('🎉 Thắng trắng!', list || 'Ai đó thắng trắng!');
});

socket.on('tl_stood_up', () => {
  MY_ROLE = 'spectator';
  MY_SEAT = null;
  $('spectator-banner').style.display = 'flex';
  $('action-buttons').style.display   = 'none';
  $('player-controls').style.display  = 'none';
  $('start-banner').style.display     = 'none';
});

/* ══════════════════ RENDER STATE ══════════════════════════ */

function _renderState(s) {
  // Clear trick history whenever the round number increments
  if (s.roundNum !== LAST_RENDERED_ROUND) {
    TRICK_HISTORY   = [];
    _prevTrickKey   = '';
    _prevTrickData  = null;
    LAST_RENDERED_ROUND = s.roundNum;
  }

  // Phase badge
  const phaseName = {waiting:'Chờ', playing:'Đang chơi', scoring:'Tính điểm'};
  $('phase-badge').textContent = phaseName[s.phase] || s.phase;
  $('round-label').textContent = `Vòng ${s.roundNum}`;

  // My seat offset: figure out which display seat index corresponds to each actual seat
  // so that MY_SEAT always appears at display position 0 (bottom)
  const myPlayer = s.players.find(p => p.sid === MY_SID);
  if (myPlayer && myPlayer.seat !== null) {
    MY_SEAT        = myPlayer.seat;
    MY_SEAT_OFFSET = MY_SEAT;
  }

  // Update each seat UI
  for (let disp = 0; disp < 4; disp++) {
    const actualSeat = (disp + MY_SEAT_OFFSET) % 4;
    const p = s.players.find(pl => pl.seat === actualSeat);
    _renderSeat(disp, p, s);
  }

  // Trick
  _renderTrick(s);

  // My hand
  const me = s.players.find(p => p.sid === MY_SID);
  if (me && me.hand && me.hand.length > 0 && me.hand[0] !== null) {
    _renderMyHand(me.hand);
    $('my-card-count').textContent = `(${me.hand.length} lá)`;
  } else {
    if (!me) {
      $('my-hand').innerHTML = '';
      $('my-card-count').textContent = '';
    }
  }

  // Action bar visibility
  const isPlayer    = MY_ROLE === 'player';
  const isSpectator = MY_ROLE === 'spectator';

  $('spectator-banner').style.display = isSpectator ? 'flex' : 'none';
  // Show sit-down only when waiting-phase and table isn't full
  const tableNotFull = (s.players || []).filter(p => p.active).length < 4;
  $('btn-sit-down').style.display = (isSpectator && s.phase === 'waiting' && tableNotFull)
      ? 'inline-block' : 'none';
  // Spectator banner message
  if (isSpectator) {
    const spanEl = $('spectator-banner').querySelector('span');
    if (spanEl) {
      spanEl.textContent = s.phase === 'playing'
          ? '👁 Đang xem ván • chờ vòng sau để vào bàn'
          : '👁 Bạn đang xem';
    }
  }
  $('start-banner').style.display     = (isPlayer && s.phase === 'waiting' && IS_HOST) ? 'flex' : 'none';
  $('start-hint').textContent         = s.canStart ? 'Đủ người, sẵn sàng bắt đầu!' : 'Cần ít nhất 2 người.';
  $('action-buttons').style.display   = (isPlayer && s.phase === 'playing') ? 'flex' : 'none';
  $('player-controls').style.display  = isPlayer ? 'flex' : 'none';

  // Admin / richest-player buttons
  $('btn-reset-room').style.display   = IS_SUPER_ADMIN ? 'inline-block' : 'none';
  $('btn-reset-scores').style.display = (s.canResetScoresSid === MY_SID) ? 'inline-block' : 'none';
  $('btn-view-scores').style.display  = ROUND_HISTORY.length > 0 ? 'inline-block' : 'none';

  // Host badge
  if (s.hostSid) {
    const hostP = s.players.find(p => p.sid === s.hostSid);
    IS_HOST = (s.hostSid === MY_SID);
    $('start-banner').style.display = (IS_HOST && s.phase === 'waiting') ? 'flex' : 'none';
  }

  // Lobby list – players
  {
    const ul   = $('lobby-player-list');
    const sbox = $('lobby-spectators');
    const sul  = $('lobby-spectator-list');
    if (ul) {
      ul.innerHTML = (s.players || []).map(p =>
        `<li class="${p.sid === MY_SID ? 'me' : ''}">${p.name} <span style="color:var(--gold)">[${p.score}\u0111]</span></li>`
      ).join('');
    }
    // Spectator list (always visible, helps waiting users see room state)
    if (sbox && sul) {
      const specs = s.spectators || [];
      if (specs.length > 0) {
        sbox.style.display = 'block';
        sul.innerHTML = specs.map(sp =>
          `<li class="${sp.sid === MY_SID ? 'me' : ''}">👁 ${sp.name}</li>`
        ).join('');
      } else {
        sbox.style.display = 'none';
      }
    }
  }
  // Disable play/pass if not my turn; re-sync if it IS my turn
  if (s.phase === 'playing') {
    const myTurn = (s.currentSeat === MY_SEAT);
    if (!myTurn) {
      $('btn-play').disabled = true;
      $('btn-pass').disabled = true;
    } else {
      // It's my turn – sync play button with current selection, set pass correctly
      _updatePlayButton();
      $('btn-pass').disabled = (s.trickType === null);  // can't pass on free play
    }
  }
}

function _renderSeat(dispIdx, p, s) {
  const seatEl    = $(`seat-${dispIdx}`);
  const nameEl    = $(`name-${dispIdx}`);
  const scoreEl   = $(`score-${dispIdx}`);
  const cardsEl   = $(`cards-count-${dispIdx}`);
  const statusEl  = $(`status-${dispIdx}`);
  const finishEl  = $(`finish-${dispIdx}`);

  seatEl.classList.remove('active-turn', 'trick-leader', 'finished');

  if (!p) {
    nameEl.textContent   = '—';
    scoreEl.textContent  = '';
    cardsEl.textContent  = '';
    statusEl.textContent = '';
    finishEl.style.display = 'none';
    return;
  }

  nameEl.textContent  = p.name + (p.sid === MY_SID ? ' (bạn)' : '');
  scoreEl.textContent = `${p.score >= 0 ? '+' : ''}${p.score}đ`;
  cardsEl.textContent = `${p.cardCount} lá`;

  // Finish rank badge
  if (p.finishRank) {
    seatEl.classList.add('finished');
    const labels = ['', '🥇 Nhất', '🥈 Nhì', '🥉 Ba', 'Bét 😢'];
    finishEl.textContent      = labels[p.finishRank] || `#${p.finishRank}`;
    finishEl.className        = `finish-badge finish-${p.finishRank}`;
    finishEl.style.display    = 'inline-block';
  } else {
    finishEl.style.display = 'none';
  }

  // Status
  if (p.passed) {
    statusEl.textContent = '🚫 Bỏ qua';
  } else {
    statusEl.textContent = '';
  }

  // Active turn indicator
  if (s.phase === 'playing' && s.currentSeat === p.seat) {
    seatEl.classList.add('active-turn');
    if (p.seat === MY_SEAT) statusEl.textContent = '⚡ Lượt bạn!';
    else statusEl.textContent = '⏳ Đang chơi…';
  }

  // Trick leader crown
  if (s.trickLeader === p.seat) {
    seatEl.classList.add('trick-leader');
  }
}

function _renderTrick(s) {
  const trickEl = $('trick-cards');
  const comboEl = $('trick-combo');

  // Fingerprint of incoming trick (order-stable: as dealt by server)
  const newKey = (s.trick || []).map(c => c.value).join('-');

  if (newKey !== _prevTrickKey) {
    // Trick changed – archive the old one into history (only if it had cards)
    if (_prevTrickData && _prevTrickData.cards.length > 0) {
      TRICK_HISTORY.unshift({ cards: _prevTrickData.cards, comboType: _prevTrickData.comboType });
      if (TRICK_HISTORY.length > 3) TRICK_HISTORY.length = 3;
    }
    _prevTrickKey  = newKey;
    _prevTrickData = { cards: s.trick ? [...s.trick] : [], comboType: s.trickType };
  }

  // Render current trick (or clear it)
  trickEl.innerHTML = '';
  if (s.trick && s.trick.length > 0) {
    s.trick.forEach(card => trickEl.appendChild(_makeCardEl(card)));
    const comboLabels = {
      single: 'Lẻ', pair: 'Đôi', triple: 'Ba cây',
      quad: 'Tứ quý', straight: 'Sảnh', pair_seq: 'Đôi thông',
    };
    comboEl.textContent = comboLabels[s.trickType] || s.trickType || '';
  } else {
    comboEl.textContent = '';
  }

  _renderTrickHistory();
}

/* Render up to 3 past trick groups in #trick-history.
   Oldest play is on the left, most-recent-past closest to current. */
function _renderTrickHistory() {
  const histEl = $('trick-history');
  if (!histEl) return;
  histEl.innerHTML = '';
  if (TRICK_HISTORY.length === 0) return;

  // Reverse so we iterate oldest → newest-past (left → right)
  const ordered = [...TRICK_HISTORY].reverse();
  ordered.forEach((entry, i) => {
    // age: 3=oldest, 1=most-recent-past
    const age  = ordered.length - i;   // e.g. for 3 entries: 3,2,1
    const wrap = document.createElement('div');
    wrap.className = `trick-past trick-past-${age}`;

    const cardsRow = document.createElement('div');
    cardsRow.className = 'trick-past-cards';
    (entry.cards || []).forEach(card => cardsRow.appendChild(_makeCardEl(card)));

    wrap.appendChild(cardsRow);
    histEl.appendChild(wrap);
  });
}

/* ── Card element factory ──────────────────────────────── */
function _makeCardEl(cardData, selectable=false) {
  const el = document.createElement('div');
  el.className = 'card ' + (cardData.isRed ? 'red' : 'black');
  el.dataset.value = cardData.value;

  const suitLabel = cardData.suit;
  const rankLabel = cardData.rank === 'T' ? '10' : cardData.rank;

  el.innerHTML = `
    <span class="c-rank">${rankLabel}</span>
    <span class="c-center">${suitLabel}</span>
    <span class="c-suit">${rankLabel}</span>`;

  if (selectable) {
    if (SELECTED_VALUES.has(cardData.value)) {
      el.classList.add('selected');
    }
    el.addEventListener('click', () => _toggleCard(el, cardData.value));
  }
  return el;
}

function _renderMyHand(cards) {
  const hand     = $('my-hand');
  const isMyTurn = LAST_STATE && LAST_STATE.phase === 'playing'
                   && LAST_STATE.currentSeat === MY_SEAT;
  hand.innerHTML = '';
  // Dim the whole hand when it's not my turn
  hand.classList.toggle('not-my-turn', !isMyTurn);
  cards.forEach((card, i) => {
    if (!card) return;
    const el = _makeCardEl(card, isMyTurn);  // only selectable on my turn
    el.style.animationDelay = `${i * 60}ms`;
    hand.appendChild(el);
  });
}

/* ── Card selection ─────────────────────────────────────── */

function _toggleCard(el, value) {
  if (SELECTED_VALUES.has(value)) {
    SELECTED_VALUES.delete(value);
    el.classList.remove('selected');
  } else {
    SELECTED_VALUES.add(value);
    el.classList.add('selected');
  }
  _updatePlayButton();
}

function _updatePlayButton() {
  const n = SELECTED_VALUES.size;
  $('selected-preview').textContent = n > 0 ? `${n} lá đã chọn` : '';
  // Enable play if it's actually my turn (server decides validity)
  const isMyTurn = LAST_STATE && LAST_STATE.currentSeat === MY_SEAT
                   && LAST_STATE.phase === 'playing';
  $('btn-play').disabled = !(isMyTurn && n > 0);
}

/* ── Actions ────────────────────────────────────────────── */

function _enableActions(canPass, freePlay) {
  $('btn-play').disabled  = SELECTED_VALUES.size === 0;
  $('btn-pass').disabled  = !canPass || freePlay;
}

function doPlay() {
  if (SELECTED_VALUES.size === 0) return;
  socket.emit('tl_play', { card_values: [...SELECTED_VALUES] });
  SELECTED_VALUES.clear();
  _updatePlayButton();
}

function doPass() {
  socket.emit('tl_pass');
}
/* ── Dealing overlay ────────────────────────────────────── */

let _dealTimer = null;
let _dealProgressInt = null;
let _dealHideCallback = null;
const DEAL_DURATION_MS = 1800; // total animation time

/* ── Turn countdown ───────────────────────────────────────── */
let _cdInterval   = null;   // tick interval
let _cdSecs       = 0;      // seconds remaining
let _cdTotalSecs  = 30;     // total turn duration
let _cdDispSeat   = null;   // display-seat index (0-3) currently showing ring

const CD_CIRCUMFERENCE = 2 * Math.PI * 15.9;  // r=15.9 matches SVG

function _startCountdown(serverSeat, totalSecs) {
  _stopCountdown();
  // Convert server seat → display seat
  const dispSeat = ((serverSeat - MY_SEAT_OFFSET) % 4 + 4) % 4;
  _cdDispSeat  = dispSeat;
  _cdTotalSecs = totalSecs;
  _cdSecs      = totalSecs;
  const cdEl  = $(`countdown-${dispSeat}`);
  if (!cdEl) return;
  cdEl.style.display = 'flex';
  _cdTick();
  _cdInterval = setInterval(_cdTick, 1000);
}

function _cdTick() {
  if (_cdDispSeat === null) return;
  const dispSeat = _cdDispSeat;
  const numEl = $(`cd-num-${dispSeat}`);
  const arcEl = $(`cd-arc-${dispSeat}`);
  if (!numEl || !arcEl) return;
  numEl.textContent = _cdSecs;
  // Stroke-dashoffset shrinks as time runs out
  const ratio  = _cdSecs / _cdTotalSecs;
  const offset = CD_CIRCUMFERENCE * (1 - ratio);
  arcEl.style.strokeDashoffset = offset;
  // Colour warning: yellow < 10s, red < 5s
  const cdEl = $(`countdown-${dispSeat}`);
  if (_cdSecs <= 5)       cdEl.classList.add('cd-urgent');
  else if (_cdSecs <= 10) cdEl.classList.add('cd-warn');
  if (_cdSecs <= 0) { _stopCountdown(); return; }
  _cdSecs--;
}

function _stopCountdown() {
  if (_cdInterval) { clearInterval(_cdInterval); _cdInterval = null; }
  if (_cdDispSeat !== null) {
    const cdEl = $(`countdown-${_cdDispSeat}`);
    if (cdEl) {
      cdEl.style.display = 'none';
      cdEl.classList.remove('cd-warn', 'cd-urgent');
    }
    _cdDispSeat = null;
  }
}

function _showDealOverlay(roundNum) {
  // Clear any previous timer
  if (_dealTimer) clearTimeout(_dealTimer);
  if (_dealProgressInt) clearInterval(_dealProgressInt);

  const overlay  = $('deal-overlay');
  const textEl   = $('deal-text');
  const bar      = $('deal-progress-bar');

  bar.style.width = '0%';
  textEl.textContent = `🃏 Đang xáo bài vòng ${roundNum}…`;
  overlay.style.display = 'flex';

  // Animate progress bar
  let elapsed = 0;
  const step  = 50;
  _dealProgressInt = setInterval(() => {
    elapsed += step;
    const pct = Math.min(100, (elapsed / DEAL_DURATION_MS) * 100);
    bar.style.width = pct + '%';
    if (elapsed >= DEAL_DURATION_MS * 0.5) {
      textEl.textContent = '✨ Đang chia bài…';
    }
    if (elapsed >= DEAL_DURATION_MS) {
      clearInterval(_dealProgressInt);
      _dealProgressInt = null;
    }
  }, step);

  // Auto-hide after DEAL_DURATION_MS if state hasn't arrived yet
  _dealHideCallback = null;
  _dealTimer = setTimeout(() => {
    _dealOverlayDone();
  }, DEAL_DURATION_MS + 200);
}

function _hideDealOverlay(callback) {
  // State arrived – store callback, let progress bar finish naturally
  _dealHideCallback = callback;
  // If bar already done, hide immediately
  if (!_dealProgressInt) {
    _dealOverlayDone();
  }
  // Otherwise the interval will fire _dealOverlayDone via the timer above
}

function _dealOverlayDone() {
  if (_dealTimer)       { clearTimeout(_dealTimer);       _dealTimer = null; }
  if (_dealProgressInt) { clearInterval(_dealProgressInt); _dealProgressInt = null; }
  $('deal-overlay').style.display = 'none';
  if (_dealHideCallback) { _dealHideCallback(); _dealHideCallback = null; }
}/* ── Round History overlay ─────────────────────────────────────────── */

function _showRoundHistory() {
  if (!ROUND_HISTORY.length) { _showMsg('ℹ️ Không có dữ liệu', 'Chưa có vòng nào được hoàn thành.'); return; }

  // Collect all unique player names in order of first appearance
  const playerNames = [];
  ROUND_HISTORY.forEach(round => {
    round.players.forEach(p => {
      if (!playerNames.includes(p.name)) playerNames.push(p.name);
    });
  });

  // ── Header row
  $('history-thead').innerHTML =
    '<tr><th class="ht-label"></th>' +
    playerNames.map(n => `<th class="ht-player">${n}</th>`).join('') +
    '</tr>';

  // ── Body rows
  const tbody = $('history-tbody');
  tbody.innerHTML = '';
  ROUND_HISTORY.forEach(round => {
    const map = {};
    round.players.forEach(p => { map[p.name] = p.change; });
    const cells = playerNames.map(n => {
      const v = map[n];
      if (v === undefined) return '<td class="ht-empty">—</td>';
      const cls = v > 0 ? 'ht-pos' : (v < 0 ? 'ht-neg' : 'ht-zero');
      return `<td class="${cls}">${v > 0 ? '+' : ''}${v}</td>`;
    }).join('');
    tbody.innerHTML += `<tr><td class="ht-label">Vòng ${round.round}</td>${cells}</tr>`;
  });

  // ── Footer totals
  const totals = {};
  playerNames.forEach(n => { totals[n] = 0; });
  ROUND_HISTORY.forEach(round => {
    round.players.forEach(p => {
      if (Object.prototype.hasOwnProperty.call(totals, p.name)) totals[p.name] += p.change;
    });
  });
  const totalCells = playerNames.map(n => {
    const v = totals[n];
    const cls = v > 0 ? 'ht-pos' : (v < 0 ? 'ht-neg' : 'ht-zero');
    return `<td class="${cls} ht-foot">${v > 0 ? '+' : ''}${v}</td>`;
  }).join('');
  $('history-tfoot').innerHTML =
    `<tr><td class="ht-label ht-foot">🏆 Tổng</td>${totalCells}</tr>`;

  $('history-overlay').style.display = 'flex';
}
/* ── Score overlay ──────────────────────────────────────── */

function _showScoring(data) {
  const tbody = $('score-tbody');
  tbody.innerHTML = '';
  const rankLabel = ['', '🥇', '🥈', '🥉', '4️⃣'];
  (data.score_changes || []).forEach(r => {
    const chg  = r.change;
    const cls  = chg > 0 ? 'score-positive' : (chg < 0 ? 'score-negative' : '');
    const sign = chg > 0 ? '+' : '';
    tbody.innerHTML +=
      `<tr>
        <td>${rankLabel[r.finish_rank] || r.finish_rank || '?'}</td>
        <td>${r.name}</td>
        <td class="${cls}">${sign}${chg}đ</td>
        <td>${r.total}đ</td>
      </tr>`;
  });

  const penLog = $('penalties-log');
  penLog.innerHTML = '';
  (data.penalties_log || []).forEach(msg => {
    const d = document.createElement('div');
    d.textContent = msg;
    penLog.appendChild(d);
  });

  $('score-title').textContent = `Kết quả vòng ${LAST_STATE ? LAST_STATE.roundNum : ''}`;
  $('score-overlay').style.display = 'flex';
}

/* ── Message ────────────────────────────────────────────── */

function _showMsg(title, body) {
  $('msg-title').textContent = title;
  $('msg-body').innerHTML    = body;
  $('msg-overlay').style.display  = 'flex';
}

/* ── Log ────────────────────────────────────────────────── */

function _log(msg, highlight=false, penalty=false) {
  const body = $('log-body');
  if (!body) return;   // DOM not ready yet
  const div  = document.createElement('div');
  div.className  = 'log-entry' + (highlight ? ' highlight' : '') + (penalty ? ' penalty' : '');
  div.textContent = msg;
  body.prepend(div);
  // Keep log tidy
  while (body.children.length > 120) body.removeChild(body.lastChild);
}
