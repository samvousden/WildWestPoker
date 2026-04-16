import React from 'react';
import { Card, Suit, cardToString, cardToDisplayString, isJokerCard } from '@poker/shared';

export const isRedCard = (suit: Suit): boolean =>
  suit === Suit.Hearts || suit === Suit.Diamonds;

interface CardDisplayProps {
  card: Card;
  /** Extra CSS classes added alongside the base 'card' class */
  className?: string;
  /**
   * display: uses cardToDisplayString (shows 🃏 for joker) — for hole cards / sleeve cards
   * string:  uses cardToString (rank+suit text) — for community cards / showdown cards
   */
  mode?: 'display' | 'string';
}

export const CardDisplay: React.FC<CardDisplayProps> = ({ card, className = '', mode = 'display' }) => {
  const isJoker = isJokerCard(card);
  const isRed = !isJoker && isRedCard(card.suit);
  const classes = [
    'card',
    isJoker ? 'joker-card' : isRed ? 'red-card' : '',
    card.improved ? 'improved-card' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {mode === 'display' ? cardToDisplayString(card) : cardToString(card)}
      {card.improved && <span className="gold-sticker">★</span>}
    </div>
  );
};
