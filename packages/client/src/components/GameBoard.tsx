import React, { useState } from 'react';
import { useGame } from '../context/GameContext';
import { PokerActionType, cardToString, Suit } from '@poker/shared';

const isRedCard = (suit: Suit): boolean => {
  return suit === Suit.Hearts || suit === Suit.Diamonds;
};

const formatLastAction = (lastAction?: { type: number; amount?: number }): string => {
  if (!lastAction) return '';
  
  switch (lastAction.type) {
    case PokerActionType.Fold:
      return 'Fold';
    case PokerActionType.Check:
      return 'Check';
    case PokerActionType.Call:
      return `Call${lastAction.amount ? `: $${lastAction.amount}` : ''}`;
    case PokerActionType.RaiseTo:
      return `Raise: $${lastAction.amount}`;
    default:
      return '';
  }
};

export const GameBoard: React.FC = () => {
  const { gameState, playerId, holeCards, submitAction } = useGame();
  const [raiseAmount, setRaiseAmount] = useState<string>('');

  if (!gameState || !playerId) {
    return <div>Loading...</div>;
  }

  const currentPlayer = gameState.players.find(p => p.id === playerId);
  const minRaise = gameState.currentBetToMatch + 10;

  const handleRaise = () => {
    const amount = parseInt(raiseAmount, 10);
    if (!isNaN(amount) && amount >= minRaise && currentPlayer && amount <= currentPlayer.stack + (gameState.currentBetToMatch - currentPlayer.committedThisRound)) {
      submitAction({ type: PokerActionType.RaiseTo, raiseToAmount: amount });
      setRaiseAmount('');
    }
  };

  return (
    <div className="game-board">
      <div className="pot-display">
        <h2>Pot: ${gameState.pot}</h2>
      </div>

      <div className="player-hole-cards">
        <h3>Your Cards</h3>
        {holeCards && holeCards.length > 0 ? (
          <div className="hole-cards">
            {holeCards.map((card, i) => (
              <div key={i} className={`card hole-card ${isRedCard(card.suit) ? 'red-card' : ''}`}>
                {cardToString(card)}
              </div>
            ))}
          </div>
        ) : (
          <div className="cards">Waiting for cards...</div>
        )}
      </div>

      <div className="board-cards">
        <h3>Community Cards</h3>
        <div className="cards">
          {gameState.board.map((card, i) => (
            <div key={i} className={`card ${isRedCard(card.suit) ? 'red-card' : ''}`}>
              {cardToString(card)}
            </div>
          ))}
        </div>
      </div>

      <div className="players-table">
        {gameState.players.map(player => (
          <div key={player.id} className={`player-seat ${player.id === playerId ? 'is-you' : ''} ${player.id === gameState.activePlayerId ? 'active-player' : ''}`}>
            {player.id === gameState.activePlayerId && <div className="active-indicator">●</div>}
            <h4>{player.name}</h4>
            <p>Stack: ${player.stack}</p>
            {player.lastAction && (
              <p className="last-action">{formatLastAction(player.lastAction)}</p>
            )}
            {player.isReady && <span className="badge ready">Ready</span>}
            {player.hasFolded && <span className="badge folded">Folded</span>}
            {player.isAllIn && <span className="badge all-in">All In</span>}
          </div>
        ))}
      </div>

      {currentPlayer && gameState.activePlayerId === playerId && (
        <div className="action-panel">
          <h3>Your Turn</h3>
          <button onClick={() => submitAction({ type: PokerActionType.Fold })}>
            Fold
          </button>
          <button onClick={() => submitAction({ type: PokerActionType.Check })}>
            Check
          </button>
          <button onClick={() => submitAction({ type: PokerActionType.Call })}>
            Call ${gameState.currentBetToMatch - currentPlayer.committedThisRound}
          </button>
          <div className="raise-input">
            <input
              type="number"
              placeholder={`Raise to (min $${minRaise})...`}
              value={raiseAmount}
              onChange={e => setRaiseAmount(e.target.value)}
            />
            <button onClick={handleRaise}>
              Raise
            </button>
          </div>
        </div>
      )}

      <div className="game-info">
        <p>Phase: {gameState.phase}</p>
        <p>Betting Round: {gameState.round}</p>
        <p>Dealer: Player {gameState.dealerPlayerId}</p>
      </div>
    </div>
  );
};
