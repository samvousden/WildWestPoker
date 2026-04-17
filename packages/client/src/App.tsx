import React from 'react';
import { GameProvider, useGame } from './context/GameContext';
import { LobbyScreen } from './components/LobbyScreen';
import { GameBoard } from './components/GameBoard';
import { ShowdownScreen } from './components/ShowdownScreen';
import { ItemShop } from './components/ItemShop';
import { WinScreen } from './components/WinScreen';
import { HandPhase } from '@poker/shared';
import './App.css';

const AppContent: React.FC = () => {
  const { gameState, playerId } = useGame();

  if (!playerId) {
    return <LobbyScreen />;
  }

  const phase = gameState?.phase;

  if (phase === HandPhase.Lobby || phase === undefined) {
    return <LobbyScreen />;
  }

  // Show win screen when only 1 non-eliminated player remains, but only after showdown
  const activePlayers = gameState?.players.filter(p => !p.isEliminated) ?? [];
  const gameOver = activePlayers.length === 1 && gameState!.players.length > 1;

  if (phase === HandPhase.Showdown) {
    return <ShowdownScreen />;
  }

  if (gameOver) {
    return <WinScreen />;
  }

  if (phase === HandPhase.ItemShop) {
    return <ItemShop />;
  }

  return <GameBoard />;
};

function App() {
  return (
    <GameProvider>
      <div className="app">
        <AppContent />
      </div>
    </GameProvider>
  );
}

export default App;
