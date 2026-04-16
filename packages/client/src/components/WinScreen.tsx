import React from 'react';
import { useGame } from '../context/GameContext';

export const WinScreen: React.FC = () => {
  const { gameState, playerId, leaveTable } = useGame();

  if (!gameState) return null;

  const winner = gameState.players.find(p => !p.isEliminated);
  const isWinner = winner?.id === playerId;

  return (
    <div className="win-screen">
      <div className="win-content">
        <h1>{isWinner ? '🏆 You Win! 🏆' : '💀 You Lost 💀'}</h1>
        <h2 className="win-player-name">{winner?.name} is the last player standing!</h2>
        <div className="final-stacks">
          <h3>Final Standings</h3>
          {gameState.players
            .slice()
            .sort((a, b) => b.stack - a.stack)
            .map(p => (
              <div key={p.id} className={`standing-row ${p.isEliminated ? 'eliminated-row' : 'winner-row'}`}>
                <span className="standing-name">{p.name}</span>
                <span className="standing-stack">${p.stack}</span>
                {!p.isEliminated && <span className="crown">👑</span>}
              </div>
            ))}
        </div>
        <button className="leave-btn" onClick={leaveTable}>Back to Lobby</button>
      </div>
    </div>
  );
};
