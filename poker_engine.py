# poker_engine.py – Server engine
import random
from itertools import combinations

RANKS   = ['2','3','4','5','6','7','8','9','T','J','Q','K','A']
SUITS   = ['♠','♥','♦','♣']
RANK_VAL = {r: i for i, r in enumerate(RANKS)}

HAND_NAMES = [
    'High Card','One Pair','Two Pair','Three of a Kind',
    'Straight','Flush','Full House','Four of a Kind','Straight Flush'
]

SMALL_BLIND      = 5
BIG_BLIND        = 10
MAX_PLAYERS      = 6
START_CHIPS      = 1000
SUPER_ADMIN_NAME = 'lamisreal'   # case-insensitive super-admin username

# ── Card & Deck ──────────────────────────────────────────────────────────────

class Card:
    def __init__(self, rank, suit):
        self.rank   = rank
        self.suit   = suit
        self.value  = RANK_VAL[rank]
        self.is_red = suit in ('♥', '♦')

    def to_dict(self):
        return {'rank': self.rank, 'suit': self.suit,
                'value': self.value, 'isRed': self.is_red}

    def __repr__(self): return self.rank + self.suit


class Deck:
    def __init__(self): self.reset()

    def reset(self):
        self._cards = [Card(r, s) for s in SUITS for r in RANKS]
        random.shuffle(self._cards)

    def deal(self): return self._cards.pop()


# ── Hand evaluator ───────────────────────────────────────────────────────────

def _is_straight(vals):
    if len(set(vals)) == 5 and vals[0] - vals[4] == 4: return True
    if vals == [12, 3, 2, 1, 0]: return True
    return False

def _straight_high(vals):
    return 3 if (vals[0] == 12 and vals[1] == 3) else vals[0]

def _group_vals(freq, count):
    return sorted([v for v, c in freq.items() if c == count], reverse=True)

def _encode(cat, tb):
    score = cat * (13 ** 5)
    for i in range(5):
        score += ((tb[i] if i < len(tb) else 0) + 1) * (13 ** (4 - i))
    return score

def eval_five(five):
    cards  = sorted(five, key=lambda c: -c.value)
    vals   = [c.value for c in cards]
    suits  = [c.suit  for c in cards]
    is_fl  = len(set(suits)) == 1
    is_st  = _is_straight(vals)
    freq   = {}
    for v in vals: freq[v] = freq.get(v, 0) + 1
    counts = sorted(freq.values(), reverse=True)

    if is_fl and is_st:
        cat, tb = 8, [_straight_high(vals)]
    elif counts[0] == 4:
        cat, tb = 7, [_group_vals(freq,4)[0], _group_vals(freq,1)[0]]
    elif counts[0] == 3 and counts[1] == 2:
        cat, tb = 6, [_group_vals(freq,3)[0], _group_vals(freq,2)[0]]
    elif is_fl:
        cat, tb = 5, vals
    elif is_st:
        cat, tb = 4, [_straight_high(vals)]
    elif counts[0] == 3:
        cat, tb = 3, [_group_vals(freq,3)[0]] + sorted(_group_vals(freq,1), reverse=True)
    elif counts[0] == 2 and counts[1] == 2:
        pairs = sorted(_group_vals(freq,2), reverse=True)
        cat, tb = 2, pairs + _group_vals(freq,1)
    elif counts[0] == 2:
        cat, tb = 1, [_group_vals(freq,2)[0]] + sorted(_group_vals(freq,1), reverse=True)
    else:
        cat, tb = 0, vals
    return _encode(cat, tb)

def best_hand(cards):
    if len(cards) < 5:
        return {'score': 0, 'name': 'Waiting…', 'best_five': []}
    best_score, best_five = -1, None
    for combo in combinations(cards, 5):
        s = eval_five(list(combo))
        if s > best_score: best_score, best_five = s, list(combo)
    cat = best_score // (13 ** 5)
    return {'score': best_score, 'name': HAND_NAMES[cat],
            'best_five': [c.to_dict() for c in best_five]}


# ── Player ───────────────────────────────────────────────────────────────────

class Player:
    def __init__(self, sid, name, seat):
        self.sid       = sid
        self.name      = name
        self.seat      = seat
        self.chips     = START_CHIPS
        self.hole_cards    = []
        self.total_bet     = 0
        self.round_bet     = 0
        self.folded        = False
        self.is_allin      = False
        self.active        = True   # False = busted / disconnected
        self.will_stand_up = False  # True = stand up after hand ends

    def to_dict(self, reveal=False):
        hole = [c.to_dict() for c in self.hole_cards] if reveal else \
               [None] * len(self.hole_cards)
        return {
            'sid': self.sid, 'name': self.name, 'seat': self.seat,
            'chips': self.chips, 'roundBet': self.round_bet,
            'totalBet': self.total_bet, 'folded': self.folded,
            'isAllIn': self.is_allin, 'active': self.active,
            'willStandUp': self.will_stand_up,
            'cardCount': len(self.hole_cards), 'holeCards': hole,
        }


# ── Poker Room ───────────────────────────────────────────────────────────────

class Phase:
    WAITING  = 'waiting'
    PREFLOP  = 'preflop'
    FLOP     = 'flop'
    TURN     = 'turn'
    RIVER    = 'river'
    SHOWDOWN = 'showdown'


class PokerRoom:
    def __init__(self):
        self.players          = []   # list[Player], max 6
        self.spectators       = {}   # sid -> {'name': str, 'chips': int}
        self.player_registry  = {}   # name_lower -> {'display_name': str, 'chips': int, 'sid': str|None}
        self.host_sid         = None
        self.deck             = Deck()
        self.community        = []
        self.pot              = 0
        self.current_bet      = 0
        self.phase            = Phase.WAITING
        self.dealer           = 0   # list index
        self.pending_seats    = []
        self.countdown_active = False  # True when 6-player auto-start countdown is running
        self.hand_num         = 0

    # ── Room management ──────────────────────────────────────────────────────

    # ── Registry helpers ─────────────────────────────────────────────────────

    def _reg_save(self, p, token=None):
        """Persist a player's current chips + sid into the registry."""
        existing = self.player_registry.get(p.name.lower(), {})
        self.player_registry[p.name.lower()] = {
            'display_name': p.name,
            'chips':        max(p.chips, 0),
            'sid':          p.sid,
            'token':        token if token is not None else existing.get('token'),
        }

    def _reg_clear_sid(self, name_lower):
        """Mark player as offline (no active session) but keep chips."""
        if name_lower in self.player_registry:
            self.player_registry[name_lower]['sid'] = None

    def _reg_wipe(self, name_lower):
        """Completely erase a player's saved record – next join = fresh account."""
        self.player_registry.pop(name_lower, None)

    def registry_lookup(self, name):
        """Return registry entry or None."""
        return self.player_registry.get(name.lower())

    def find_active_sid_by_name(self, name):
        """Return the currently-active sid for a name, or None."""
        entry = self.player_registry.get(name.lower())
        if not entry or not entry['sid']: return None
        # Verify the sid is still actually in the room
        if self._get_player(entry['sid']) or entry['sid'] in self.spectators:
            return entry['sid']
        return None

    def rejoin(self, old_sid, new_sid, name, token=None):
        """Transfer an existing session to a new socket id (same-device reconnect).
        Mutates the player/spectator record in-place – chips and seat are preserved.
        Returns ('player', seat) or ('spectator', None).
        """
        p = self._get_player(old_sid)
        if p:
            p.sid = new_sid
            if self.host_sid == old_sid:
                self.host_sid = new_sid
            entry = self.player_registry.get(name.lower(), {})
            self.player_registry[name.lower()] = {
                'display_name': p.name,
                'chips':        max(p.chips, 0),
                'sid':          new_sid,
                'token':        token if token is not None else entry.get('token'),
            }
            return 'player', p.seat
        elif old_sid in self.spectators:
            info = self.spectators.pop(old_sid)
            self.spectators[new_sid] = info
            entry = self.player_registry.get(name.lower(), {})
            self.player_registry[name.lower()] = {
                'display_name': info['name'],
                'chips':        max(info['chips'], 0),
                'sid':          new_sid,
                'token':        token if token is not None else entry.get('token'),
            }
            return 'spectator', None
        return None, None

    def _recalculate_host(self):
        """Host = 'lamisreal' if present, else player with most chips."""
        active = [p for p in self.players if p.active and not p.will_stand_up]
        if not active:
            self.host_sid = None
            return
        for p in active:
            if p.name.lower() == SUPER_ADMIN_NAME:
                self.host_sid = p.sid
                return
        richest = max(active, key=lambda p: p.chips)
        self.host_sid = richest.sid

    def add_player(self, sid, name, token=None):
        """Returns ('player', seat) or ('spectator', None)."""
        # Mid-hand: always join as spectator until hand ends
        entry = self.registry_lookup(name)
        reg_chips = entry['chips'] if entry else START_CHIPS
        # Super-admin always gets a reset when broke
        if name.lower() == SUPER_ADMIN_NAME and reg_chips <= 0:
            reg_chips = START_CHIPS

        if self.phase != Phase.WAITING:
            self.spectators[sid] = {'name': name, 'chips': reg_chips}
            existing = self.player_registry.get(name.lower(), {})
            self.player_registry[name.lower()] = {
                'display_name': name, 'chips': reg_chips, 'sid': sid,
                'token': token if token is not None else existing.get('token'),
            }
            return 'spectator', None
        active_count = len([p for p in self.players
                            if p.active and not p.will_stand_up])
        if active_count < MAX_PLAYERS:
            seat = self._next_seat()
            p = Player(sid, name, seat)
            p.chips = reg_chips
            self.players.append(p)
            self._reg_save(p, token=token)
            self._recalculate_host()
            return 'player', seat
        self.spectators[sid] = {'name': name, 'chips': reg_chips}
        existing = self.player_registry.get(name.lower(), {})
        self.player_registry[name.lower()] = {
            'display_name': name, 'chips': reg_chips, 'sid': sid,
            'token': token if token is not None else existing.get('token'),
        }
        return 'spectator', None

    def _next_seat(self):
        used = {p.seat for p in self.players if p.active}
        for i in range(MAX_PLAYERS):
            if i not in used:
                return i
        return len(self.players)

    def remove(self, sid):
        """Completely remove a player/spectator from the room."""
        p = self._get_player(sid)
        if p:
            if p.name.lower() == SUPER_ADMIN_NAME:
                self._reg_save(p)
                self._reg_clear_sid(p.name.lower())
            else:
                self._reg_wipe(p.name.lower())
            self.players = [x for x in self.players if x.sid != sid]
            self._recalculate_host()
        elif sid in self.spectators:
            info = self.spectators.pop(sid)
            key  = info['name'].lower()
            if key == SUPER_ADMIN_NAME:
                if key in self.player_registry:
                    self.player_registry[key]['sid']   = None
                    self.player_registry[key]['chips']  = max(info['chips'], 0)
                else:
                    self.player_registry[key] = {
                        'display_name': info['name'],
                        'chips': max(info['chips'], 0), 'sid': None,
                    }
            else:
                self._reg_wipe(key)

    def stand_up(self, sid):
        """Move a player to spectator mode."""
        p = self._get_player(sid)
        if not p: return False
        if self.phase == Phase.WAITING:
            # Safe to remove immediately
            chips = max(p.chips, 0)
            self._reg_save(p)
            self._reg_clear_sid(p.name.lower())
            self.players = [x for x in self.players if x.sid != sid]
            self.spectators[sid] = {'name': p.name, 'chips': chips}
        else:
            # Mid-hand: fold and queue removal for after hand
            p.folded        = True
            p.will_stand_up = True
            try:
                idx = self.players.index(p)
                self.pending_seats = [s for s in self.pending_seats if s != idx]
            except ValueError:
                pass
        self._recalculate_host()
        return True

    def cleanup_standings(self):
        """After hand ends: move will_stand_up and busted (chips=0) players to spectators.
        Returns list of sids that were just moved (so server can notify them)."""
        moved_sids = []
        for p in list(self.players):
            if p.will_stand_up or not p.active:
                # Super-admin never gets stuck at 0
                if p.name.lower() == SUPER_ADMIN_NAME and p.chips <= 0:
                    p.chips = START_CHIPS
                is_super = p.name.lower() == SUPER_ADMIN_NAME
                busted   = not p.active  # chips = 0
                if busted and not is_super:
                    # Reset to blank slate – next join gets fresh chips
                    self._reg_wipe(p.name.lower())
                else:
                    # Voluntary stand-up or super-admin: preserve chips
                    self._reg_save(p)
                    self._reg_clear_sid(p.name.lower())
                self.spectators[p.sid] = {'name': p.name, 'chips': max(p.chips, 0)}
                moved_sids.append(p.sid)
        self.players = [x for x in self.players
                        if not x.will_stand_up and x.active]
        self._recalculate_host()
        return moved_sids

    def sit_down(self, sid):
        """Move a spectator to a player seat (allowed any time if slot available)."""
        if sid not in self.spectators:
            return False, 'Bạn không ở chế độ chờ.'
        active_count = len([p for p in self.players
                            if p.active and not p.will_stand_up])
        if active_count >= MAX_PLAYERS:
            return False, 'Bàn đã đủ 6 người.'
        info = self.spectators.pop(sid)
        seat = self._next_seat()
        p    = Player(sid, info['name'], seat)
        p.chips = info['chips'] if info['chips'] > 0 else START_CHIPS
        # If joining mid-hand, fold them for current hand — they play next hand
        if self.phase != Phase.WAITING:
            p.folded = True
        self.players.append(p)
        self._reg_save(p)
        self._recalculate_host()
        return True, seat

    def _get_player(self, sid):
        return next((p for p in self.players if p.sid == sid), None)

    def alive_players(self):
        return [p for p in self.players
                if p.active and p.chips > 0 and not p.will_stand_up]

    def can_start(self):
        return (len(self.alive_players()) >= 2 and self.phase == Phase.WAITING)

    # ── Hand management ───────────────────────────────────────────────────────

    def start_hand(self):
        alive = self.alive_players()
        if len(alive) < 2: return False

        self._recalculate_host()
        self.hand_num    += 1
        self.community    = []
        self.pot          = 0
        self.current_bet  = 0
        self.phase        = Phase.PREFLOP
        self.deck.reset()

        for p in self.players:
            p.hole_cards = []
            p.total_bet  = 0
            p.round_bet  = 0
            p.folded     = not p.active or p.chips <= 0
            p.is_allin   = False

        self._advance_dealer()

        # --- Blinds
        sb = self._next_active(self.dealer)
        bb = self._next_active(sb)
        self._post_blind(sb, SMALL_BLIND)
        self._post_blind(bb, BIG_BLIND)
        self.current_bet = BIG_BLIND

        # --- Deal hole cards
        for p in alive:
            p.hole_cards = [self.deck.deal(), self.deck.deal()]

        # --- Pre-flop pending queue (first to act after BB; BB acts last)
        first = self._next_active(bb)
        self._build_pending(first, bb)
        return True

    def _advance_dealer(self):
        n = len(self.players)
        nxt = (self.dealer + 1) % n
        for _ in range(n):
            if self.players[nxt].active and self.players[nxt].chips > 0:
                self.dealer = nxt; return
            nxt = (nxt + 1) % n

    def _post_blind(self, idx, amount):
        p = self.players[idx]
        actual = min(amount, p.chips)
        p.chips    -= actual
        p.round_bet = actual
        p.total_bet = actual
        self.pot   += actual

    def _next_active(self, from_idx):
        n = len(self.players)
        idx = (from_idx + 1) % n
        for _ in range(n):
            p = self.players[idx]
            if p.active and p.chips > 0 and not p.folded:
                return idx
            idx = (idx + 1) % n
        return from_idx

    def _build_pending(self, start_idx, stop_idx):
        self.pending_seats = []
        idx = start_idx
        for _ in range(len(self.players) * 2):
            p = self.players[idx]
            if not p.folded and not p.is_allin and p.active:
                self.pending_seats.append(idx)
            if idx == stop_idx: break
            nxt = self._next_active(idx)
            if nxt == idx: break
            idx = nxt

    def _requeue_after_raise(self, raiser_idx):
        self.pending_seats = []
        start = self._next_active(raiser_idx)
        if start == raiser_idx: return
        idx = start
        for _ in range(len(self.players)):
            p = self.players[idx]
            if idx != raiser_idx and not p.folded and not p.is_allin and p.active:
                self.pending_seats.append(idx)
            nxt = self._next_active(idx)
            if nxt == start or nxt == idx: break
            idx = nxt

    def current_turn_player(self):
        while self.pending_seats:
            idx = self.pending_seats[0]
            p = self.players[idx]
            if not p.folded and not p.is_allin and p.active:
                return p
            self.pending_seats.pop(0)
        return None

    # ── Action processing ─────────────────────────────────────────────────────

    def apply_action(self, sid, action, amount=0):
        p = self._get_player(sid)
        if not p: return {'ok': False, 'error': 'not a player'}

        turn_p = self.current_turn_player()
        if not turn_p or turn_p.sid != sid:
            return {'ok': False, 'error': 'not your turn'}

        # Use list index (not seat) – they diverge after players leave/rejoin
        try:
            p_idx = self.players.index(p)
        except ValueError:
            return {'ok': False, 'error': 'player not found'}

        self.pending_seats = [s for s in self.pending_seats if s != p_idx]
        call_amt = max(0, self.current_bet - p.round_bet)
        result = {'ok': True, 'action': action, 'player': p.name,
                  'seat': p.seat, 'instant_win': False}

        if action == 'fold':
            p.folded = True
            remaining = [x for x in self.players if not x.folded and x.active]
            if len(remaining) == 1:
                w = remaining[0]
                w.chips += self.pot
                result.update({'instant_win': True, 'winner': w.name,
                               'winner_sid': w.sid, 'pot': self.pot})
                self.pot = 0
                self.phase = Phase.WAITING

        elif action == 'check':
            pass

        elif action == 'call':
            actual = min(call_amt, p.chips)
            self._move_bet(p, actual)
            if p.chips == 0: p.is_allin = True

        elif action == 'raise':
            max_total = p.round_bet + p.chips
            raise_to  = max(self.current_bet + BIG_BLIND, min(int(amount), max_total))
            extra     = raise_to - p.round_bet
            if extra <= call_amt:
                actual = min(call_amt, p.chips)
                self._move_bet(p, actual)
                if p.chips == 0: p.is_allin = True
                result['action'] = 'call'
            else:
                self._move_bet(p, extra)
                self.current_bet = p.round_bet
                if p.chips == 0: p.is_allin = True
                self._requeue_after_raise(p_idx)
                result['raised_to'] = p.round_bet

        elif action == 'allin':
            amt = p.chips
            self._move_bet(p, amt)
            p.is_allin = True
            is_raise = p.round_bet > self.current_bet
            if is_raise:
                self.current_bet = p.round_bet
                self._requeue_after_raise(p_idx)
            result['is_raise'] = is_raise

        result['betting_over'] = self._betting_over()
        return result

    def _move_bet(self, p, amount):
        amount = max(0, min(amount, p.chips))
        p.chips    -= amount
        p.round_bet += amount
        p.total_bet += amount
        self.pot    += amount

    def _betting_over(self):
        # Flush stale entries
        while self.pending_seats:
            idx = self.pending_seats[0]
            p = self.players[idx]
            if p.folded or p.is_allin or not p.active:
                self.pending_seats.pop(0)
            else: break
        if not self.pending_seats: return True
        if len([p for p in self.players if not p.folded and p.active]) <= 1: return True
        return False

    # ── Phase advancement ─────────────────────────────────────────────────────

    def advance_phase(self):
        """Returns new phase string."""
        for p in self.players: p.round_bet = 0
        self.current_bet = 0

        first = self._next_active(self.dealer)
        stop  = self.dealer

        if   self.phase == Phase.PREFLOP:
            self.phase = Phase.FLOP
            self.community = [self.deck.deal(), self.deck.deal(), self.deck.deal()]
        elif self.phase == Phase.FLOP:
            self.phase = Phase.TURN
            self.community.append(self.deck.deal())
        elif self.phase == Phase.TURN:
            self.phase = Phase.RIVER
            self.community.append(self.deck.deal())
        elif self.phase == Phase.RIVER:
            self.phase = Phase.SHOWDOWN
            return Phase.SHOWDOWN

        self._build_pending(first, stop)
        return self.phase

    # ── Board reset ───────────────────────────────────────────────────────────

    def reset_board(self):
        """Clear the board between hands – preserve players, spectators, chips."""
        self.community     = []
        self.pot           = 0
        self.current_bet   = 0
        self.phase         = Phase.WAITING
        self.pending_seats = []
        for p in self.players:
            p.hole_cards = []
            p.round_bet  = 0
            p.total_bet  = 0
            p.folded     = not p.active or p.chips <= 0
            p.is_allin   = False

    # ── Showdown ──────────────────────────────────────────────────────────────

    def _calc_side_pots(self):
        """
        Build side pots from each player's total_bet.
        Automatically returns any uncalled (unmatched) excess chips to the raiser.
        Returns list of (pot_amount, [eligible_alive_players]).
        """
        alive       = [p for p in self.players if not p.folded and p.active]
        all_bettors = [p for p in self.players if p.total_bet > 0]
        if not all_bettors:
            return [(self.pot, alive)] if alive else []

        # Sorted unique total_bet values of alive all-in players
        allin_levels = sorted(set(p.total_bet for p in alive if p.is_allin))

        if not allin_levels:
            # No all-ins – single main pot to all alive
            return [(self.pot, alive)]

        side_pots = []
        prev = 0

        for cap in allin_levels:
            pot_amt  = sum(
                min(p.total_bet, cap) - min(p.total_bet, prev)
                for p in all_bettors
            )
            eligible = [p for p in alive if p.total_bet >= cap]
            if pot_amt <= 0:
                prev = cap
                continue
            if len(eligible) <= 1:
                # Nobody else matched this level – return to the sole contributor
                if eligible:
                    eligible[0].chips += pot_amt
                    self.pot -= pot_amt
            else:
                side_pots.append((pot_amt, eligible))
            prev = cap

        # Amount bet above the highest all-in level (main pot or uncalled)
        remaining = sum(max(0, p.total_bet - prev) for p in all_bettors)
        if remaining > 0:
            top_alive = [p for p in alive if p.total_bet > prev]
            if len(top_alive) >= 2:
                side_pots.append((remaining, top_alive))
            elif len(top_alive) == 1:
                # Uncalled raise – return to the sole top bettor
                top_alive[0].chips += remaining
                self.pot -= remaining

        return side_pots

    def do_showdown(self):
        alive = [p for p in self.players if not p.folded and p.active]

        # Evaluate each player's best hand once
        hand_eval = {}
        for p in alive:
            bh = best_hand(p.hole_cards + self.community)
            hand_eval[p] = bh

        # Build side pots (uncalled bets returned inside _calc_side_pots)
        side_pots   = self._calc_side_pots()
        total_won   = {p: 0 for p in alive}
        winners_set = set()

        for pot_amt, eligible in side_pots:
            if not eligible or pot_amt <= 0:
                continue
            best_score  = max(hand_eval[p]['score'] for p in eligible)
            pot_winners = [p for p in eligible if hand_eval[p]['score'] == best_score]
            share       = pot_amt // len(pot_winners)
            remainder   = pot_amt % len(pot_winners)
            for w in pot_winners:
                w.chips += share
                total_won[w] += share
                winners_set.add(w)
            if remainder:
                # Odd chip to the winner closest to dealer-left
                first = min(pot_winners, key=lambda p: p.seat)
                first.chips += remainder
                total_won[first] += remainder

        for p in self.players:
            if p.active and p.chips <= 0:
                p.active = False

        saved_pot  = sum(total_won.values())
        community_snapshot = [c.to_dict() for c in self.community]
        self.pot   = 0
        self.phase = Phase.WAITING

        return {
            'pot': saved_pot,
            'community': community_snapshot,
            'results': sorted([{
                'name':       p.name,
                'sid':        p.sid,
                'seat':       p.seat,
                'hand_name':  hand_eval[p]['name'],
                'hole_cards': [c.to_dict() for c in p.hole_cards],
                'won':        total_won[p],
                'is_winner':  p in winners_set,
            } for p in alive], key=lambda r: -r['won']),
        }

    # ── State snapshot ────────────────────────────────────────────────────────

    def get_state(self, viewer_sid=None, reveal_all=False):
        players_state = []
        for p in self.players:
            reveal = reveal_all or (viewer_sid is not None and p.sid == viewer_sid)
            d = p.to_dict(reveal=reveal)
            d['isDealer']      = (p.seat == self.dealer)
            d['isCurrentTurn'] = bool(
                self.pending_seats and self.pending_seats[0] == p.seat)
            players_state.append(d)
        
        waiting_specs = [
            {'sid': sid, 'name': info['name'], 'chips': info['chips']}
            for sid, info in self.spectators.items()
        ]
        active_seats = len([p for p in self.players
                            if p.active and not p.will_stand_up])

        # Find super admin sid (player or spectator named SUPER_ADMIN_NAME)
        super_admin_sid = None
        for p in self.players:
            if p.name.lower() == SUPER_ADMIN_NAME:
                super_admin_sid = p.sid
                break
        if super_admin_sid is None:
            for sid, info in self.spectators.items():
                if info['name'].lower() == SUPER_ADMIN_NAME:
                    super_admin_sid = sid
                    break

        return {
            'phase':          self.phase,
            'players':        players_state,
            'spectators':     waiting_specs,
            'community':      [c.to_dict() for c in self.community],
            'pot':            self.pot,
            'currentBet':     self.current_bet,
            'handNum':        self.hand_num,
            'dealer':         self.dealer,
            'canStart':       self.can_start(),
            'hostSid':        self.host_sid,
            'activeSeats':    active_seats,
            'superAdminSid':  super_admin_sid,
            'countdownActive': self.countdown_active,
        }
