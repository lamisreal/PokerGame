# server.py – Flask-SocketIO multiplayer poker server
from threading import Timer
from flask import Flask, request, send_from_directory, send_file, abort
from flask_socketio import SocketIO, join_room, leave_room, emit
from poker_engine import PokerRoom, Phase, SUPER_ADMIN_NAME, MAX_PLAYERS, START_CHIPS
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app     = Flask(__name__, static_folder=BASE_DIR)
app.config['SECRET_KEY'] = 'pokersecret2024'
sio     = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

room_name = 'game_room'
G = PokerRoom()           # single global room

auto_timer:      Timer = None  # next-hand auto-start timer
countdown_timer: Timer = None  # 6-player full-table countdown
turn_timer:      Timer = None  # per-turn 30-second action timer
COUNTDOWN_SECONDS = 10
TURN_SECONDS      = 20


# ── Static file serving ───────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_file(os.path.join(BASE_DIR, 'index.html'))

@app.route('/<path:path>')
def static_files(path):
    full = os.path.join(BASE_DIR, path)
    if os.path.isfile(full):
        return send_from_directory(BASE_DIR, path)
    abort(404)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _broadcast_state(reveal_all=False):
    """Send personalised game_state to every connected client."""
    # Active players get their own hole cards revealed
    for p in G.players:
        if p.active:
            state = G.get_state(viewer_sid=p.sid, reveal_all=reveal_all)
            sio.emit('game_state', state, room=p.sid)
    # Spectators (and fallback) see no hole cards
    base_state = G.get_state(viewer_sid=None, reveal_all=reveal_all)
    for sid in G.spectators:
        sio.emit('game_state', base_state, room=sid)


def _stop_turn_timer():
    global turn_timer
    if turn_timer:
        turn_timer.cancel()
        turn_timer = None
    sio.emit('turn_timer_stop', {}, room=room_name)


def _turn_timeout():
    """Called when a player's 30 s action window expires."""
    global turn_timer
    turn_timer = None
    cur = G.current_turn_player()
    if not cur: return
    call_amt = max(0, G.current_bet - cur.round_bet)
    action   = 'check' if call_amt == 0 else 'fold'
    result   = G.apply_action(cur.sid, action)
    if not result.get('ok'): return
    _action_log(
        f"⏱️ {cur.name} hết giờ – {'chẹc' if action == 'check' else 'bỏ bài'}.",
        cur.seat
    )
    _finish_action(result)


def _notify_turn():
    cur = G.current_turn_player()
    if not cur: return
    _stop_turn_timer()          # cancel previous timer first
    call_amt = max(0, G.current_bet - cur.round_bet)
    sio.emit('your_turn', {
        'seat':       cur.seat,
        'callAmount': call_amt,
        'canCheck':   call_amt == 0,
        'canRaise':   cur.chips > call_amt,
        'pot':        G.pot,
    }, room=cur.sid)
    sio.emit('turn_changed', {'seat': cur.seat, 'name': cur.name}, room=room_name)
    # Broadcast countdown to all clients
    sio.emit('turn_timer_start', {'seat': cur.seat, 'seconds': TURN_SECONDS}, room=room_name)
    global turn_timer
    turn_timer = Timer(TURN_SECONDS, _turn_timeout)
    turn_timer.daemon = True
    turn_timer.start()


def _action_log(msg, seat=None):
    sio.emit('action_log', {'msg': msg, 'seat': seat}, room=room_name)


def _notify_busted_spectators(moved_sids=None):
    """Emit 'stood_up' to any players just moved to spectators by cleanup_standings."""
    sids = moved_sids or []
    for sid in sids:
        sio.emit('stood_up', room=sid)


def _auto_start_hand(delay=4):
    global auto_timer
    if auto_timer: auto_timer.cancel()
    auto_timer = Timer(delay, _start_next_hand)
    auto_timer.daemon = True
    auto_timer.start()


def _check_full_table():
    """Start or cancel the 6-player auto-start countdown."""
    global countdown_timer
    active_seats = len([p for p in G.players if p.active and not p.will_stand_up])
    full = (active_seats == MAX_PLAYERS and G.phase == Phase.WAITING)

    if full and not G.countdown_active:
        # Start countdown
        G.countdown_active = True
        sio.emit('countdown_start', {'seconds': COUNTDOWN_SECONDS}, room=room_name)
        if countdown_timer: countdown_timer.cancel()
        countdown_timer = Timer(COUNTDOWN_SECONDS, _countdown_fire)
        countdown_timer.daemon = True
        countdown_timer.start()
    elif not full and G.countdown_active:
        # Cancel countdown
        G.countdown_active = False
        if countdown_timer: countdown_timer.cancel()
        sio.emit('countdown_cancel', {}, room=room_name)


def _cancel_countdown():
    """Unconditionally cancel an in-progress countdown."""
    global countdown_timer
    if G.countdown_active:
        G.countdown_active = False
        if countdown_timer: countdown_timer.cancel()
        sio.emit('countdown_cancel', {}, room=room_name)


def _countdown_fire():
    """Countdown expired – host must press Start manually, no auto-start."""
    G.countdown_active = False
    sio.emit('countdown_cancel', {}, room=room_name)


def _start_next_hand():
    _cancel_countdown()
    _stop_turn_timer()
    if not G.can_start():
        G.reset_board()
        _broadcast_state()
        return
    started = G.start_hand()
    if not started:
        G.reset_board()
        _broadcast_state()
        return
    _broadcast_state()
    sio.emit('new_hand', {'handNum': G.hand_num}, room=room_name)
    _notify_turn()


def _force_fold_and_finish(p):
    """Fold a player outside of apply_action (e.g. standing up mid-hand)."""
    p.folded = True
    try:
        idx = G.players.index(p)
        G.pending_seats = [s for s in G.pending_seats if s != idx]
    except ValueError:
        pass
    remaining = [x for x in G.players
                 if not x.folded and x.active and not x.will_stand_up]
    result = {'ok': True, 'action': 'fold', 'instant_win': False,
              'player': p.name, 'seat': p.seat}
    if len(remaining) == 1:
        w = remaining[0]
        saved = G.pot
        w.chips += G.pot
        G.pot   = 0
        G.phase = Phase.WAITING
        result.update({'instant_win': True, 'winner': w.name,
                       'winner_sid': w.sid, 'pot': saved})
    else:
        result['betting_over'] = G._betting_over()
    return result


def _finish_action(result):
    """Handle the aftermath of a player action."""
    if result.get('instant_win'):
        moved = G.cleanup_standings()
        # Notify any newly-busted players that they are now spectators
        _notify_busted_spectators(moved)
        sio.emit('hand_ended', {
            'winner': result['winner'], 'pot': result['pot']
        }, room=room_name)
        _action_log(f"🏆 {result['winner']} wins ${result['pot']}!")
        _broadcast_state()
        return

    if not result.get('betting_over'):
        _broadcast_state()
        _notify_turn()
        return

    # Betting round over – go to next phase
    new_phase = G.advance_phase()

    if new_phase == Phase.SHOWDOWN:
        # Distribute chips FIRST, then broadcast so clients see nonzero balances
        showdown = G.do_showdown()
        moved = G.cleanup_standings()
        # Notify any newly-busted players that they are now spectators
        _notify_busted_spectators(moved)
        # Reveal all cards + show updated chips
        _broadcast_state(reveal_all=True)
        sio.emit('showdown', showdown, room=room_name)
        winners = [r['name'] for r in showdown['results'] if r['is_winner']]
        _action_log(f"🏆 {', '.join(winners)} win pot ${showdown['pot']}!")
    else:
        _broadcast_state()
        _action_log(f"--- {new_phase.upper()} ---")
        # Check if only one player can act (everyone else is all-in / folded)
        can_act = [p for p in G.players if not p.folded and not p.is_allin and p.active]
        if len(can_act) <= 1:
            # Skip straight through remaining phases automatically
            _skip_to_showdown()
        else:
            _notify_turn()


def _skip_to_showdown():
    """Auto-advance phases when no more bets can be made (all-in scenario)."""
    while G.phase not in (Phase.SHOWDOWN, Phase.WAITING):
        new_phase = G.advance_phase()
        if new_phase == Phase.SHOWDOWN:
            # Distribute chips FIRST, then broadcast updated balances
            showdown = G.do_showdown()
            moved = G.cleanup_standings()
            _notify_busted_spectators(moved)
            _broadcast_state(reveal_all=True)
            sio.emit('showdown', showdown, room=room_name)
            winners = [r['name'] for r in showdown['results'] if r['is_winner']]
            _action_log(f"🏆 {', '.join(winners)} win pot ${showdown['pot']}!")
            return
        _broadcast_state()


# ── Socket events ─────────────────────────────────────────────────────────────

@sio.on('connect')
def on_connect():
    join_room(request.sid)  # personal room for targeted emits
    join_room(room_name)
    sio.emit('connected', {'sid': request.sid}, room=request.sid)


@sio.on('disconnect')
def on_disconnect():
    sid = request.sid
    p   = G._get_player(sid)
    if p:
        name = p.name
        cur  = G.current_turn_player()
        if cur and cur.sid == sid and G.phase != Phase.WAITING:
            _stop_turn_timer()
            result = _force_fold_and_finish(p)
            G.remove(sid)
            _action_log(f"💨 {name} disconnected.")
            _finish_action(result)
        else:
            G.remove(sid)
            _broadcast_state()
            _action_log(f"💨 {name} disconnected.")
    else:
        G.remove(sid)
    _check_full_table()


@sio.on('get_player_info')
def on_get_player_info(data):
    """Client asks: do I have saved chips for this name?"""
    name  = (data.get('name') or '').strip()[:20]
    token = (data.get('token') or '').strip()[:64]
    if not name: return
    entry   = G.registry_lookup(name)
    old_sid = G.find_active_sid_by_name(name)
    # inUse = True only if the active session belongs to a DIFFERENT device
    if old_sid:
        stored_token = (entry or {}).get('token')
        same_device  = bool(stored_token and token and stored_token == token)
        in_use = not same_device
    else:
        in_use = False
    if entry:
        chips = entry['chips']
        # Super-admin always shows as fully funded
        if name.lower() == SUPER_ADMIN_NAME and chips <= 0:
            chips = START_CHIPS
        emit('player_info', {'name': entry['display_name'],
                             'chips': chips,
                             'known': True, 'inUse': in_use})
    else:
        emit('player_info', {'name': name, 'chips': START_CHIPS,
                             'known': False, 'inUse': in_use})


@sio.on('join_game')
def on_join_game(data):
    sid   = request.sid
    name  = (data.get('name') or 'Player').strip()[:20] or 'Player'
    token = (data.get('token') or '').strip()[:64]

    # Re-join the broadcast room in case this socket was previously kicked out
    join_room(room_name)
    old_sid = G.find_active_sid_by_name(name)
    if old_sid and old_sid != sid:
        entry        = G.registry_lookup(name)
        stored_token = (entry or {}).get('token')
        same_device  = bool(stored_token and token and stored_token == token)
        if same_device:
            # Same device re-joining: transfer state to new socket
            role, seat = G.rejoin(old_sid, new_sid=sid, name=name, token=token)
            if role is None:
                # Fallback: remove stale session and fall through to add_player
                G.remove(old_sid)
            else:
                sio.disconnect(old_sid)   # close stale socket; on_disconnect is no-op
                chips   = (G.registry_lookup(name) or {}).get('chips', 1000)
                is_host = (G.host_sid == sid)
                emit('joined', {'role': role, 'seat': seat, 'name': name,
                                'isHost': is_host, 'chips': chips, 'isReturning': True})
                _action_log(f'🔄 {name} nhập lại phòng (cùng thiết bị).')
                _broadcast_state()
                return
        else:
            emit('join_rejected', {
                'msg': f'Tên "{name}" đang được sử dụng bởi một người chơi khác trong phòng. '
                       'Vui lòng chọn tên khác hoặc chờ người đó thoát ra.',
                'chips': (G.registry_lookup(name) or {}).get('chips', 0),
            })
            return

    # ─ Reject if known player has 0 chips (skip for super-admin who auto-resets) ─
    entry = G.registry_lookup(name)
    if entry and entry['chips'] <= 0 and name.lower() != SUPER_ADMIN_NAME:
        emit('join_rejected', {
            'msg': f'Tài khoản "{entry["display_name"]}" đã hết tiền ($0). '
                   'Vui lòng đổi tên để chơi lại.',
            'chips': 0,
        })
        return

    role, seat = G.add_player(sid, name, token=token)
    chips   = (G.registry_lookup(name) or {}).get('chips', 1000)
    is_host = (G.host_sid == sid)
    emit('joined', {'role': role, 'seat': seat, 'name': name,
                    'isHost': is_host, 'chips': chips,
                    'isReturning': entry is not None})
    _action_log(f"{'\ud83c\udfae' if role=='player' else '\ud83d\udc41'} {name} "
                f"{'vào bàn' if role=='player' else 'đang xem'}"
                f"{' (Đội trưởng)' if is_host else ''}.")
    _broadcast_state()


@sio.on('start_game')
def on_start_game(_data=None):
    sid = request.sid
    p   = G._get_player(sid)
    is_super = p and p.name.lower() == SUPER_ADMIN_NAME
    if G.host_sid != sid and not is_super:
        emit('error', {'msg': 'Chỉ đội trưởng mới có quyền bắt đầu.'}); return
    if not G.can_start():
        emit('error', {'msg': 'Cần ít nhất 2 người chơi.'}); return
    _cancel_countdown()
    ok = G.start_hand()
    if ok:
        _broadcast_state()
        sio.emit('new_hand', {'handNum': G.hand_num}, room=room_name)
        _notify_turn()


@sio.on('player_action')
def on_player_action(data):
    _stop_turn_timer()
    sid    = request.sid
    action = data.get('action', '')
    amount = int(data.get('amount', 0))
    result = G.apply_action(sid, action, amount)
    if not result.get('ok'):
        emit('error', {'msg': result.get('error', 'Invalid action')}); return

    p    = G._get_player(sid)
    name = p.name if p else '?'
    seat = p.seat if p else None
    if action == 'fold':              _action_log(f"🃏 {name} bỏ bài.", seat)
    elif action == 'check':           _action_log(f"✋ {name} chẹc.", seat)
    elif action == 'call':            _action_log(f"📞 {name} gọi ${G.current_bet}.", seat)
    elif action in ('raise', 'allin'):
        _action_log(f"⬆️ {name} nâng lên ${result.get('raised_to', '?')}.", seat)
    _finish_action(result)


# ── New player-control events ────────────────────────────────────────────────────

@sio.on('stand_up')
def on_stand_up(_data=None):
    sid = request.sid
    p   = G._get_player(sid)

    # Player was already moved to spectators (e.g. busted at end of hand)
    # Just sync the client – no further server work needed
    if not p:
        if sid in G.spectators:
            emit('stood_up')
        return

    name = p.name

    if G.phase != Phase.WAITING and not p.folded and not p.is_allin:
        # Active in a live hand – force-fold then stand up
        _stop_turn_timer()
        result = _force_fold_and_finish(p)
        G.stand_up(sid)
        _action_log(f"🪑 {name} đứng lên (bỏ bài).")
        _finish_action(result)
    elif G.phase != Phase.WAITING:
        # Already folded/allin mid-hand – just queue stand-up
        G.stand_up(sid)
        _broadcast_state()
        _action_log(f"🪑 {name} đứng lên.")
    else:
        G.stand_up(sid)
        _broadcast_state()
        _action_log(f"🪑 {name} đứng lên.")
    _check_full_table()
    emit('stood_up')


@sio.on('leave_room')
def on_leave_room(_data=None):
    sid  = request.sid
    p    = G._get_player(sid)
    spec = G.spectators.get(sid)
    name = p.name if p else (spec['name'] if spec else '?')

    if p and G.phase != Phase.WAITING and not p.folded and not p.is_allin:
        result = _force_fold_and_finish(p)
        G.remove(sid)
        _action_log(f"👋 {name} rời phòng.")
        _finish_action(result)
    else:
        G.remove(sid)
        _broadcast_state()
        _action_log(f"👋 {name} rời phòng.")
    _check_full_table()
    emit('kicked')
    leave_room(room_name)


@sio.on('sit_down')
def on_sit_down(_data=None):
    sid = request.sid
    ok, info = G.sit_down(sid)
    if ok:
        p = G._get_player(sid)
        emit('joined', {'role': 'player', 'seat': p.seat,
                        'name': p.name, 'isHost': G.host_sid == sid})
        _action_log(f"🎮 {p.name} ngồi vào bàn (ghế {p.seat}).")
        _broadcast_state()
        _check_full_table()
    else:
        emit('error', {'msg': info})


@sio.on('kick_player')
def on_kick_player(data):
    """Super-admin can kick any player or spectator by sid."""
    requester_sid = request.sid
    requester = G._get_player(requester_sid)
    if not requester or requester.name.lower() != SUPER_ADMIN_NAME:
        emit('error', {'msg': 'Bạn không có quyền kick người chơi.'}); return

    target_sid = data.get('sid') if data else None
    if not target_sid:
        emit('error', {'msg': 'Thiếu thông tin người bị kick.'}); return

    target_p    = G._get_player(target_sid)
    target_spec = G.spectators.get(target_sid)
    name = target_p.name if target_p else (target_spec['name'] if target_spec else '?')

    if target_p and G.phase != Phase.WAITING and not target_p.folded and not target_p.is_allin:
        result = _force_fold_and_finish(target_p)
        G.remove(target_sid)
        sio.emit('kicked', room=target_sid)
        leave_room(room_name, sid=target_sid)
        _action_log(f"🥾 {name} bị đuổi khỏi phòng (bỏ bài).")
        _finish_action(result)
    else:
        G.remove(target_sid)
        sio.emit('kicked', room=target_sid)
        leave_room(room_name, sid=target_sid)
        _action_log(f"🥾 {name} bị đuổi khỏi phòng.")
        _broadcast_state()
    _check_full_table()

@sio.on('player_action_real')
def _placeholder(_data=None): pass   # keep linter happy


@sio.on('reset_room')
def on_reset_room(_data=None):
    """Super-admin only: wipe game state without restarting the server."""
    global G, auto_timer, countdown_timer
    sid = request.sid
    requester = G._get_player(sid)
    is_super = requester and requester.name.lower() == SUPER_ADMIN_NAME
    if not is_super:
        # Also allow if super-admin is currently a spectator
        spec = G.spectators.get(sid)
        is_super = spec and spec['name'].lower() == SUPER_ADMIN_NAME
    if not is_super:
        emit('error', {'msg': 'Chỉ quản trị viên mới có quyền reset.'}); return

    # Cancel all pending timers
    if auto_timer:      auto_timer.cancel()
    if countdown_timer: countdown_timer.cancel()
    auto_timer = countdown_timer = None

    # Collect every connected sid before wiping
    all_sids = [p.sid for p in G.players] + list(G.spectators.keys())

    # Reset the room
    G = PokerRoom()

    # Kick everyone (including super-admin) back to lobby
    for s in all_sids:
        sio.emit('room_reset', {}, room=s)
    _action_log('🔄 Phòng đã được reset bởi quản trị viên.')



# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print("✅  Poker Định Mệnh server starting on http://0.0.0.0:5500")
    sio.run(app, host='0.0.0.0', port=5500, debug=False, allow_unsafe_werkzeug=True)
