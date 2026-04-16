import React from 'react';
import { useGame } from '../context/GameContext';
import { cardToString } from '@poker/shared';
import { isRedCard } from './CardDisplay';

export const ItemsPanel: React.FC = () => {
  const {
    gameState, playerId,
    xrayCharges, peekedCard,
    hiddenCameraCharges, revealedCards,
    useXRay, useHiddenCamera,
  } = useGame();

  if (!gameState) return null;
  if (xrayCharges <= 0 && peekedCard === null && hiddenCameraCharges <= 0 && revealedCards.size === 0) return null;

  return (
    <div className="items-section">
      {(xrayCharges > 0 || peekedCard !== null) && (
        <div className="item-action">
          <button className="item-use-btn xray-btn" onClick={useXRay} disabled={xrayCharges <= 0}>
            🔍 X-Ray ({xrayCharges})
          </button>
          {peekedCard && (
            <span className="peeked-card">
              Next card:{' '}
              <span className={`card-inline ${isRedCard(peekedCard.suit) ? 'red-card-text' : ''}`}>
                {cardToString(peekedCard)}
              </span>
            </span>
          )}
        </div>
      )}

      {(hiddenCameraCharges > 0 || revealedCards.size > 0) && (
        <div className="item-action">
          <span className="camera-label">📷 Camera ({hiddenCameraCharges}):</span>
          {gameState.players
            .filter(p => p.id !== playerId && p.isInHand && !p.hasFolded)
            .map(p => (
              <button
                key={p.id}
                className="item-use-btn camera-btn"
                onClick={() => useHiddenCamera(p.id)}
                disabled={hiddenCameraCharges <= 0 || revealedCards.has(p.id)}
              >
                {revealedCards.has(p.id)
                  ? `${p.name}: ${cardToString(revealedCards.get(p.id)!)}`
                  : p.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
};
