import React, { useState } from 'react';
import { useGame } from '../context/GameContext';

export const LobbyScreen: React.FC = () => {
  const { gameState, playerId, isConnected, joinTable, playVsBots, setReady } = useGame();
  const [playerName, setPlayerName] = useState('Player');

  const handleJoin = async () => {
    const pid = await joinTable(playerName);
    if (pid) {
      console.log(`Joined as player ${pid}`);
    }
  };

  const handlePlayVsBots = async () => {
    const pid = await playVsBots(playerName);
    if (pid) {
      console.log(`Started bot game as player ${pid}`);
    }
  };

  const handleReady = () => {
    setReady(true);
  };

  if (!isConnected) {
    return <div className="lobby">Connecting to server...</div>;
  }

  if (!playerId) {
    return (
      <div className="lobby">
        <h1>Multiplayer Poker</h1>
        <div className="mode-selection">
          <div className="mode-option">
            <h3>Join Table</h3>
            <div className="join-form">
              <input
                type="text"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                placeholder="Enter your name"
              />
              <button onClick={handleJoin}>Join Table</button>
            </div>
          </div>
          <div className="divider">OR</div>
          <div className="mode-option">
            <h3>Play Against Bots</h3>
            <div className="join-form">
              <input
                type="text"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                placeholder="Enter your name"
              />
              <button onClick={handlePlayVsBots} className="bots-btn">Play vs Bots</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const readyCount = gameState?.players.filter(p => p.isReady).length || 0;
  const canStart = readyCount >= 2;

  return (
    <div className="lobby">
      <h1>Waiting for hand to start...</h1>
      <p>You are: {playerName} (ID: {playerId})</p>
      
      <div className="players-list">
        <h3>Players at table:</h3>
        {gameState?.players.map(p => (
          <div key={p.id}>
            {p.name} {p.isBot && '(Bot)'} - Stack: ${p.stack} {p.isReady && '✓ Ready'}
          </div>
        ))}
      </div>

      <button onClick={handleReady}>I'm Ready</button>

      {canStart && (
        <p className="can-start">Hand will start when all players are ready!</p>
      )}
    </div>
  );
};
