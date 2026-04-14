import React from 'react';
import { GameProvider, useGame } from './context/GameContext';
import { LobbyScreen } from './components/LobbyScreen';
import { GameBoard } from './components/GameBoard';
import { ShowdownScreen } from './components/ShowdownScreen';
import { ItemShop } from './components/ItemShop';
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

  if (phase === HandPhase.Showdown) {
    return <ShowdownScreen />;
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
