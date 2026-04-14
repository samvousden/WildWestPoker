import React, { useMemo } from 'react';
import { useGame } from '../context/GameContext';
import { cardToString, Suit, evaluateBestHandWithCards, getHandRankingName } from '@poker/shared';

const isRedCard = (suit: Suit): boolean => {
  return suit === Suit.Hearts || suit === Suit.Diamonds;
};

export const ShowdownScreen: React.FC = () => {
  const { gameState, allPlayerCards, winnerId, winnerIds, foldedOut, setReady } = useGame();

  if (!gameState) {
    return <div>Loading...</div>;
  }

  const winner = gameState.players.find(p => p.id === winnerId);
  const isTie = winnerIds.length > 1;
  const playerReady = gameState.players.find(p => p.isReady);
  const allReady = gameState.players.length >= 2 && gameState.players.every(p => p.isReady);

  const winningHand = useMemo(() => {
    if (!winner || !allPlayerCards?.get(winner.id) || foldedOut) return null;
    
    const holeCards = allPlayerCards.get(winner.id)!;
    try {
      return evaluateBestHandWithCards(holeCards, gameState.board);
    } catch (e) {
      console.error('Error evaluating hand:', e);
      return null;
    }
  }, [winner, allPlayerCards, gameState.board, foldedOut]);

  return (
    <div className="showdown-screen">
      <div className="showdown-header">
        <h1>{foldedOut ? 'Hand Won!' : 'Hand Complete!'}</h1>
        {isTie ? (
          <h2 className="winner-announcement">🏆 Tie Between {winnerIds.length} Players! 🏆</h2>
        ) : (
          <h2 className="winner-announcement">🏆 {winner?.name} wins! 🏆</h2>
        )}
      </div>

      {!foldedOut && (
        <>
          <div className="community-cards-display">
            <h3>Community Cards</h3>
            <div className="cards">
              {gameState.board.map((card, i) => (
                <div key={i} className={`card ${isRedCard(card.suit) ? 'red-card' : ''}`}>
                  {cardToString(card)}
                </div>
              ))}
            </div>
          </div>

          {winningHand && (
            <div className="winning-hand-display">
              <h3>{getHandRankingName(winningHand.ranking)}</h3>
              <div className="cards">
                {winningHand.cards.map((card, i) => (
                  <div key={i} className={`card ${isRedCard(card.suit) ? 'red-card' : ''}`}>
                    {cardToString(card)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="all-players-cards">
            <h3>All Players' Hands</h3>
            <div className="players-hands-grid">
              {gameState.players
                .filter(player => allPlayerCards?.has(player.id))
                .map(player => (
                <div key={player.id} className={`player-hand ${winnerIds.includes(player.id) ? 'winner' : ''}`}>
                  <h4>{player.name}</h4>
                  <div className="hole-cards-display">
                    {allPlayerCards?.get(player.id)!.map((card, i) => (
                      <div key={i} className={`card hole-card ${isRedCard(card.suit) ? 'red-card' : ''}`}>
                        {cardToString(card)}
                      </div>
                    ))}
                  </div>
                  <p className="stack-info">Stack: ${player.stack}</p>
                  {winnerIds.includes(player.id) && <p className="winner-badge">WINNER</p>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="pot-final">
        <p className="final-pot">Final Pot: ${gameState.pot}</p>
        <div className="ready-section">
          {!allReady ? (
            <button onClick={() => setReady(true)} className="return-btn">Take Me to The Item Shop</button>
          ) : (
            <p className="waiting-message">All players ready - starting next hand...</p>
          )}
        </div>
      </div>
    </div>
  );
};
