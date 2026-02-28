'use strict';
/* ══════════════════════════════════════════════════════════
   deck.js  –  Card & Deck
   ══════════════════════════════════════════════════════════ */

const RANKS  = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS  = ['♠','♥','♦','♣'];                   // spade heart diamond club
const RANK_VAL = Object.fromEntries(RANKS.map((r,i) => [r, i])); // '2'->0 … 'A'->12

class Card {
  /**
   * @param {string} rank  – one of RANKS
   * @param {string} suit  – one of SUITS
   */
  constructor(rank, suit) {
    this.rank  = rank;
    this.suit  = suit;
    this.value = RANK_VAL[rank];      // numeric 0-12
    this.isRed = suit === '♥' || suit === '♦';
  }

  /** e.g. "A♠" */
  toString() { return this.rank + this.suit; }

  /** Deep clone */
  clone() { return new Card(this.rank, this.suit); }
}

class Deck {
  constructor() { this.reset(); }

  reset() {
    this._cards = [];
    for (const suit of SUITS)
      for (const rank of RANKS)
        this._cards.push(new Card(rank, suit));
    this.shuffle();
  }

  /** Fisher-Yates shuffle */
  shuffle() {
    const a = this._cards;
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  deal() {
    if (!this._cards.length) throw new Error('Deck empty');
    return this._cards.pop();
  }

  /** Return a fresh card (for Monte-Carlo — does NOT remove from deck) */
  get remaining() { return [...this._cards]; }

  get size() { return this._cards.length; }
}
