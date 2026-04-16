import React from 'react';
import { useGame } from '../context/GameContext';
import { UseItemType, HandPhase, cardToDisplayString } from '@poker/shared';
import { CardDisplay } from './CardDisplay';

export const SleeveSection: React.FC = () => {
  const { gameState, playerId, sleeveCard, sleeveCard2, holeCards, sleeveUsedThisHand, useItem } = useGame();

  if (!sleeveCard && !sleeveCard2) return null;

  const currentPlayer = gameState?.players.find(p => p.id === playerId);
  const canSwap =
    !sleeveUsedThisHand &&
    gameState?.phase === HandPhase.Betting;

  const disabledMsg = sleeveUsedThisHand
    ? 'Already used this hand'
    : 'Swaps only available during the betting phase';

  const renderSlot = (
    card: typeof sleeveCard,
    label: string,
    swapA: UseItemType,
    swapB: UseItemType,
  ) => {
    if (!card) return null;
    return (
      <div className="sleeve-card-section">
        <h3>{label}</h3>
        <div className="sleeve-card-display">
          <CardDisplay card={card} className="sleeve-card" mode="display" />
        </div>
        {canSwap && holeCards && holeCards.length === 2 && (
          <div className="swap-buttons">
            <button className="swap-btn" onClick={() => useItem(swapA)}>
              Swap with {cardToDisplayString(holeCards[0])}
            </button>
            <button className="swap-btn" onClick={() => useItem(swapB)}>
              Swap with {cardToDisplayString(holeCards[1])}
            </button>
          </div>
        )}
        {!canSwap && (
          <p className="swap-disabled-msg">{disabledMsg}</p>
        )}
      </div>
    );
  };

  return (
    <>
      {renderSlot(sleeveCard, 'Card Sleeve', UseItemType.UseSleeveCardSwapHoleA, UseItemType.UseSleeveCardSwapHoleB)}
      {renderSlot(sleeveCard2, 'Card Sleeve (Slot 2)', UseItemType.UseSleeveCard2SwapHoleA, UseItemType.UseSleeveCard2SwapHoleB)}
    </>
  );
};
