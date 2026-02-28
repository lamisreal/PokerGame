# 🃏 Poker Định Mệnh – Web Edition

No-Limit poker game running entirely in the browser.  
Inspired by the Python poker engine at [github.com/dickreuter/Poker](https://github.com/dickreuter/Poker).

---

## How to Play

1. Open **`index.html`** in any modern browser (Chrome / Edge / Firefox).
2. You are **Seat 0** (bottom of the table). Bots occupy seats 1-5.
3. Each player starts with **$1,000**.
4. Use the action bar at the bottom to **Fold / Check / Call / Raise / All-In**.

---

## File Structure

```
PokerGame/
├── index.html          Main game page
├── css/
│   └── style.css       Green-felt table, card & UI styles
└── js/
    ├── deck.js         Card & Deck classes (Fisher-Yates shuffle)
    ├── evaluator.js    7-card hand evaluator (best 5 from 7)
    ├── montecarlo.js   Monte Carlo equity simulation (inspired by montecarlo_python.py)
    ├── ai.js           AI decision maker (equity + pot-odds + personality)
    ├── ui.js           DOM rendering helpers
    └── game.js         Main game controller (blinds, betting rounds, showdown)
```

---

## AI Engine

The bot AI is modelled after `decisionmaker.py` and `montecarlo_python.py` from the original repo:

| Component | Implementation |
|---|---|
| **Equity** | Monte Carlo simulation (~600 random run-outs per decision) |
| **Pot odds** | `callAmount / (pot + callAmount)` |
| **Decision tree** | Fold / Check / Call / Raise / All-In thresholds per phase |
| **Personalities** | 5 archetypes: Tight-Passive, Loose-Aggressive, Tag-Optimal, Maniac, Rock |

### Bot personalities

| Name | Aggression | Bluff freq |
|---|---|---|
| Tight-Passive | 0.6× | 5% |
| Loose-Aggressive | 1.4× | 18% |
| Tag-Optimal (default) | 1.0× | 10% |
| Maniac | 1.8× | 30% |
| Rock | 0.5× | 2% |

---

## Hand Rankings (high → low)

1. Straight Flush
2. Four of a Kind
3. Full House
4. Flush
5. Straight
6. Three of a Kind
7. Two Pair
8. One Pair
9. High Card

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Enter` | Confirm raise amount |

---

## License

Based on the open-source Poker Định Mệnh project (GPL-3.0).
