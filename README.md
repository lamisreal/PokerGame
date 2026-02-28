# 🃏 Poker Định Mệnh – Web Edition

No-Limit poker game running entirely in the browser.  
Inspired by the Python poker engine at [github.com/dickreuter/Poker](https://github.com/dickreuter/Poker).
## 🌐 Live Demo

▶️ **[https://lamisreal.github.io/PokerGame/](https://lamisreal.github.io/PokerGame/)**

---

## How to Play

1. Run **`start.bat`** để khởi động server, sau đó mở trình duyệt và truy cập **`http://127.0.0.1:5500`** (Chrome / Edge / Firefox).
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

---

## 🚀 Deployment Guide

### Architecture

```
GitHub Pages  →  index.html, css/, js/   (static frontend)
Render.com    →  server.py, poker_engine.py  (Python backend)
```

---

### 1. Deploy Backend (Render.com)

1. Push code lên GitHub (nhánh `master`)
2. Vào [render.com](https://render.com) → đăng ký / đăng nhập
3. **New → Web Service** → kết nối GitHub repo
4. Cấu hình:

   | Trường | Giá trị |
   |---|---|
   | Runtime | Python 3 |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `python server.py` |
   | Instance Type | Free |

5. Sau khi deploy xong, Render cấp URL dạng `https://your-app.onrender.com`
6. Mở `js/client.js`, sửa dòng đầu:

   ```javascript
   // Từ:
   const socket = io();
   // Thành:
   const socket = io('https://your-app.onrender.com');
   ```

> ⚠️ Free tier sẽ "ngủ" sau 15 phút không có request. Lần đầu kết nối chờ ~30 giây.

---

### 2. Deploy Frontend (GitHub Pages)

```bash
# Tạo nhánh gh-pages chứa chỉ các file tĩnh
git checkout --orphan gh-pages
git rm -rf .

# Copy file frontend cần thiết từ master
git checkout master -- index.html css/ js/ CNAME

# Commit và push
git add .
git commit -m "GitHub Pages frontend"
git push origin gh-pages
```

Sau đó vào repo GitHub → **Settings → Pages**:
- Source: `gh-pages` branch, `/ (root)`
- Nhấn **Save**

URL sau khi deploy: `https://<username>.github.io/<repo-name>/`

---

### 3. Cập nhật backend URL sau mỗi lần chỉnh sửa

```bash
# Sau khi sửa code, build lại gh-pages
git checkout gh-pages
git checkout master -- index.html css/ js/
git add .
git commit -m "sync frontend from master"
git push origin gh-pages
```
