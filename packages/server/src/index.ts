import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { GameManager } from './gameManager.js';
import { GameState, PokerAction } from '@poker/shared';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

const gameManager = new GameManager();
const playerSessions = new Map<string, number>(); // socketId -> playerId
let lastGamePhase = 0; // Track last phase to detect showdown

// Helper function to execute bot turns with delays
async function executeBotTurns(): Promise<void> {
  const BOT_DELAY_MS = 2000; // 2 seconds
  let iterations = 0; // Prevent infinite loops
  const MAX_ITERATIONS = 20; // Safety limit
  
  let currentState = gameManager.getGameState();
  
  while (currentState.phase === 2 && iterations < MAX_ITERATIONS) { // HandPhase.Betting = 2
    iterations++;
    const activePlayer = currentState.players.find(p => p.id === currentState.activePlayerId);
    
    console.log(`[Bot Turn ${iterations}] Active: ${activePlayer?.name || 'NONE'} (ID: ${activePlayer?.id}), Phase: ${currentState.phase}`);
    
    if (!activePlayer) {
      console.error('[Bot Error] No active player found');
      break;
    }
    
    // If it's not a bot, the human needs to act
    if (!activePlayer.isBot) {
      console.log('[Bot] Human player turn - stopping bot execution');
      break;
    }
    
    // If bot is folded or all-in, they already acted, skip them
    if (activePlayer.hasFolded || activePlayer.isAllIn) {
      console.log(`[Bot] ${activePlayer.name} folded/all-in, moving forward`);
      // Just move forward - the submitAction for previous player already moved activePlayerId
      currentState = gameManager.getGameState();
      continue;
    }
    
    // Execute bot action with delay
    try {
      console.log(`[Bot] ${activePlayer.name} thinking...`);
      await new Promise(resolve => setTimeout(resolve, BOT_DELAY_MS));
      
      const botAction = gameManager.getBotAction(activePlayer.id);
      const actionName = botAction.type === 1 ? 'CHECK' : botAction.type === 2 ? 'CALL' : 'UNKNOWN';
      console.log(`[Bot] ${activePlayer.name} ${actionName}`);
      
      const actionSuccess = gameManager.submitAction(activePlayer.id, botAction);
      if (!actionSuccess) {
        console.error(`[Bot Error] ${activePlayer.name} action failed`);
        break;
      }
      
      // Emit the updated state after bot action
      currentState = gameManager.getGameState();
      io.emit('game-state-updated', currentState);
      console.log(`[Game] Next active: ${currentState.players.find(p => p.id === currentState.activePlayerId)?.name || 'NONE'}`);
      
      // Check for showdown transition
      if (currentState.phase === 3 && lastGamePhase !== 3) {
        console.log('[Game] Transitioned to showdown');
        lastGamePhase = 3;
        handleShowdown();
        return;
      }
    } catch (err) {
      console.error('[Bot Error]', err);
      break;
    }
  }
  
  if (iterations >= MAX_ITERATIONS) {
    console.error('[Bot Error] Max iterations reached - possible infinite loop');
  }
  console.log('[Bot] Execution complete');
}

function handleShowdown(): void {
  const currentState = gameManager.getGameState();
  const foldedOut = gameManager.isFoldedOut();
  
  // Reset all ready states when entering showdown so players can click ready
  for (const player of currentState.players) {
    player.isReady = false;
  }
  
  // Emit the reset game state so client knows players aren't ready
  io.emit('game-state-updated', currentState);
  
  if (foldedOut) {
    // Fold-out win: don't send hole cards
    io.emit('showdown', { cards: {}, winnerId: gameManager.getWinnerId(), winnerIds: gameManager.getWinnerIds(), foldedOut: true });
  } else {
    // Regular showdown: send all hole cards
    const allCards: { [playerId: number]: any[] } = {};
    const allHoleCards = gameManager.getAllHoleCards();
    allHoleCards.forEach((cards, pid) => {
      allCards[pid] = cards;
    });
    io.emit('showdown', { cards: allCards, winnerId: gameManager.getWinnerId(), winnerIds: gameManager.getWinnerIds(), foldedOut: false });
  }
}

// REST endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/game-state', (req, res) => {
  const gameState = gameManager.getGameState();
  res.json(gameState);
});

// Socket.io events
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('join-table', (playerName: string, callback) => {
    const playerId = gameManager.joinTable(playerName);
    playerSessions.set(socket.id, playerId);

    console.log(`Player ${playerName} (ID: ${playerId}) joined the table`);

    // Notify all players of the updated game state
    io.emit('game-state-updated', gameManager.getGameState());

    callback({ playerId, success: true });
  });

  socket.on('play-vs-bots', (playerName: string, callback) => {
    const playerId = gameManager.playVsBots(playerName);
    playerSessions.set(socket.id, playerId);

    console.log(`Player ${playerName} (ID: ${playerId}) started game vs bots`);

    // Notify all players of the updated game state
    io.emit('game-state-updated', gameManager.getGameState());

    callback({ playerId, success: true });
  });

  socket.on('set-ready', (playerId: number, isReady: boolean) => {
    const currentState = gameManager.getGameState();
    
    // Handle Showdown phase: transition to ItemShop when human clicks ready
    if (currentState.phase === 3) { // HandPhase.Showdown
      // Reset all ready states when transitioning to ItemShop
      for (const player of currentState.players) {
        player.isReady = false;
      }
      
      // Transition to ItemShop phase
      currentState.phase = 4; // HandPhase.ItemShop
      io.emit('game-state-updated', currentState);
    } 
    // Handle ItemShop phase: transition to Lobby when ready
    else if (currentState.phase === 4) { // HandPhase.ItemShop
      // Set the player as ready
      gameManager.setReady(playerId, isReady);
      io.emit('player-ready', { playerId, isReady });
      
      // In bot mode, auto-ready bots when human clicks ready
      const hasBots = currentState.players.some(p => p.isBot);
      if (hasBots) {
        for (const player of currentState.players) {
          if (player.isBot) {
            player.isReady = true;
          }
        }
      }
      
      // Check if all ready to start next hand directly (skip Lobby)
      const allReady = currentState.players.length >= 2 && 
        currentState.players.every(p => p.isReady);
      if (allReady) {
        // Skip Lobby and go directly to next hand
        gameManager.startHand();
        lastGamePhase = 0; // Reset phase tracking for new hand
        io.emit('hand-started', gameManager.getGameState());
        
        // Send hole cards to each player
        gameManager.getGameState().players.forEach(player => {
          const holeCards = gameManager.getHoleCards(player.id);
          if (holeCards) {
            io.to(
              Array.from(playerSessions.entries())
                .find(([_, pid]) => pid === player.id)?.[0] || ''
            ).emit('hole-cards', holeCards);
          }
        });

        // If it's a bot's turn, execute bot turns
        const initialState = gameManager.getGameState();
        if (initialState.phase === 2) { // HandPhase.Betting = 2
          const activePlayer = initialState.players.find(p => p.id === initialState.activePlayerId);
          if (activePlayer && activePlayer.isBot) {
            executeBotTurns().catch(err => console.error('Error executing bot turns:', err));
          }
        }
      }
    }
    // Default: handle other phases (Lobby, etc.)
    else {
      gameManager.setReady(playerId, isReady);
      io.emit('player-ready', { playerId, isReady });
    }
  });

  socket.on('start-hand', (playerId: number) => {
    if (gameManager.canStartHand(playerId)) {
      gameManager.startHand();
      lastGamePhase = 0; // Reset phase tracking for new hand
      io.emit('hand-started', gameManager.getGameState());
      
      // Send hole cards to each player
      gameManager.getGameState().players.forEach(player => {
        const holeCards = gameManager.getHoleCards(player.id);
        if (holeCards) {
          io.to(
            Array.from(playerSessions.entries())
              .find(([_, pid]) => pid === player.id)?.[0] || ''
          ).emit('hole-cards', holeCards);
        }
      });

      // If it's a bot's turn, execute bot turns
      const initialState = gameManager.getGameState();
      if (initialState.phase === 2) { // HandPhase.Betting = 2
        const activePlayer = initialState.players.find(p => p.id === initialState.activePlayerId);
        if (activePlayer && activePlayer.isBot) {
          executeBotTurns().catch(err => console.error('Error executing bot turns:', err));
        }
      }
    }
  });

  socket.on('submit-action', (playerId: number, action: PokerAction, callback) => {
    const success = gameManager.submitAction(playerId, action);
    
    if (success) {
      const currentState = gameManager.getGameState();
      io.emit('game-state-updated', currentState);
      
      // Check for showdown transition
      if (currentState.phase === 3 && lastGamePhase !== 3) {
        lastGamePhase = 3;
        handleShowdown();
      } else if (currentState.phase !== lastGamePhase) {
        lastGamePhase = currentState.phase;
      }
      
      // If it's a bot's turn, execute bot turns with delays
      if (currentState.phase === 2) { // HandPhase.Betting = 2
        const activePlayer = currentState.players.find(p => p.id === currentState.activePlayerId);
        if (activePlayer && activePlayer.isBot) {
          executeBotTurns().catch(err => console.error('Error executing bot turns:', err));
        }
      }
      
      callback({ success: true });
    } else {
      callback({ success: false, error: 'Invalid action' });
    }
  });

  socket.on('use-item', (playerId: number, useType: number, targetPlayerId?: number) => {
    const success = gameManager.useItem(playerId, useType, targetPlayerId);
    
    if (success) {
      io.emit('game-state-updated', gameManager.getGameState());
    }
  });

  socket.on('buy-item', (playerId: number, itemType: number, callback) => {
    const success = gameManager.buyItem(playerId, itemType);
    
    if (success) {
      io.emit('game-state-updated', gameManager.getGameState());
      callback({ success: true });
    } else {
      callback({ success: false, error: 'Unable to purchase item' });
    }
  });

  socket.on('disconnect', () => {
    const playerId = playerSessions.get(socket.id);
    if (playerId !== undefined) {
      gameManager.playerDisconnected(playerId);
      playerSessions.delete(socket.id);
      io.emit('player-disconnected', { playerId });
      console.log(`Player ${playerId} disconnected`);
    }
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Poker server running on port ${PORT}`);
});
