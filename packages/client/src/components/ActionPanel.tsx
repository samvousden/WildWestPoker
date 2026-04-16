import React, { useState } from 'react';
import { useGame } from '../context/GameContext';
import { PokerActionType } from '@poker/shared';

export const ActionPanel: React.FC = () => {
  const { gameState, playerId, submitAction } = useGame();
  const [raiseAmount, setRaiseAmount] = useState('');

  if (!gameState || !playerId) return null;

  const player = gameState.players.find(p => p.id === playerId);
  if (!player || gameState.activePlayerId !== playerId) return null;

  // All-in players can only pass their turn (to use items if they have any)
  if (player.isAllIn) {
    return (
      <div className="action-panel">
        <h3>Your Turn (All In)</h3>
        <p style={{ fontSize: '0.9em', color: '#aaa' }}>Use any items above, then end your turn.</p>
        <button onClick={() => submitAction({ type: PokerActionType.Check })}>End Turn</button>
      </div>
    );
  }

  const minRaise = gameState.currentBetToMatch + 10;
  const canCheck = gameState.currentBetToMatch === player.committedThisRound;

  const handleRaise = () => {
    const amount = parseInt(raiseAmount, 10);
    if (
      !isNaN(amount) &&
      amount >= minRaise &&
      amount <= player.stack + (gameState.currentBetToMatch - player.committedThisRound)
    ) {
      submitAction({ type: PokerActionType.RaiseTo, raiseToAmount: amount });
      setRaiseAmount('');
    }
  };

  return (
    <div className="action-panel">
      <h3>Your Turn</h3>
      <button onClick={() => submitAction({ type: PokerActionType.Fold })}>Fold</button>
      <button
        onClick={() => submitAction({ type: PokerActionType.Check })}
        disabled={!canCheck}
      >
        Check
      </button>
      <button onClick={() => submitAction({ type: PokerActionType.Call })}>
        Call ${gameState.currentBetToMatch - player.committedThisRound}
      </button>
      <div className="raise-input">
        <input
          type="number"
          placeholder={`Raise to (min $${minRaise})...`}
          value={raiseAmount}
          onChange={e => setRaiseAmount(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setRaiseAmount(minRaise.toString());
            }
          }}
        />
        <button onClick={handleRaise}>Raise</button>
      </div>
    </div>
  );
};
