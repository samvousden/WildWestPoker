import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, PokerAction, PlayerPublicState, Card, ShopSlotItem, BondState, StockOptionState, LuckBuff } from '@poker/shared';

interface GameContextType {
  gameState: GameState | null;
  socket: Socket | null;
  playerId: number | null;
  isConnected: boolean;
  holeCards: Card[] | null;
  sleeveCard: Card | null;
  sleeveCard2: Card | null;
  sleeveUsedThisHand: boolean;
  allPlayerCards: Map<number, Card[]> | null;
  winnerId: number | null;
  winnerIds: number[];
  foldedOut: boolean;
  xrayCharges: number;
  hiddenCameraCharges: number;
  revealedCards: Map<number, Card>; // targetPlayerId -> revealed card
  peekedCard: Card | null; // x-ray peeked card
  hasGun: boolean;
  bullets: number;
  shotFiredEvent: { shooterId: number; targetId: number; backfired: boolean } | null;
  bonds: BondState[];
  stockOptions: StockOptionState[];
  totalLuck: number;
  luckBuffs: LuckBuff[];
  
  // Actions
  joinTable: (playerName: string) => Promise<number | false>;
  playVsBots: (playerName: string) => Promise<number | false>;
  setReady: (isReady: boolean) => void;
  startHand: () => void;
  submitAction: (action: PokerAction) => Promise<boolean>;
  useItem: (itemType: number, targetPlayerId?: number) => void;
  refreshSleeveCard: () => void;
  useXRay: () => void;
  useHiddenCamera: (targetPlayerId: number) => void;
  shootPlayer: (targetPlayerId: number) => void;
  cashOutBond: (bondIndex: number) => void;
  cashOutStockOption: (optionIndex: number) => void;
  leaveTable: () => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [holeCards, setHoleCards] = useState<Card[] | null>(null);
  const [sleeveCard, setSleeveCard] = useState<Card | null>(null);
  const [sleeveCard2, setSleeveCard2] = useState<Card | null>(null);
  const [sleeveUsedThisHand, setSleeveUsedThisHand] = useState(false);
  const [allPlayerCards, setAllPlayerCards] = useState<Map<number, Card[]> | null>(null);
  const [winnerId, setWinnerId] = useState<number | null>(null);
  const [winnerIds, setWinnerIds] = useState<number[]>([]);
  const [foldedOut, setFoldedOut] = useState(false);
  const [xrayCharges, setXrayCharges] = useState(0);
  const [hiddenCameraCharges, setHiddenCameraCharges] = useState(0);
  const [revealedCards, setRevealedCards] = useState<Map<number, Card>>(new Map());
  const [peekedCard, setPeekedCard] = useState<Card | null>(null);
  const [hasGun, setHasGun] = useState(false);
  const [bullets, setBullets] = useState(0);
  const [shotFiredEvent, setShotFiredEvent] = useState<{ shooterId: number; targetId: number; backfired: boolean } | null>(null);
  const [bonds, setBonds] = useState<BondState[]>([]);
  const [stockOptions, setStockOptions] = useState<StockOptionState[]>([]);
  const [totalLuck, setTotalLuck] = useState(0);
  const [luckBuffs, setLuckBuffs] = useState<LuckBuff[]>([]);

  const serverUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

  useEffect(() => {
    const newSocket = io(serverUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    newSocket.on('game-state-updated', (state: GameState) => {
      setGameState(state);
      // Clear showdown data when leaving showdown phase
      if (state.phase !== 3) { // HandPhase.Showdown = 3
        setAllPlayerCards(null);
      }
    });

    newSocket.on('hand-started', (state: GameState) => {
      setGameState(state);
      setHoleCards(null); // Clear old hole cards
      setRevealedCards(new Map());
      setPeekedCard(null);
      setShotFiredEvent(null);
      setSleeveUsedThisHand(false);
    });

    newSocket.on('hole-cards', (cards: Card[]) => {
      setHoleCards(cards);
    });

    newSocket.on('showdown', (data: { cards: { [playerId: string]: Card[] }, winnerId: number, winnerIds: number[], foldedOut: boolean }) => {
      const cardMap = new Map<number, Card[]>();
      for (const [pid, cards] of Object.entries(data.cards)) {
        cardMap.set(parseInt(pid), cards);
      }
      setAllPlayerCards(cardMap);
      setWinnerId(data.winnerId);
      setWinnerIds(data.winnerIds || [data.winnerId]); // Fallback to single winner if not provided
      setFoldedOut(data.foldedOut || false);
    });

    newSocket.on('player-ready', ({ playerId: pid, isReady }) => {
      setGameState(prev => {
        if (!prev) return null;
        return {
          ...prev,
          players: prev.players.map(p =>
            p.id === pid ? { ...p, isReady } : p
          ),
        };
      });
    });

    newSocket.on('sleeve-card-updated', (data: { sleeveCard: Card | null; sleeveCard2?: Card | null; sleeveUsedThisHand?: boolean }) => {
      setSleeveCard(data.sleeveCard);
      setSleeveCard2(data.sleeveCard2 ?? null);
      if (data.sleeveUsedThisHand !== undefined) setSleeveUsedThisHand(data.sleeveUsedThisHand);
    });

    newSocket.on('shot-fired', (data: { shooterId: number; targetId: number; backfired: boolean }) => {
      setShotFiredEvent(data);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [serverUrl]);

  const joinTable = useCallback(
    async (playerName: string): Promise<number | false> => {
      if (!socket) return false;

      return new Promise(resolve => {
        socket.emit('join-table', playerName, ({ playerId: pid, success }) => {
          if (success) {
            setPlayerId(pid);
            resolve(pid);
          } else {
            resolve(false);
          }
        });
      });
    },
    [socket]
  );

  const playVsBots = useCallback(
    async (playerName: string): Promise<number | false> => {
      if (!socket) return false;

      return new Promise(resolve => {
        socket.emit('play-vs-bots', playerName, ({ playerId: pid, success }) => {
          if (success) {
            setPlayerId(pid);
            resolve(pid);
          } else {
            resolve(false);
          }
        });
      });
    },
    [socket]
  );

  const setReady = useCallback(
    (isReady: boolean) => {
      if (!socket || !playerId) return;
      socket.emit('set-ready', playerId, isReady);
    },
    [socket, playerId]
  );

  const startHand = useCallback(() => {
    if (!socket || !playerId) return;
    socket.emit('start-hand', playerId);
  }, [socket, playerId]);

  // Auto-start hand when all players are ready
  useEffect(() => {
    if (!gameState || !socket || !playerId) return;
    
    const allReady = gameState.phase === 0 && // HandPhase.Lobby
      gameState.players.length >= 2 &&
      gameState.players.every(p => p.isReady);
    
    if (allReady) {
      socket.emit('start-hand', playerId);
    }
  }, [gameState, socket, playerId]);

  const submitAction = useCallback(
    async (action: PokerAction): Promise<boolean> => {
      if (!socket || !playerId) return false;

      return new Promise(resolve => {
        socket.emit('submit-action', playerId, action, ({ success }) => {
          resolve(success || false);
        });
      });
    },
    [socket, playerId]
  );

  const useItem = useCallback(
    (itemType: number, targetPlayerId?: number) => {
      if (!socket || !playerId) return;
      socket.emit('use-item', playerId, itemType, targetPlayerId);
    },
    [socket, playerId]
  );

  const useXRay = useCallback(() => {
    if (!socket || !playerId) return;
    socket.emit('use-xray', playerId, (response: any) => {
      if (response.success) {
        setPeekedCard(response.card);
        setXrayCharges(response.chargesLeft);
      }
    });
  }, [socket, playerId]);

  const useHiddenCamera = useCallback((targetPlayerId: number) => {
    if (!socket || !playerId) return;
    socket.emit('use-hidden-camera', playerId, targetPlayerId, (response: any) => {
      if (response.success) {
        setRevealedCards(prev => {
          const next = new Map(prev);
          next.set(targetPlayerId, response.card);
          return next;
        });
        setHiddenCameraCharges(response.chargesLeft);
      }
    });
  }, [socket, playerId]);

  const shootPlayer = useCallback((targetPlayerId: number) => {
    if (!socket || !playerId) return;
    socket.emit('shoot-player', playerId, targetPlayerId, (response: any) => {
      if (response.success) {
        setBullets(response.bulletsLeft);
      }
    });
  }, [socket, playerId]);

  const refreshSleeveCard = useCallback(() => {
    if (!socket || !playerId) return;
    socket.emit('get-sleeve-card', playerId, (response: any) => {
      if (response.success) {
        setSleeveCard(response.sleeveCard);
        setSleeveCard2(response.sleeveCard2 ?? null);
        if (response.xrayCharges !== undefined) setXrayCharges(response.xrayCharges);
        if (response.hiddenCameraCharges !== undefined) setHiddenCameraCharges(response.hiddenCameraCharges);
        if (response.hasGun !== undefined) setHasGun(response.hasGun);
        if (response.bullets !== undefined) setBullets(response.bullets);
        if (response.sleeveUsedThisHand !== undefined) setSleeveUsedThisHand(response.sleeveUsedThisHand);
        if (response.bonds) setBonds(response.bonds);
        if (response.stockOptions) setStockOptions(response.stockOptions);
        if (response.totalLuck !== undefined) setTotalLuck(response.totalLuck);
        if (response.luckBuffs) setLuckBuffs(response.luckBuffs);
      }
    });
  }, [socket, playerId]);

  const cashOutBond = useCallback((bondIndex: number) => {
    if (!socket || !playerId) return;
    socket.emit('cash-out-bond', playerId, bondIndex, () => {
      refreshSleeveCard();
    });
  }, [socket, playerId, refreshSleeveCard]);

  const cashOutStockOption = useCallback((optionIndex: number) => {
    if (!socket || !playerId) return;
    socket.emit('cash-out-stock-option', playerId, optionIndex, () => {
      refreshSleeveCard();
    });
  }, [socket, playerId, refreshSleeveCard]);

  const leaveTable = useCallback(() => {
    setPlayerId(null);
    setGameState(null);
    setHoleCards(null);
    setSleeveCard(null);
    setSleeveCard2(null);
    setSleeveUsedThisHand(false);
    setAllPlayerCards(null);
    setWinnerId(null);
    setWinnerIds([]);
    setFoldedOut(false);
    setXrayCharges(0);
    setHiddenCameraCharges(0);
    setRevealedCards(new Map());
    setPeekedCard(null);
    setHasGun(false);
    setBullets(0);
    setShotFiredEvent(null);
    setBonds([]);
    setStockOptions([]);
    setTotalLuck(0);
    setLuckBuffs([]);
  }, []);

  // Refresh sleeve card when player joins or on game state updates
  useEffect(() => {
    if (socket && playerId) {
      refreshSleeveCard();
    }
  }, [socket, playerId, gameState?.phase, refreshSleeveCard]);

  return (
    <GameContext.Provider
      value={{
        gameState,
        socket,
        playerId,
        isConnected,
        holeCards,
        sleeveCard,
        sleeveCard2,
        sleeveUsedThisHand,
        allPlayerCards,
        winnerId,
        winnerIds,
        foldedOut,
        xrayCharges,
        hiddenCameraCharges,
        revealedCards,
        peekedCard,
        hasGun,
        bullets,
        shotFiredEvent,
        bonds,
        stockOptions,
        totalLuck,
        luckBuffs,
        joinTable,
        playVsBots,
        setReady,
        startHand,
        submitAction,
        useItem,
        refreshSleeveCard,
        useXRay,
        useHiddenCamera,
        shootPlayer,
        cashOutBond,
        cashOutStockOption,
        leaveTable,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within GameProvider');
  }
  return context;
};
