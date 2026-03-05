# tienlen_engine.py  –  Tiến Lên game engine
import random

# ── Card ranking ─────────────────────────────────────────────────────────────
# Rank order: 3 < 4 < 5 < 6 < 7 < 8 < 9 < T < J < Q < K < A < 2
RANKS    = ['3','4','5','6','7','8','9','T','J','Q','K','A','2']
SUITS    = ['♠','♣','♦','♥']          # ♠ lowest, ♥ highest
RANK_VAL = {r: i for i, r in enumerate(RANKS)}
SUIT_VAL = {s: i for i, s in enumerate(SUITS)}

MAX_PLAYERS      = 4
START_SCORE      = 0
SUPER_ADMIN_NAME = 'lamisreal'

FINISH_SCORES  = [3, 1, -1, -3]   # 1st … 4th place
HEO_DEN_PENALTY = 1               # 2♠ or 2♣ still in hand
HEO_DO_PENALTY  = 2               # 2♦ or 2♥ still in hand
CONG_MULTIPLIER = 3               # Cóng (zero cards played): penalty × 3


# ── Card & Deck ───────────────────────────────────────────────────────────────

class Card:
    def __init__(self, rank, suit):
        self.rank      = rank
        self.suit      = suit
        self.rank_val  = RANK_VAL[rank]
        self.suit_val  = SUIT_VAL[suit]
        self.value     = self.rank_val * 4 + self.suit_val   # unique 0–51
        self.is_red    = suit in ('♥', '♦')
        self.is_two    = rank == '2'

    def to_dict(self):
        return {'rank': self.rank, 'suit': self.suit,
                'value': self.value, 'isRed': self.is_red, 'isTwo': self.is_two}

    def __repr__(self):  return self.rank + self.suit
    def __eq__(self, o): return isinstance(o, Card) and self.value == o.value
    def __hash__(self):  return self.value


class Deck:
    def __init__(self): self.reset()

    def reset(self):
        self._cards = [Card(r, s) for s in SUITS for r in RANKS]
        random.shuffle(self._cards)

    def deal_all(self, n_players=4):
        """Deal exactly 13 cards to each player; extra cards are discarded.
        Deck is shuffled 7 times for fairness before dealing."""
        cards = list(self._cards)
        # Riffle-style: shuffle multiple times
        for _ in range(7):
            random.shuffle(cards)
        hands = []
        for i in range(n_players):
            # Slice 13 cards per player from the shuffled deck
            hand = sorted(cards[i*13:(i+1)*13], key=lambda c: c.value)
            hands.append(hand)
        return hands


# ── Combination classification ────────────────────────────────────────────────

class CombType:
    SINGLE   = 'single'
    PAIR     = 'pair'
    TRIPLE   = 'triple'
    QUAD     = 'quad'        # Tứ quý
    STRAIGHT = 'straight'    # Sảnh
    PAIR_SEQ = 'pair_seq'    # Đôi thông (sequence of consecutive pairs)


def classify(cards):
    """
    Return (CombType, comparison_key, length_info) or None if invalid.
    comparison_key is used to determine which combo beats which (higher = stronger).
    """
    n = len(cards)
    if n == 0: return None
    sc = sorted(cards, key=lambda c: (c.rank_val, c.suit_val))
    ranks = [c.rank_val for c in sc]

    if n == 1:
        return (CombType.SINGLE, sc[0].value, 1)

    if n == 2:
        if ranks[0] == ranks[1]:
            key = ranks[0] * 4 + max(c.suit_val for c in sc)
            return (CombType.PAIR, key, 2)
        return None

    if n == 3:
        if len(set(ranks)) == 1:
            return (CombType.TRIPLE, ranks[0], 3)
        return _check_straight(sc)

    if n == 4:
        if len(set(ranks)) == 1:
            return (CombType.QUAD, ranks[0], 4)
        return _check_straight(sc)

    # n >= 5
    if n % 2 == 0:
        ps = _check_pair_seq(sc)
        if ps: return ps
    return _check_straight(sc)


def _check_straight(sc):
    n = len(sc)
    if n < 3: return None
    ranks = [c.rank_val for c in sc]
    if any(r == 12 for r in ranks): return None   # 2 cannot be in a straight
    if len(set(ranks)) != n: return None           # no duplicate ranks
    for i in range(1, n):
        if ranks[i] != ranks[i-1] + 1: return None
    return (CombType.STRAIGHT, sc[-1].value, n)


def _check_pair_seq(sc):
    n = len(sc)
    if n < 6 or n % 2 != 0: return None
    ranks = [c.rank_val for c in sc]
    pairs = []
    for i in range(0, n, 2):
        if ranks[i] != ranks[i+1]: return None
        pairs.append(ranks[i])
    for i in range(1, len(pairs)):
        if pairs[i] != pairs[i-1] + 1: return None
    if any(r == 12 for r in pairs): return None   # 2 not allowed in pair_seq
    high_rank  = pairs[-1]
    high_cards = [c for c in sc if c.rank_val == high_rank]
    key = high_rank * 4 + max(c.suit_val for c in high_cards)
    return (CombType.PAIR_SEQ, key, len(pairs))   # length = number of pairs


def can_beat(played, table):
    """
    played, table: tuples (CombType, key, len_info)
    Returns True if played can legally beat table.
    """
    pt, pk, pl = played
    tt, tk, tl = table

    # Normal rule: same type & same length, higher key wins
    if pt == tt:
        if pt == CombType.STRAIGHT:
            return pl == tl and pk > tk          # straights must be same length
        if pt == CombType.PAIR_SEQ:
            if pl > tl: return True              # longer seq always beats shorter
            return pl == tl and pk > tk
        return pl == tl and pk > tk

    # ── Special block (Chặt) rules ─────────────────────────────────────────

    # QUAD can chặt: single 2, pair of 2s, 3-pair sequence
    if pt == CombType.QUAD:
        if tt == CombType.SINGLE   and tk >= 12 * 4:  return True  # single 2
        if tt == CombType.PAIR     and tk >= 12 * 4:  return True  # pair of 2s
        if tt == CombType.PAIR_SEQ and tl <= 3:       return True  # ≤3-pair seq
        if tt == CombType.QUAD     and pk > tk:       return True  # higher quad

    # 3-pair sequence can chặt: single 2   (and beaten by quad or longer seq – handled above)
    if pt == CombType.PAIR_SEQ and pl == 3:
        if tt == CombType.SINGLE and tk >= 12 * 4:   return True  # single 2

    # 4-pair sequence (or longer) can chặt: single 2, pair of 2s, shorter or equal pair seqs
    if pt == CombType.PAIR_SEQ and pl >= 4:
        if tt == CombType.SINGLE and tk >= 12 * 4:   return True
        if tt == CombType.PAIR   and tk >= 12 * 4:   return True
        if tt == CombType.QUAD:                       return pl >= 4   # 4+ pairs beat quad

    return False


# ── Instant-win check (Tới trắng) ─────────────────────────────────────────────

def check_instant_win(hand):
    """Returns a description string if this hand is an instant win, else None."""
    n = len(hand)
    if n < 12: return None

    rank_counts = {}
    for c in hand:
        rank_counts[c.rank_val] = rank_counts.get(c.rank_val, 0) + 1

    # Four 2s (Tứ quý 2)
    if rank_counts.get(12, 0) == 4:
        return 'Tứ quý 2 (bốn con Heo) 🐷🐷🐷🐷'

    # Dragon straight: ranks 0-11 (3 to A) present, 12 unique non-two ranks
    non_two_ranks = sorted(r for r in rank_counts if r != 12)
    if len(non_two_ranks) >= 12 and non_two_ranks[:12] == list(range(0, 12)):
        return 'Sảnh rồng (3 → A)'

    # 6 pairs (any 6 ranks each appearing ≥2 times)
    pairs_count = sum(1 for c in rank_counts.values() if c >= 2)
    if pairs_count >= 6:
        return '6 đôi'

    # 5 consecutive pairs
    pair_ranks = sorted(r for r, cnt in rank_counts.items() if cnt >= 2 and r != 12)
    for i in range(len(pair_ranks) - 4):
        if pair_ranks[i:i+5] == list(range(pair_ranks[i], pair_ranks[i]+5)):
            return '5 đôi thông'

    # 12/13 same colour
    red   = sum(1 for c in hand if c.is_red)
    black = n - red
    if red >= 12 or black >= 12:
        colour = 'đỏ' if red >= 12 else 'đen'
        return f'Đồng màu {colour} ({max(red, black)} lá)'

    return None


# ── Player ────────────────────────────────────────────────────────────────────

class TLPlayer:
    def __init__(self, sid, name, seat):
        self.sid         = sid
        self.name        = name
        self.seat        = seat
        self.score       = START_SCORE
        self.hand        = []           # list[Card]
        self.active      = True
        self.passed      = False        # passed this trick
        self.finish_rank = None         # 1-4 within current round
        self.played_any  = False        # Cóng detection
        self.will_leave  = False

    def to_dict(self, reveal=False):
        cards = ([c.to_dict() for c in sorted(self.hand, key=lambda c: c.value)]
                 if reveal else [None] * len(self.hand))
        return {
            'sid':        self.sid,   'name':       self.name,
            'seat':       self.seat,  'score':      self.score,
            'cardCount':  len(self.hand), 'hand':   cards,
            'active':     self.active, 'passed':    self.passed,
            'finishRank': self.finish_rank, 'playedAny': self.played_any,
        }


# ── Room ──────────────────────────────────────────────────────────────────────

class TLPhase:
    WAITING  = 'waiting'
    PLAYING  = 'playing'
    SCORING  = 'scoring'


class TienLenRoom:
    def __init__(self):
        self.players       = []        # list[TLPlayer], max 4
        self.spectators    = {}        # sid -> {name, score}
        self.registry      = {}        # name_lower -> {display_name, score, sid, token}
        self.host_sid      = None
        self.phase         = TLPhase.WAITING
        self.round_num     = 0
        self.current_trick = []        # list[Card] on the table right now
        self.trick_type    = None      # (CombType, key, len_info)
        self.trick_leader  = None      # seat of who played the current trick
        self.turn_order       = []        # list of seat indices; current = [turn_idx]
        self.turn_idx         = 0
        self.finish_order     = []        # sids in finish order (normally-finished only)
        self.pass_count       = 0         # consecutive passes since last play
        self._next_leave_rank = 0         # counter for force-leave rank assignment (worst first)
        self.first_card_required = None   # (rank, suit) of card that must open the round
        self.round_history    = []        # list of {round, players:[{name,change}]}

    # ── Registry ─────────────────────────────────────────────────────────────

    def _reg_save(self, p, token=None):
        existing = self.registry.get(p.name.lower(), {})
        self.registry[p.name.lower()] = {
            'display_name': p.name,
            'score':        p.score,
            'sid':          p.sid,
            'token':        token if token is not None else existing.get('token'),
        }

    def registry_lookup(self, name):
        return self.registry.get(name.lower())

    def find_active_sid_by_name(self, name):
        e = self.registry.get(name.lower())
        if not e or not e.get('sid'): return None
        if self._get_player(e['sid']) or e['sid'] in self.spectators:
            return e['sid']
        return None

    # ── Player management ─────────────────────────────────────────────────────

    def _get_player(self, sid):
        return next((p for p in self.players if p.sid == sid), None)

    def _get_player_by_seat(self, seat):
        return next((p for p in self.players if p.seat == seat), None)

    def _next_seat(self):
        used = {p.seat for p in self.players if p.active}
        for i in range(MAX_PLAYERS):
            if i not in used: return i
        return len(self.players)

    def _recalculate_host(self):
        active = [p for p in self.players if p.active and not p.will_leave]
        if not active:
            self.host_sid = None; return
        for p in active:
            if p.name.lower() == SUPER_ADMIN_NAME:
                self.host_sid = p.sid; return
        self.host_sid = active[0].sid

    def add_player(self, sid, name, token=None):
        entry     = self.registry_lookup(name)
        reg_score = entry['score'] if entry else START_SCORE
        if self.phase != TLPhase.WAITING:
            self.spectators[sid] = {'name': name, 'score': reg_score}
            self.registry[name.lower()] = {
                'display_name': name, 'score': reg_score, 'sid': sid, 'token': token}
            return 'spectator', None
        active_count = sum(1 for p in self.players if p.active and not p.will_leave)
        if active_count < MAX_PLAYERS:
            self.spectators.pop(sid, None)   # remove from spectators if they were watching
            seat = self._next_seat()
            p    = TLPlayer(sid, name, seat)
            p.score = reg_score
            self.players.append(p)
            self._reg_save(p, token=token)
            self._recalculate_host()
            return 'player', seat
        self.spectators[sid] = {'name': name, 'score': reg_score}
        self.registry[name.lower()] = {
            'display_name': name, 'score': reg_score, 'sid': sid, 'token': token}
        return 'spectator', None

    def remove(self, sid):
        p = self._get_player(sid)
        if p:
            self.players = [x for x in self.players if x.sid != sid]
            self._recalculate_host()
        elif sid in self.spectators:
            self.spectators.pop(sid)

    def rejoin(self, old_sid, new_sid, name, token=None):
        p = self._get_player(old_sid)
        if p:
            p.sid = new_sid
            if self.host_sid == old_sid: self.host_sid = new_sid
            self._reg_save(p, token=token)
            return 'player', p.seat
        elif old_sid in self.spectators:
            info = self.spectators.pop(old_sid)
            self.spectators[new_sid] = info
            return 'spectator', None
        return None, None

    def can_start(self):
        alive = sum(1 for p in self.players if p.active and not p.will_leave)
        return alive >= 2 and self.phase == TLPhase.WAITING

    def is_empty(self):
        """True when no active (non-will_leave) players remain."""
        return not any(p.active and not p.will_leave for p in self.players)

    # ── Round management ──────────────────────────────────────────────────────

    def start_round(self):
        alive = [p for p in self.players if p.active and not p.will_leave]
        if len(alive) < 2:
            return False, 'Cần ít nhất 2 người chơi.'

        self.round_num        += 1
        self._next_leave_rank  = len(alive)   # first leaver = bét (worst rank)
        deck = Deck()
        hands = deck.deal_all(len(alive))

        instant_wins = []
        for i, p in enumerate(alive):
            p.hand        = hands[i]
            p.passed      = False
            p.finish_rank = None
            p.played_any  = False
            iw = check_instant_win(p.hand)
            if iw:
                instant_wins.append({'name': p.name, 'seat': p.seat, 'reason': iw})

        self.current_trick = []
        self.trick_type    = None
        self.trick_leader  = None
        self.finish_order  = []
        self.pass_count    = 0

        if instant_wins:
            # Declare each instant-win player as 1st; assign remaining ranks
            self.phase = TLPhase.SCORING
            return True, {'instant_wins': instant_wins}

        # Find first player:
        # - Round 1: 3♠ holder must go first and lead with 3♠;
        #            if 3♠ not in play (< 4 players), lowest card holder goes first.
        # - Round 2+: winner of previous round goes first, no card restriction.
        first_seat = alive[0].seat
        self.first_card_required = None
        if self.round_num == 1:
            for p in alive:
                if any(c.rank == '3' and c.suit == '♠' for c in p.hand):
                    first_seat = p.seat
                    self.first_card_required = ('3', '♠')
                    break
            if self.first_card_required is None:
                # No 3♠ in play – find the player holding the lowest-value card,
                # they go first but are free to play any valid combo (no card restriction).
                lowest_card = None
                lowest_seat = alive[0].seat
                for p in alive:
                    for c in p.hand:
                        if lowest_card is None or c.value < lowest_card.value:
                            lowest_card = c
                            lowest_seat = p.seat
                first_seat = lowest_seat
                # first_card_required stays None → no restriction on their opening play
        # Round 2+: first_seat stays as alive[0].seat (winner was placed first
        # in alive list by caller, or overridden below via finish_order)

        self.turn_order = [p.seat for p in alive]
        while self.turn_order[0] != first_seat:
            self.turn_order.append(self.turn_order.pop(0))
        self.turn_idx = 0
        self.phase     = TLPhase.PLAYING
        return True, {}

    # ── Turn management ───────────────────────────────────────────────────────

    def current_turn_player(self):
        alive = [p.seat for p in self.players
                 if p.active and p.finish_rank is None and p.hand]
        order = [s for s in self.turn_order if s in alive]
        if not order: return None
        return self._get_player_by_seat(order[self.turn_idx % len(order)])

    def _rebuild_turn_order(self, next_seat=None):
        alive = [p.seat for p in self.players
                 if p.active and p.finish_rank is None and p.hand]
        self.turn_order = [s for s in self.turn_order if s in alive]
        if not self.turn_order and alive:
            self.turn_order = alive
        if next_seat is not None and next_seat in self.turn_order:
            self.turn_idx = self.turn_order.index(next_seat)
        elif self.turn_order:
            self.turn_idx = self.turn_idx % len(self.turn_order)
        else:
            self.turn_idx = 0

    def _seat_after(self, seat):
        """Return next alive seat after `seat` (clockwise)."""
        alive = [p.seat for p in self.players
                 if p.active and p.finish_rank is None and p.hand]
        order = [s for s in self.turn_order if s in alive]
        if not order: return None
        try:
            idx = order.index(seat)
        except ValueError:
            return order[0]
        return order[(idx + 1) % len(order)]

    # ── Play action ───────────────────────────────────────────────────────────

    def play_cards(self, sid, card_values):
        p = self._get_player(sid)
        if not p:
            return {'ok': False, 'error': 'Không tìm thấy người chơi.'}
        cur = self.current_turn_player()
        if not cur or cur.sid != sid:
            return {'ok': False, 'error': 'Chưa đến lượt của bạn.'}
        if self.phase != TLPhase.PLAYING:
            return {'ok': False, 'error': 'Trận chưa bắt đầu.'}

        val_set = set(card_values)
        chosen  = [c for c in p.hand if c.value in val_set]
        if len(chosen) != len(val_set):
            return {'ok': False, 'error': 'Lá bài không hợp lệ.'}

        combo = classify(chosen)
        if combo is None:
            return {'ok': False, 'error': 'Tổ hợp bài không hợp lệ.'}

        # First overall play must include the required opening card
        if not any(pl.played_any for pl in self.players):
            req = self.first_card_required
            if req is not None:
                req_rank, req_suit = req
                if not any(c.rank == req_rank and c.suit == req_suit for c in chosen):
                    return {'ok': False, 'error': f'Lượt đầu tiên phải có lá {req_rank}{req_suit}.'}

        # Must beat current trick
        if self.trick_type is not None:
            if not can_beat(combo, self.trick_type):
                return {'ok': False, 'error': 'Bài không đủ mạnh.'}

        # Remove played cards from hand
        for c in chosen:
            p.hand.remove(c)
        p.played_any  = True
        p.passed      = False
        self.current_trick = chosen
        self.trick_type    = combo
        self.trick_leader  = p.seat
        self.pass_count    = 0
        # Reset pass flags
        for pl in self.players: pl.passed = False

        result = {
            'ok': True,
            'played':      [c.to_dict() for c in chosen],
            'combo':       combo[0],
            'comboKey':    combo[1],
            'player':      p.name,
            'seat':        p.seat,
            'finish_rank': None,
            'round_over':  False,
        }

        # Check if player finished
        if len(p.hand) == 0:
            rank       = len(self.finish_order) + 1
            p.finish_rank = rank
            self.finish_order.append(p.sid)

            alive_remaining = [x for x in self.players
                               if x.active and x.finish_rank is None and x.hand]
            if len(alive_remaining) <= 1:
                if alive_remaining:
                    last            = alive_remaining[0]
                    last.finish_rank = len(self.finish_order) + 1
                    self.finish_order.append(last.sid)
                self.phase        = TLPhase.SCORING
                result['finish_rank'] = rank
                result['round_over']  = True
                return result

            result['finish_rank'] = rank
            # New trick: winner of finishing move keeps leading (clear trick)
            self.current_trick = []
            self.trick_type    = None
            self.trick_leader  = None
            # Next turn: player after the one who just finished
            next_seat = self._seat_after(p.seat)
            self._rebuild_turn_order(next_seat=next_seat)
            return result

        # Advance to next player
        next_seat = self._seat_after(p.seat)
        self._rebuild_turn_order(next_seat=next_seat)
        return result

    # ── Pass action ───────────────────────────────────────────────────────────

    def pass_turn(self, sid):
        p = self._get_player(sid)
        if not p:
            return {'ok': False, 'error': 'Không tìm thấy người chơi.'}
        cur = self.current_turn_player()
        if not cur or cur.sid != sid:
            return {'ok': False, 'error': 'Chưa đến lượt của bạn.'}
        if self.trick_type is None:
            return {'ok': False, 'error': 'Không thể bỏ qua khi bạn được quyền đánh tự do.'}

        p.passed         = True
        self.pass_count += 1

        result = {'ok': True, 'player': p.name, 'seat': p.seat, 'trick_cleared': False}

        # Check if trick should be cleared
        alive_others = [x for x in self.players
                        if x.active and x.finish_rank is None
                        and x.seat != self.trick_leader and x.hand]
        if all(x.passed for x in alive_others):
            # Everyone else passed – trick leader starts new trick
            self.current_trick = []
            self.trick_type    = None
            for pl in self.players: pl.passed = False
            self.pass_count    = 0
            result['trick_cleared'] = True
            self._rebuild_turn_order(next_seat=self.trick_leader)
        else:
            next_seat = self._seat_after(p.seat)
            self._rebuild_turn_order(next_seat=next_seat)

        return result

    # ── Force-leave mid-game ──────────────────────────────────────────────────

    def force_leave(self, sid):
        """Assign leaving player last place mid-game; continue or end round."""
        p = self._get_player(sid)
        if not p:
            return {'ok': False, 'error': 'Không tìm thấy người chơi.'}

        if self.phase != TLPhase.PLAYING:
            # Not mid-game – caller handles normal removal
            return {'ok': True, 'round_over': False}

        # Assign finish rank from the WORST end (bét first) so leavers are penalised
        if p.finish_rank is None:
            p.finish_rank = max(self._next_leave_rank, 1)
            self._next_leave_rank = max(self._next_leave_rank - 1, 1)

        # Clear hand and mark will_leave so they skip next round
        p.hand = []
        p.will_leave = True

        # Remove from turn order
        if p.seat in self.turn_order:
            self.turn_order.remove(p.seat)

        # Who still has cards (excluding the leaving player)?
        still_playing = [x for x in self.players
                         if x.active and x.finish_rank is None
                         and x.sid != sid and not x.will_leave]

        round_over = len(still_playing) <= 1
        if round_over:
            # Auto-finish last remaining player with the next normal rank
            for last_p in still_playing:
                last_p.finish_rank = len(self.finish_order) + 1
                self.finish_order.append(last_p.sid)
            self.phase = TLPhase.SCORING
        else:
            self._rebuild_turn_order()

        return {'ok': True, 'round_over': round_over}

    def try_end_round_early(self):
        """End round immediately if ≤ 1 active, unfinished players still hold cards.
        Returns {'ended': True} when the round was force-closed, else {'ended': False}.
        """
        if self.phase != TLPhase.PLAYING:
            return {'ended': False}
        still = [x for x in self.players
                 if x.active and x.finish_rank is None and x.hand and not x.will_leave]
        if len(still) > 1:
            return {'ended': False}
        # Auto-assign rank to the sole survivor (if any)
        for last_p in still:
            last_p.finish_rank = len(self.finish_order) + 1
            self.finish_order.append(last_p.sid)
        self.phase = TLPhase.SCORING
        return {'ended': True}

    # ── Score calculation ─────────────────────────────────────────────────────

    def calculate_scores(self):
        alive = [p for p in self.players if p.active]
        n     = len(alive)
        delta = {p.sid: 0 for p in alive}
        log   = []

        # Finish position base scores
        scores_table = FINISH_SCORES[:n] if n <= 4 else FINISH_SCORES
        for p in alive:
            rank = p.finish_rank if p.finish_rank else n
            base = scores_table[min(rank, len(scores_table)) - 1]
            delta[p.sid] += base

        # Penalty: holding 2s (Heo) at end of round
        first_p = next((p for p in alive if p.finish_rank == 1), None)
        for p in alive:
            if p.finish_rank == 1: continue    # winner is exempt
            for c in p.hand:
                if c.is_two:
                    pen   = HEO_DO_PENALTY if c.is_red else HEO_DEN_PENALTY
                    mark  = 'đỏ' if c.is_red else 'đen'
                    delta[p.sid] -= pen
                    if first_p:
                        delta[first_p.sid] += pen   # winner collects
                    log.append(f'💀 {p.name} thối Heo {mark} ({c.rank}{c.suit}): -{pen}đ')

        # Cóng penalty: never played a card and placed last
        for p in alive:
            if not p.played_any and (p.finish_rank is None or p.finish_rank == n):
                rank  = p.finish_rank if p.finish_rank else n
                base  = scores_table[min(rank, len(scores_table)) - 1]
                extra = abs(base) * (CONG_MULTIPLIER - 1)
                delta[p.sid] -= extra
                log.append(f'❄️ {p.name} bị Cóng! Phạt thêm -{extra}đ')

        # Apply
        for p in alive:
            p.score += delta[p.sid]
            self._reg_save(p)

        return {
            'score_changes': [
                {'sid': p.sid, 'name': p.name, 'seat': p.seat,
                 'change': delta[p.sid], 'total': p.score,
                 'finish_rank': p.finish_rank}
                for p in sorted(alive, key=lambda x: x.finish_rank or 99)
            ],
            'penalties_log': log,
        }

    # ── Instant win scoring ───────────────────────────────────────────────────

    def apply_instant_win(self, winner_seats):
        """Grant +3 to each winner, -3 to each loser; return score_changes dict."""
        alive = [p for p in self.players if p.active]
        delta = {p.sid: 0 for p in alive}
        for p in alive:
            if p.seat in winner_seats:
                delta[p.sid] = 3
            else:
                delta[p.sid] = -3
        for p in alive:
            p.score += delta[p.sid]
            self._reg_save(p)
        return delta

    # ── Reset ─────────────────────────────────────────────────────────────────

    def reset_for_next_round(self):
        self.current_trick    = []
        self.trick_type       = None
        self.trick_leader     = None
        self.turn_order       = []
        self.turn_idx         = 0
        self.finish_order     = []
        self.pass_count       = 0
        self._next_leave_rank = 0
        self.first_card_required = None
        self.phase            = TLPhase.WAITING
        for p in self.players:
            p.hand        = []
            p.passed      = False
            p.finish_rank = None
            p.played_any  = False

    def reset_all_scores(self):
        """Reset all players' and registry scores to 0."""
        for p in self.players:
            p.score = 0
            self._reg_save(p)
        for _sid, info in self.spectators.items():
            info['score'] = 0
        for key in self.registry:
            self.registry[key]['score'] = 0
        self.round_history = []

    # ── State snapshot ────────────────────────────────────────────────────────

    def get_state(self, viewer_sid=None, reveal_all=False):
        players_state = []
        cur = self.current_turn_player()
        for p in self.players:
            reveal = reveal_all or (viewer_sid is not None and p.sid == viewer_sid)
            d = p.to_dict(reveal=reveal)
            d['isCurrentTurn'] = (
                self.phase == TLPhase.PLAYING and
                cur is not None and cur.sid == p.sid
            )
            d['isTrickLeader'] = (p.seat == self.trick_leader)
            players_state.append(d)

        specs = [{'sid': s, 'name': i['name'], 'score': i['score']}
                 for s, i in self.spectators.items()]

        # Super-admin sid
        sa_sid = None
        for p in self.players:
            if p.name.lower() == SUPER_ADMIN_NAME:
                sa_sid = p.sid; break
        if sa_sid is None:
            for sid, info in self.spectators.items():
                if info['name'].lower() == SUPER_ADMIN_NAME:
                    sa_sid = sid; break

        # Who may reset scores: super-admin first, else richest player (score > 0)
        reset_scores_sid = None
        for p in self.players:
            if p.name.lower() == SUPER_ADMIN_NAME:
                reset_scores_sid = p.sid; break
        if reset_scores_sid is None:
            for sid, info in self.spectators.items():
                if info['name'].lower() == SUPER_ADMIN_NAME:
                    reset_scores_sid = sid; break
        if reset_scores_sid is None and self.players:
            richest = max(self.players, key=lambda p: p.score)
            if richest.score > 0:
                reset_scores_sid = richest.sid

        return {
            'phase':             self.phase,
            'roundNum':          self.round_num,
            'players':           players_state,
            'spectators':        specs,
            'trick':             [c.to_dict() for c in self.current_trick],
            'trickType':         self.trick_type[0] if self.trick_type else None,
            'trickLeader':       self.trick_leader,
            'currentSeat':       cur.seat if cur else None,
            'hostSid':           self.host_sid,
            'canStart':          self.can_start(),
            'superAdminSid':     sa_sid,
            'canResetScoresSid': reset_scores_sid,
            'firstCardRequired': ({'rank': self.first_card_required[0],
                                   'suit': self.first_card_required[1]}
                                  if self.first_card_required else None),
        }
