import React from 'react';
import { useGame } from '../context/GameContext';

export const ItemShop: React.FC = () => {
  const { gameState, playerId, setReady } = useGame();

  if (!gameState) {
    return <div>Loading...</div>;
  }

  const currentPlayer = gameState.players.find(p => p.id === playerId);
  const allReady = gameState.players.length >= 2 && gameState.players.every(p => p.isReady);

  const handleContinue = () => {
    setReady(true);
  };

  return (
    <div className="item-shop">
      <div className="shop-header">
        <h1>Item Shop</h1>
        <p className="player-info">
          {currentPlayer?.name} - Stack: ${currentPlayer?.stack}
        </p>
      </div>

      <div className="items-grid">
        <div className="item-slot empty">
          <div className="item-placeholder">Item 1</div>
        </div>
        <div className="item-slot empty">
          <div className="item-placeholder">Item 2</div>
        </div>
        <div className="item-slot empty">
          <div className="item-placeholder">Item 3</div>
        </div>
      </div>

      <div className="players-status">
        <h3>Players Ready:</h3>
        {gameState.players.map(p => (
          <div key={p.id} className="player-ready-status">
            {p.name} {p.isReady && '✓'} - Stack: ${p.stack}
          </div>
        ))}
      </div>

      <div className="shop-footer">
        {!allReady ? (
          <button onClick={handleContinue} className="continue-btn">
            Continue to Next Hand
          </button>
        ) : (
          <p className="waiting-message">All players ready - starting next hand...</p>
        )}
      </div>
    </div>
  );
};
