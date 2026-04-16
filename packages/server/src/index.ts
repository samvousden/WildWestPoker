import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { GameManager } from './gameManager.js';
import { GameState, PokerAction, PokerActionType, ShopItemType, Card, getCardPrice, ShopSlotItem, resolveJokersForShowdown, isJokerCard } from '@poker/shared';

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
  const BOT_DELAY_MS = 1000; // 1 second
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
    
    // If bot is folded or all-in, handle gracefully
    if (activePlayer.hasFolded || activePlayer.isAllIn) {
      if (!activePlayer.hasFolded && activePlayer.isAllIn) {
        // All-in bots submit Check to release their item-only turn
        console.log(`[Bot] ${activePlayer.name} all-in, submitting check to pass item turn`);
        const checkSuccess = gameManager.submitAction(activePlayer.id, { type: PokerActionType.Check });
        if (checkSuccess) {
          currentState = gameManager.getGameState();
          io.emit('game-state-updated', currentState);
          if (currentState.phase === 3 && lastGamePhase !== 3) {
            lastGamePhase = 3;
            handleShowdown();
            return;
          }
        } else {
          console.error(`[Bot Error] ${activePlayer.name} all-in check failed`);
          currentState = gameManager.getGameState();
        }
      } else {
        console.log(`[Bot] ${activePlayer.name} folded, skipping`);
        currentState = gameManager.getGameState();
      }
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
    // Regular showdown: send all hole cards, resolving jokers to their optimal card
    const allCards: { [playerId: number]: any[] } = {};
    const boardCards = currentState.board;
    const allHoleCards = gameManager.getAllHoleCards();
    allHoleCards.forEach((cards, pid) => {
      const hasJoker = cards.some(c => isJokerCard(c));
      allCards[pid] = hasJoker ? resolveJokersForShowdown(cards, boardCards) : cards;
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
    
    // Handle Showdown phase: wait for all players to ready up, then transition to ItemShop
    if (currentState.phase === 3) { // HandPhase.Showdown
      gameManager.setReady(playerId, isReady);
      io.emit('player-ready', { playerId, isReady });
      
      // In bot mode, auto-ready bots when human clicks ready
      const hasBots = currentState.players.some(p => p.isBot);
      if (hasBots && isReady) {
        for (const player of currentState.players) {
          if (player.isBot && !player.isEliminated) {
            player.isReady = true;
          }
        }
        io.emit('game-state-updated', currentState);
      }
      
      // Only transition when ALL non-eliminated players are ready
      const activePlayers = currentState.players.filter(p => !p.isEliminated);
      const allShowdownReady = activePlayers.length >= 1 && activePlayers.every(p => p.isReady);
      if (allShowdownReady) {
        // Reset ready states and transition to ItemShop
        for (const player of currentState.players) {
          player.isReady = false;
        }
        currentState.phase = 4; // HandPhase.ItemShop
        io.emit('game-state-updated', currentState);
      }
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
      
      // Check if all non-eliminated players ready to start next hand directly (skip Lobby)
      const nonEliminated = currentState.players.filter(p => !p.isEliminated);
      const allReady = nonEliminated.length >= 2 && 
        nonEliminated.every(p => p.isReady);
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
      
      // Send updated sleeve card info to the player who used the item
      const { sleeveCard, sleeveCard2 } = gameManager.getPlayerSleeveCards(playerId);
      socket.emit('sleeve-card-updated', { sleeveCard, sleeveCard2, sleeveUsedThisHand: gameManager.hasUsedSleeveThisHand(playerId) });

      // If this was a sleeve card swap, re-send updated hole cards so UI reflects immediately
      if (useType === 21 || useType === 22 || useType === 23 || useType === 24) { // sleeve swap types (A/B for slot 1 and slot 2)
        const updatedHoleCards = gameManager.getHoleCards(playerId);
        if (updatedHoleCards) {
          socket.emit('hole-cards', updatedHoleCards);
        }
      }
    }
  });

  socket.on('get-sleeve-card', (playerId: number, callback) => {
    const { sleeveCard, sleeveCard2 } = gameManager.getPlayerSleeveCards(playerId);
    const hasUnlock = gameManager.hasCardSleeveUnlock(playerId);
    const ps = gameManager.getPlayerPrivateState(playerId);
    callback({
      success: true,
      sleeveCard,
      sleeveCard2,
      hasUnlock,
      xrayCharges: ps?.xrayCharges ?? 0,
      hiddenCameraCharges: ps?.hiddenCameraCharges ?? 0,
      hasGun: ps?.hasGun ?? false,
      bullets: ps?.bullets ?? 0,
      sleeveUsedThisHand: gameManager.hasUsedSleeveThisHand(playerId),
      bonds: ps?.bonds ?? [],
      stockOptions: ps?.stockOptions ?? [],
      totalLuck: ps ? (ps.permanentLuck + ps.luckBuffs.reduce((s, b) => s + b.amount, 0)) : 0,
      luckBuffs: ps?.luckBuffs ?? [],
    });
  });

  socket.on('cash-out-bond', (playerId: number, bondIndex: number, callback) => {
    const result = gameManager.cashOutBond(playerId, bondIndex);
    if (result.success) {
      io.emit('game-state-updated', gameManager.getGameState());
    }
    callback(result);
  });

  socket.on('cash-out-stock-option', (playerId: number, optionIndex: number, callback) => {
    const result = gameManager.cashOutStockOption(playerId, optionIndex);
    if (result.success) {
      io.emit('game-state-updated', gameManager.getGameState());
    }
    callback(result);
  });

  socket.on('unlock-shop-slot', (playerId: number, callback) => {
    const result = gameManager.unlockShopSlot(playerId);
    if (result.success) {
      io.emit('game-state-updated', gameManager.getGameState());
      const slots = gameManager.getShopSlots(playerId);
      callback({ success: true, slots });
    } else {
      callback({ success: false, error: result.error });
    }
  });

  socket.on('get-shop-slots', (playerId: number, callback) => {
    const slots = gameManager.generateShopSlots(playerId);
    callback({ success: true, slots });
  });

  socket.on('refresh-shop', (playerId: number, callback) => {
    const player = gameManager.getGameState().players.find(p => p.id === playerId);
    if (!player) { callback({ success: false, error: 'Player not found' }); return; }
    const cost = 50;
    if (player.stack < cost) { callback({ success: false, error: 'Not enough chips' }); return; }
    player.stack -= cost;
    io.emit('game-state-updated', gameManager.getGameState());
    const slots = gameManager.generateShopSlots(playerId);
    callback({ success: true, slots });
  });

  socket.on('refresh-extra-card-preview', (playerId: number, callback) => {
    const slot = gameManager.refreshExtraCardPreview(playerId);
    if (slot) {
      callback({ success: true, slot });
    } else {
      callback({ success: false, error: 'No extra card slot found' });
    }
  });

  socket.on('get-extra-card-preview', (playerId: number, callback) => {
    const player = gameManager.getGameState().players.find(p => p.id === playerId);
    if (!player) {
      callback({ success: false, error: 'Player not found' });
      return;
    }

    // Get a random available card for preview
    const card = gameManager.getRandomAvailableCardFor(playerId);
    if (!card) {
      callback({ success: false, error: 'No cards available' });
      return;
    }

    const price = getCardPrice(card);
    callback({ success: true, card, price });
  });

  socket.on('buy-extra-card', (playerId: number, card: Card, callback) => {
    const success = gameManager.buyExtraCard(playerId, card);
    
    if (success) {
      io.emit('game-state-updated', gameManager.getGameState());
      
      // Send updated sleeve card info to the player who bought the card
      const { sleeveCard, sleeveCard2 } = gameManager.getPlayerSleeveCards(playerId);
      const playerSocketId = Array.from(playerSessions.entries())
        .find(([_, pid]) => pid === playerId)?.[0];
      if (playerSocketId) {
        io.to(playerSocketId).emit('sleeve-card-updated', { sleeveCard, sleeveCard2 });
      }
      
      callback({ success: true });
    } else {
      callback({ success: false, error: 'Unable to purchase card' });
    }
  });

  socket.on('use-xray', (playerId: number, callback) => {
    const card = gameManager.useXRayGoggles(playerId);
    if (card) {
      const ps = gameManager.getPlayerPrivateState(playerId);
      callback({ success: true, card, chargesLeft: ps?.xrayCharges ?? 0 });
    } else {
      callback({ success: false, error: 'Cannot use X-Ray Goggles now' });
    }
  });

  socket.on('use-hidden-camera', (playerId: number, targetPlayerId: number, callback) => {
    const card = gameManager.useHiddenCamera(playerId, targetPlayerId);
    if (card) {
      const ps = gameManager.getPlayerPrivateState(playerId);
      callback({ success: true, card, chargesLeft: ps?.hiddenCameraCharges ?? 0 });
    } else {
      callback({ success: false, error: 'Cannot use Hidden Camera on that player' });
    }
  });

  socket.on('buy-item', (playerId: number, itemType: number, callback) => {
    const success = gameManager.buyItem(playerId, itemType);
    
    if (success) {
      io.emit('game-state-updated', gameManager.getGameState());
      // Update sleeve state if needed (Joker goes to sleeve, SleeveExtender unlocks slot 2)
      if (itemType === ShopItemType.Joker || itemType === ShopItemType.SleeveExtender) {
        const { sleeveCard, sleeveCard2 } = gameManager.getPlayerSleeveCards(playerId);
        socket.emit('sleeve-card-updated', { sleeveCard, sleeveCard2 });
      }
      callback({ success: true });
    } else {
      callback({ success: false, error: 'Unable to purchase item' });
    }
  });

  socket.on('shoot-player', (playerId: number, targetId: number, callback) => {
    const result = gameManager.shootPlayer(playerId, targetId);
    if (result.success) {
      io.emit('game-state-updated', gameManager.getGameState());
      io.emit('shot-fired', { shooterId: playerId, targetId, backfired: result.backfired });
      const ps = gameManager.getPlayerPrivateState(playerId);
      callback({ success: true, backfired: result.backfired, bulletsLeft: ps?.bullets ?? 0 });
    } else {
      callback({ success: false, error: result.error });
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
