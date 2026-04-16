import React from 'react';
import { Card } from '@poker/shared';
import { CardDisplay } from './CardDisplay';

interface CommunityCardsProps {
  cards: Card[];
  title?: string;
}

export const CommunityCards: React.FC<CommunityCardsProps> = ({ cards, title = 'Community Cards' }) => (
  <div className="board-cards">
    <h3>{title}</h3>
    <div className="cards">
      {cards.map((card, i) => (
        <CardDisplay key={i} card={card} mode="string" />
      ))}
    </div>
  </div>
);
