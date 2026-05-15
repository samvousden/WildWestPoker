import {
  GameState,
  HandPhase,
  BettingRound,
  PokerAction,
  PokerActionType,
  PlayerPublicState,
  Card,
  Suit,
  Rank,
  evaluateBestHand,
  evaluateBestHandWithJokers,
  evaluateFiveCardHand,
  HandRanking,
  ItemType,
  PlayerPrivateState,
  ShopItemType,
  ShopItemRarity,
  ShopSlotItem,
  UseItemType,
  getCardPrice,
  getPrice,
  getShopItemInfo,
  getEligibleShopItems,
  getItemRarity,
  getItemShopWeight,
  getLuckBoostedWeight,
  cardToString,
  isJokerCard,
  JOKER_CARD,
  getTotalLuck,
  getBondCashOutValue,
  getStockOptionCashOutValue,
  BotProfile,
  BotItemRule,
  DEFAULT_BOT_PROFILES,
  shouldBotUseXRayGoggles,
  shouldBotUseGun,
  selectCardsForBotSleeve,
  GauntletState,
  GAUNTLET_BOT_PROGRESSION,
  GAUNTLET_MAX_ROUNDS,
  calculateNextRoundBotStartingStack,
  getGauntletRoundBots,
  TimerSettings,
} from '@poker/shared';

/**
 * Manages the poker game state and logic.
 * In-memory for now; extend with database storage as needed.
 */
export class GameManager {
  private gameState: GameState;
  private holeCards: Map<number, [Card, Card]> = new Map();
  private playerPrivateState: Map<number, PlayerPrivateState> = new Map();
  private playerShopSlots: Map<number, ShopSlotItem[]> = new Map();
  private botProfiles: Map<number, BotProfile> = new Map();
  private botHandCounts: Map<number, number> = new Map();
  private botItemRulesFiredThisHand: Set<number> = new Set();
  private deck: Card[] = [];
  private lastRaiserId: number = 0; // Id of last player to voluntarily bet/raise (0 = no raise yet this round)
  private playersActedThisRound: Set<number> = new Set(); // Tracks who has voluntarily acted; cleared for non-all-in on raise
  private sleeveSwappedThisRound: Set<number> = new Set(); // Track sleeve swaps per round
  private cardRerolledThisHand: Set<number> = new Set();   // Track card rerolls per hand
  private winnerId: number = 0; // Track the current hand winner
  private winnerIds: number[] = []; // Track all tied winners
  private foldedOut: boolean = false; // Track if winner folded out (vs showdown)
  private smallBlind: number = 5;
  private bigBlind: number = 10;
  private handsPlayedSinceBlindIncrease: number = 0;
  private gauntletPlayerStartingStack: number = 0; // Track player's starting stack for gauntlet bankroll calculation
  private gauntletTotalPreviousRound: number = 0; // Track total chips (player + bots) from previous gauntlet round

  constructor() {
    this.gameState = {
      phase: HandPhase.Lobby,
      round: BettingRound.None,
      dealerPlayerId: 0,
      activePlayerId: 0,
      pot: 0,
      currentBetToMatch: 0,
      smallBlind: 5,
      bigBlind: 10,
      players: [],
      board: [],
      caughtCheaterPlayerId: null,
      gameMode: 'vsBot',
      timerSettings: { bettingSeconds: 30, shopSeconds: 60 },
      turnDeadline: null,
    };
  }

  getGameState(): GameState {
    return this.gameState;
  }

  getHoleCards(playerId: number): Card[] | undefined {
    const cards = this.holeCards.get(playerId);
    return cards ? [...cards] : undefined;
  }

  getAllHoleCards(): Map<number, Card[]> {
    return new Map(this.holeCards);
  }

  getWinnerId(): number {
    return this.winnerId;
  }

  getWinnerIds(): number[] {
    return this.winnerIds;
  }

  isFoldedOut(): boolean {
    return this.foldedOut;
  }

  isMultiplayerMode(): boolean {
    return this.gameState.gameMode === 'multiplayer';
  }

  getHostPlayerId(): number {
    return this.gameState.players[0]?.id ?? 0;
  }

  setTimerSettings(settings: TimerSettings): void {
    const clamp = (v: number) => Math.max(10, Math.min(300, Math.round(v)));
    this.gameState.timerSettings = {
      bettingSeconds: clamp(settings.bettingSeconds),
      shopSeconds: clamp(settings.shopSeconds),
    };
  }

  setTurnDeadline(seconds: number | null): void {
    this.gameState.turnDeadline = seconds !== null ? Date.now() + seconds * 1000 : null;
  }

  /**
   * Called by the server timer when a betting turn expires.
   * Submits Check if legal for the active player, otherwise Fold.
   * Returns false if the player was not the active player (race condition guard).
   */
  autoFoldOrCheck(playerId: number): boolean {
    if (this.gameState.activePlayerId !== playerId) return false;
    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player || player.hasFolded || player.isAllIn) return false;
    const canCheck = this.gameState.currentBetToMatch === player.committedThisRound;
    return this.submitAction(playerId, {
      type: canCheck ? PokerActionType.Check : PokerActionType.Fold,
    });
  }

  /**
   * Called by the server timer when a shop/showdown phase timer expires.
   * Marks all unready, non-eliminated, non-bot players as ready.
   */
  autoReadyAllHumans(): void {
    for (const player of this.gameState.players) {
      if (!player.isBot && !player.isEliminated && !player.isReady) {
        player.isReady = true;
      }
    }
  }

  getBotAction(botId: number): PokerAction {
    const bot = this.gameState.players.find(p => p.id === botId);
    if (!bot || !bot.isBot) {
      throw new Error('Player is not a bot');
    }

    const profile = this.botProfiles.get(botId);
    const currentBet = this.gameState.currentBetToMatch;
    const playerCommitted = bot.committedThisRound;

    // Fallback for bots without a profile (check / call only)
    if (!profile) {
      return currentBet === playerCommitted
        ? { type: PokerActionType.Check }
        : { type: PokerActionType.Call };
    }

    const { strategy } = profile;
    const holeCards = this.holeCards.get(botId);
    const board = this.gameState.board;
    const facingRaise = currentBet > playerCommitted;
    const isPreflop = board.length === 0;

    // ── Compute hand strength (0-100) ──────────────────────────────────────
    let strength = 20; // default if hole cards unavailable

    if (holeCards) {
      strength = isPreflop
        ? this.getPreflopStrength(holeCards[0], holeCards[1])
        : this.getEffectivePostflopStrength(holeCards as [Card, Card], board);
    }

    // ── Bluff roll ─────────────────────────────────────────────────────────
    const isBluffing = Math.random() < strategy.bluffFrequency;
    const effectiveStrength = isBluffing ? 100 : strength;

    // ── Pot-odds adjustment ────────────────────────────────────────────────
    // Cheap calls lower thresholds (easier to call); expensive bets raise them
    const callAmount = currentBet - playerCommitted;
    const potOddsMultiplier = callAmount > 0
      ? Math.min(1.3, 0.7 + (callAmount / (this.gameState.pot + callAmount)))
      : 1.0;

    // ── Threshold checks ───────────────────────────────────────────────────
    const rawCallThreshold  = isPreflop ? strategy.preflopCallMinStrength  : strategy.postflopCallMinStrength;
    const rawRaiseThreshold = isPreflop ? strategy.preflopRaiseMinStrength : strategy.postflopRaiseMinStrength;
    const adjustedCallThreshold  = Math.round(rawCallThreshold  * potOddsMultiplier);
    const adjustedRaiseThreshold = Math.round(rawRaiseThreshold * potOddsMultiplier);

    const canCall     = effectiveStrength >= adjustedCallThreshold;
    const shouldRaise = effectiveStrength >= adjustedRaiseThreshold;

    // ── Decision ───────────────────────────────────────────────────────────
    if (facingRaise) {
      if (shouldRaise) {
        return this.buildRaiseAction(currentBet, this.gameState.pot, strategy.raiseSizing, playerCommitted, bot.stack);
      }
      if (canCall) {
        return { type: PokerActionType.Call };
      }
      // Weak hand facing aggression — fold based on frequency, otherwise call
      return Math.random() < strategy.foldToRaiseFrequency
        ? { type: PokerActionType.Fold }
        : { type: PokerActionType.Call };
    } else {
      if (shouldRaise) {
        return this.buildRaiseAction(currentBet, this.gameState.pot, strategy.raiseSizing, playerCommitted, bot.stack);
      }
      return { type: PokerActionType.Check };
    }
  }

  /**
   * Returns a preflop hand strength estimate (0–100) using categorical buckets.
   * Higher = stronger starting hand.
   */
  private getPreflopStrength(c1: Card, c2: Card): number {
    // Jokers are powerful wildcards
    if (isJokerCard(c1) || isJokerCard(c2)) return 90;

    const hi = Math.max(c1.rank, c2.rank) as Rank;
    const lo = Math.min(c1.rank, c2.rank) as Rank;
    const isPair = hi === lo;
    const suited = c1.suit === c2.suit ? 5 : 0;

    if (isPair) {
      const pairStrength: Partial<Record<Rank, number>> = {
        [Rank.Ace]: 100, [Rank.King]: 95, [Rank.Queen]: 87, [Rank.Jack]: 77,
        [Rank.Ten]: 67,  [Rank.Nine]: 60, [Rank.Eight]: 54, [Rank.Seven]: 48,
        [Rank.Six]: 42,  [Rank.Five]: 37, [Rank.Four]: 33,  [Rank.Three]: 29,
        [Rank.Two]: 25,
      };
      return pairStrength[hi] ?? 25;
    }

    const gap = hi - lo;

    if (hi === Rank.Ace) {
      if (lo >= Rank.King)  return 77 + suited;
      if (lo >= Rank.Queen) return 67 + suited;
      if (lo >= Rank.Jack)  return 60 + suited;
      if (lo >= Rank.Ten)   return 55 + suited;
      if (lo >= Rank.Eight) return 45 + suited;
      return 35 + suited;
    }

    if (hi === Rank.King) {
      if (lo >= Rank.Queen) return 62 + suited;
      if (lo >= Rank.Jack)  return 56 + suited;
      if (lo >= Rank.Ten)   return 50 + suited;
      return 20 + suited;
    }

    if (hi >= Rank.Jack && lo >= Rank.Ten) return 52 + suited;
    if (gap === 1) return 30 + suited; // Suited/offsuit connectors
    if (gap === 2) return 22 + suited;
    return Math.max(5, 20 - gap * 2 + suited);
  }

  /**
   * Evaluates the best post-flop hand ranking for a bot given its hole cards
   * and the current board (3, 4, or 5 cards).
   */
  private getPostflopRanking(holeCards: [Card, Card], board: Card[]): HandRanking {
    if (board.length >= 5) {
      const hasJoker = holeCards.some(isJokerCard);
      const hv = hasJoker
        ? evaluateBestHandWithJokers(holeCards, board)
        : evaluateBestHand(holeCards, board);
      return hv.ranking;
    }

    if (board.length === 4) {
      // Turn: pick best 5 from 6 cards (C(6,5) = 6 combinations)
      const allCards = [...holeCards, ...board];
      let best = HandRanking.HighCard;
      for (let skip = 0; skip < allCards.length; skip++) {
        const five = allCards.filter((_, i) => i !== skip);
        const hv = evaluateFiveCardHand(five);
        if (hv.ranking > best) best = hv.ranking;
      }
      return best;
    }

    // Flop: exactly 2 hole + 3 board = 5 cards
    return evaluateFiveCardHand([...holeCards, ...board]).ranking;
  }

  /**
   * Evaluates the "free" hand ranking the board provides to every player.
   * Used to determine how much a bot's hole cards actually improve their hand.
   */
  private getBoardBaselineRanking(board: Card[]): HandRanking {
    if (board.length === 0) return HandRanking.HighCard;

    // Count rank frequencies on the board
    const rankCounts = new Map<Rank, number>();
    for (const c of board) {
      rankCounts.set(c.rank, (rankCounts.get(c.rank) || 0) + 1);
    }
    const counts = [...rankCounts.values()].sort((a, b) => b - a);
    const pairCount = counts.filter(c => c >= 2).length;

    if (counts[0] >= 4) return HandRanking.FourOfAKind;
    if (counts[0] >= 3 && pairCount >= 2) return HandRanking.FullHouse;

    // Check flush and straight for 5-card boards
    if (board.length >= 5) {
      const suitCounts = new Map<Suit, number>();
      for (const c of board) {
        suitCounts.set(c.suit, (suitCounts.get(c.suit) || 0) + 1);
      }
      const maxSuit = Math.max(...suitCounts.values());

      const uniqueRanks = [...new Set(board.map(c => c.rank))].sort((a, b) => a - b);
      let hasStraight = false;
      for (let i = 0; i <= uniqueRanks.length - 5; i++) {
        if (uniqueRanks[i + 4] - uniqueRanks[i] === 4) { hasStraight = true; break; }
      }
      // Wheel: A-2-3-4-5
      if (uniqueRanks.includes(Rank.Ace) && uniqueRanks.includes(Rank.Two) &&
          uniqueRanks.includes(Rank.Three) && uniqueRanks.includes(Rank.Four) &&
          uniqueRanks.includes(Rank.Five)) {
        hasStraight = true;
      }

      if (maxSuit >= 5 && hasStraight) return HandRanking.StraightFlush;
      if (maxSuit >= 5) return HandRanking.Flush;
      if (hasStraight) return HandRanking.Straight;
    }

    if (counts[0] >= 3) return HandRanking.ThreeOfAKind;
    if (pairCount >= 2) return HandRanking.TwoPair;
    if (pairCount >= 1) return HandRanking.OnePair;

    return HandRanking.HighCard;
  }

  /**
   * Returns effective post-flop hand strength (0–100) that accounts for how
   * much the bot's hole cards improve beyond what the board gives "for free".
   * Prevents bots from overvaluing hands that merely match the board.
   */
  private getEffectivePostflopStrength(holeCards: [Card, Card], board: Card[]): number {
    // Jokers are always powerful wildcards
    if (holeCards.some(c => isJokerCard(c))) return 90;

    const playerRanking = this.getPostflopRanking(holeCards, board);
    const boardBaseline = this.getBoardBaselineRanking(board);
    const improvement = playerRanking - boardBaseline;

    if (improvement <= 0) {
      // Hand doesn't improve on the board — assess kicker quality only
      const hiCard = Math.max(holeCards[0].rank, holeCards[1].rank);
      const kickerBonus = Math.round(((hiCard - 2) / 12) * 15); // 0–15 based on high card
      return 10 + kickerBonus; // Range: 10–25
    }

    // Improvement tiers: maps how many ranking levels above board → base strength
    const tierBase = [0, 38, 52, 62, 72, 80, 87, 92, 96, 100];
    const base = tierBase[Math.min(improvement, 9)];

    // Kicker bonus for marginal improvements (1–2 ranks above board)
    if (improvement <= 2) {
      const hiCard = Math.max(holeCards[0].rank, holeCards[1].rank);
      return Math.min(100, base + Math.round(((hiCard - 2) / 12) * 10));
    }

    return base;
  }

  /**
   * Builds a RaiseTo action respecting the bot's sizing preference and stack limit.
   * Falls back to Call if the bot cannot raise higher than the current bet.
   */
  private buildRaiseAction(
    currentBet: number,
    pot: number,
    sizing: 'min' | 'pot' | 'large',
    botCommitted: number,
    botStack: number,
  ): PokerAction {
    const MIN_OPEN = this.bigBlind * 2; // minimum opening bet when no previous bet exists
    let raiseToAmount: number;

    if (currentBet === 0) {
      // Opening the betting — use a fraction of pot or a fixed floor
      raiseToAmount = Math.max(MIN_OPEN, Math.round(pot * 0.5));
    } else if (sizing === 'min') {
      raiseToAmount = currentBet * 2;
    } else if (sizing === 'pot') {
      raiseToAmount = currentBet + pot;
    } else {
      raiseToAmount = currentBet * 3;
    }

    // Cap at all-in
    const maxRaiseTo = botCommitted + botStack;
    raiseToAmount = Math.min(raiseToAmount, maxRaiseTo);

    // Must result in a net bet increase
    if (raiseToAmount <= currentBet) {
      return { type: PokerActionType.Call };
    }

    return { type: PokerActionType.RaiseTo, raiseToAmount };
  }

  /**
   * Applies a list of starting items directly to a bot's private state.
   * This replicates shop purchase effects without adding items to inventory.
   */
  private applyBotStartingItems(botId: number, items: ShopItemType[]): void {
    const ps = this.playerPrivateState.get(botId);
    if (!ps) return;

    for (const item of items) {
      switch (item) {
        case ShopItemType.FiveLeafClover:
          ps.hasFiveLeafClover = true;
          break;
        case ShopItemType.FourLeafClover:
          ps.hasFourLeafClover = true;
          ps.permanentLuck += 7;
          break;
        case ShopItemType.Cigarette:
          ps.luckBuffs.push({ amount: 5, turnsRemaining: 5 });
          break;
        case ShopItemType.Whiskey:
          ps.luckBuffs.push({ amount: 10, turnsRemaining: 3 });
          break;
        case ShopItemType.Gun:
          ps.hasGun = true;
          break;
        case ShopItemType.Bullet:
          ps.bullets += 1;
          break;
        case ShopItemType.CardSleeveUnlock:
          ps.hasCardSleeveUnlock = true;
          break;
        case ShopItemType.SleeveExtender:
          ps.hasSleeveExtender = true;
          break;
        case ShopItemType.XRayGoggles:
          ps.xrayCharges += 3;
          break;
        case ShopItemType.Rake:
          ps.hasRake = true;
          break;
        case ShopItemType.HiddenCamera:
          ps.hiddenCameraCharges += 3;
          break;
        case ShopItemType.Bond:
          ps.bonds.push({ roundsHeld: 0, purchasePrice: 50, currentValue: 50 });
          break;
        case ShopItemType.HeartOfHearts:
          ps.hasHeartOfHearts = true;
          break;
        case ShopItemType.SpadeOfSpades:
          ps.hasSpadeOfSpades = true;
          break;
        case ShopItemType.PairOfPairs:
          ps.hasPairOfPairs = true;
          break;
        case ShopItemType.ImprovedPairOfPairs:
          ps.hasImprovedPairOfPairs = true;
          break;
        // ExtraCard, Joker, StockOption require card-selection UI — skip for starting items
        default:
          break;
      }
    }
  }

  returnToLobby(): void {
    this.gameState.phase = HandPhase.Lobby;
    this.gameState.round = BettingRound.None;
    
    this.winnerId = 0;
    this.winnerIds = [];
    this.foldedOut = false;

    // Reset all players' ready status when returning to Lobby
    // Each hand requires fresh ready-up
    for (const player of this.gameState.players) {
      player.isReady = false;
    }
    
    // In bot mode, auto-ready the bots so they're ready for the next hand
    for (const player of this.gameState.players) {
      if (player.isBot) {
        player.isReady = true;
      }
    }
  }

  joinTable(playerName: string): number {
    const playerId = this.gameState.players.length + 1;

    this.gameState.players.push({
      id: playerId,
      name: playerName,
      stack: 1000, // Default starting stack
      committedThisRound: 0,
      contributedThisHand: 0,
      isSeated: true,
      isReady: false,
      isInHand: false,
      hasFolded: false,
      isAllIn: false,
      isBot: false,
      isEliminated: false,
      inventory: [],
    });

    // Initialize private state for this player
    this.playerPrivateState.set(playerId, {
      hasGun: false,
      bullets: 0,
      hasCardSleeveUnlock: false,
      sleeveCard: null,
      hasSleeveExtender: false,
      sleeveCard2: null,
      xrayCharges: 0,
      loadedDeckCharges: 0,
      cardRerollCharges: 0,
      stickyFingersCharges: 0,
      permanentLuck: 0,
      luckBuffs: [],
      hasRake: false,
      hiddenCameraCharges: 0,
      cheatedThisHand: false,
      bonds: [],
      stockOptions: [],
      hasFourLeafClover: false,
      hasFiveLeafClover: false,
      unlockedShopSlots: 1,
      hasHeartOfHearts: false,
      hasSpadeOfSpades: false,
      spadeOfSpadesBonus: 5,
      hasPairOfPairs: false,
      hasImprovedPairOfPairs: false,
      hasWonWithOnePair: false,
      hasCardShark: false,
      hasRabbitsFoot: false,
      hasLostAtShowdown: false,
      hasEverBoughtLuckItem: false,
    });

    this.gameState.gameMode = 'multiplayer';

    return playerId;
  }

  playVsBots(playerName: string, profiles: BotProfile[] = DEFAULT_BOT_PROFILES): number {
    // Clear any existing players
    this.gameState.players = [];
    this.playerPrivateState.clear();
    this.botProfiles.clear();
    this.botHandCounts.clear();
    this.botItemRulesFiredThisHand.clear();
    this.holeCards.clear();
    this.playerShopSlots.clear();
    this.deck = [];
    this.lastRaiserId = 0;
    this.playersActedThisRound.clear();
    this.sleeveSwappedThisRound.clear();
    this.winnerId = 0;
    this.winnerIds = [];
    this.foldedOut = false;
    this.smallBlind = 5;
    this.bigBlind = 10;
    this.handsPlayedSinceBlindIncrease = 0;
    this.gameState.phase = HandPhase.Lobby;
    this.gameState.round = BettingRound.None;
    this.gameState.pot = 0;
    this.gameState.currentBetToMatch = 0;
    this.gameState.smallBlind = 5;
    this.gameState.bigBlind = 10;
    this.gameState.board = [];
    this.gameState.activePlayerId = 0;
    this.gameState.dealerPlayerId = 0;
    this.gameState.caughtCheaterPlayerId = null;
    this.gameState.gameMode = 'vsBot';
    this.gameState.turnDeadline = null;

    // Add human player
    const playerId = 1;
    this.gameState.players.push({
      id: playerId,
      name: playerName,
      stack: 1000,
      committedThisRound: 0,
      contributedThisHand: 0,
      isSeated: true,
      isReady: false,
      isInHand: false,
      hasFolded: false,
      isAllIn: false,
      isBot: false,
      isEliminated: false,
      inventory: [],
    });

    this.playerPrivateState.set(playerId, {
      hasGun: false,
      bullets: 0,
      hasCardSleeveUnlock: false,
      sleeveCard: null,
      hasSleeveExtender: false,
      sleeveCard2: null,
      xrayCharges: 0,
      loadedDeckCharges: 0,
      cardRerollCharges: 0,
      stickyFingersCharges: 0,
      permanentLuck: 0,
      luckBuffs: [],
      hasRake: false,
      hiddenCameraCharges: 0,
      cheatedThisHand: false,
      bonds: [],
      stockOptions: [],
      hasFourLeafClover: false,
      hasFiveLeafClover: false,
      unlockedShopSlots: 1,
      hasHeartOfHearts: false,
      hasSpadeOfSpades: false,
      spadeOfSpadesBonus: 5,
      hasPairOfPairs: false,
      hasImprovedPairOfPairs: false,
      hasWonWithOnePair: false,
      hasCardShark: false,
      hasRabbitsFoot: false,
      hasLostAtShowdown: false,
      hasEverBoughtLuckItem: false,
    });

    // Shuffle profiles and pick 3 (Fisher-Yates)
    const shuffled = [...profiles];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const selectedProfiles = shuffled.slice(0, 3);

    // Add bots from profiles
    for (let i = 0; i < selectedProfiles.length; i++) {
      const profile = selectedProfiles[i];
      const botId = i + 2; // IDs 2, 3, 4, …

      this.gameState.players.push({
        id: botId,
        name: profile.displayName,
        stack: 1000,
        committedThisRound: 0,
        contributedThisHand: 0,
        isSeated: true,
        isReady: true, // Bots auto-ready
        isInHand: false,
        hasFolded: false,
        isAllIn: false,
        isBot: true,
        isEliminated: false,
        inventory: [],
      });

      this.playerPrivateState.set(botId, {
        hasGun: false,
        bullets: 0,
        hasCardSleeveUnlock: false,
        sleeveCard: null,
        hasSleeveExtender: false,
        sleeveCard2: null,
        xrayCharges: 0,
        loadedDeckCharges: 0,
        cardRerollCharges: 0,
        stickyFingersCharges: 0,
        permanentLuck: 0,
        luckBuffs: [],
        hasRake: false,
        hiddenCameraCharges: 0,
        cheatedThisHand: false,
        bonds: [],
        stockOptions: [],
        hasFourLeafClover: false,
        hasFiveLeafClover: false,
        unlockedShopSlots: 1,
        hasHeartOfHearts: false,
        hasSpadeOfSpades: false,
        spadeOfSpadesBonus: 5,
        hasPairOfPairs: false,
        hasImprovedPairOfPairs: false,
        hasWonWithOnePair: false,
        hasCardShark: false,
        hasRabbitsFoot: false,
        hasLostAtShowdown: false,
        hasEverBoughtLuckItem: false,
      });

      this.botProfiles.set(botId, profile);
      this.applyBotStartingItems(botId, profile.startingItems);
    }

    return playerId;
  }

  setReady(playerId: number, isReady: boolean): void {
    const player = this.gameState.players.find(p => p.id === playerId);
    if (player) {
      player.isReady = isReady;
    }
  }

  /**
   * Initializes a gauntlet mode game.
   * Player starts round 1 vs 3 progressively harder bots.
   * Each subsequent round escalates bot bankroll based on previous round total.
   * 
   * @param playerName Name of the human player
   * @returns The player ID (typically 1)
   */
  initGauntlet(playerName: string): number {
    // Reset game state
    this.gameState.players = [];
    this.gameState.phase = HandPhase.Lobby;
    this.gameState.round = BettingRound.None;
    this.gameState.pot = 0;
    this.gameState.currentBetToMatch = 0;
    this.gameState.smallBlind = 5;
    this.gameState.bigBlind = 10;
    this.gameState.board = [];
    this.gameState.activePlayerId = 0;
    this.gameState.dealerPlayerId = 0;
    this.gameState.caughtCheaterPlayerId = null;
    this.gameState.gameMode = 'gauntlet';
    this.gameState.turnDeadline = null;

    // Initialize gauntlet state for round 1
    this.gameState.gauntletState = {
      currentRound: 1,
      maxRounds: GAUNTLET_MAX_ROUNDS,
      botProgressionByRound: GAUNTLET_BOT_PROGRESSION,
      previousRoundTotalChips: 0,
      playerCarriedStack: null,
    };

    const playerId = 1;
    const startingStack = 1000;
    this.gauntletPlayerStartingStack = startingStack;

    // Add human player
    this.gameState.players.push({
      id: playerId,
      name: playerName,
      stack: startingStack,
      committedThisRound: 0,
      contributedThisHand: 0,
      isSeated: true,
      isReady: false,
      isInHand: false,
      hasFolded: false,
      isAllIn: false,
      isBot: false,
      isEliminated: false,
      inventory: [],
    });

    this.playerPrivateState.set(playerId, {
      hasGun: false,
      bullets: 0,
      hasCardSleeveUnlock: false,
      sleeveCard: null,
      hasSleeveExtender: false,
      sleeveCard2: null,
      xrayCharges: 0,
      loadedDeckCharges: 0,
      cardRerollCharges: 0,
      stickyFingersCharges: 0,
      permanentLuck: 0,
      luckBuffs: [],
      hasRake: false,
      hiddenCameraCharges: 0,
      cheatedThisHand: false,
      bonds: [],
      stockOptions: [],
      hasFourLeafClover: false,
      hasFiveLeafClover: false,
      unlockedShopSlots: 1,
      hasHeartOfHearts: false,
      hasSpadeOfSpades: false,
      spadeOfSpadesBonus: 5,
      hasPairOfPairs: false,
      hasImprovedPairOfPairs: false,
      hasWonWithOnePair: false,
      hasCardShark: false,
      hasRabbitsFoot: false,
      hasLostAtShowdown: false,
      hasEverBoughtLuckItem: false,
    });

    // Add bots for round 1
    this.addGauntletRoundBots(1, startingStack);

    return playerId;
  }

  /**
   * Adds bots for a specific gauntlet round.
   * @param roundNumber 1-indexed round number
   * @param botStartingStack Starting stack for each bot in this round
   */
  private addGauntletRoundBots(roundNumber: number, botStartingStack: number): void {
    const botIds = getGauntletRoundBots(roundNumber);
    if (!botIds) return; // Invalid round number

    let nextBotId = 2; // Bot IDs start at 2

    for (const botId of botIds) {
      const profile = DEFAULT_BOT_PROFILES.find(p => p.id === botId);
      if (!profile) continue;

      const newBotId = nextBotId++;

      this.gameState.players.push({
        id: newBotId,
        name: profile.displayName,
        stack: botStartingStack,
        committedThisRound: 0,
        contributedThisHand: 0,
        isSeated: true,
        isReady: true,
        isInHand: false,
        hasFolded: false,
        isAllIn: false,
        isBot: true,
        isEliminated: false,
        inventory: [],
      });

      this.playerPrivateState.set(newBotId, {
        hasGun: false,
        bullets: 0,
        hasCardSleeveUnlock: false,
        sleeveCard: null,
        hasSleeveExtender: false,
        sleeveCard2: null,
        xrayCharges: 0,
        loadedDeckCharges: 0,
        cardRerollCharges: 0,
        stickyFingersCharges: 0,
        permanentLuck: 0,
        luckBuffs: [],
        hasRake: false,
        hiddenCameraCharges: 0,
        cheatedThisHand: false,
        bonds: [],
        stockOptions: [],
        hasFourLeafClover: false,
        hasFiveLeafClover: false,
        unlockedShopSlots: 1,
        hasHeartOfHearts: false,
        hasSpadeOfSpades: false,
        spadeOfSpadesBonus: 5,
        hasPairOfPairs: false,
        hasImprovedPairOfPairs: false,
        hasWonWithOnePair: false,
        hasCardShark: false,
        hasRabbitsFoot: false,
        hasLostAtShowdown: false,
        hasEverBoughtLuckItem: false,
      });

      this.botProfiles.set(newBotId, profile);
      this.applyBotStartingItems(newBotId, profile.startingItems);
    }
  }

  /**
   * Advances gauntlet mode to the next round or ends the game.
   * Called when current round is won (all bots eliminated).
   * 
   * @returns true if advancing to next round, false if gauntlet is complete
   */
  advanceGauntletRound(): boolean {
    if (!this.gameState.gauntletState) return false;

    const { currentRound, maxRounds } = this.gameState.gauntletState;

    if (currentRound >= maxRounds) {
      // Gauntlet is complete - player won!
      return false;
    }

    // Calculate total chips from this round (for bot starting stack in next round)
    const totalThisRound = this.gameState.players.reduce((sum, p) => sum + p.stack, 0);

    // Prepare for next round
    const nextRound = currentRound + 1;
    const playerStack = this.gameState.players[0].stack; // Player is always ID 1 (index 0)
    const nextBotStack = calculateNextRoundBotStartingStack(totalThisRound);

    // Update gauntlet state
    this.gameState.gauntletState.currentRound = nextRound;
    this.gameState.gauntletState.previousRoundTotalChips = totalThisRound;
    this.gauntletTotalPreviousRound = totalThisRound;

    // Reset for new round, keeping player and eliminating old bots
    const player = this.gameState.players[0];
    this.gameState.players = [player]; // Keep only the player
    player.stack = playerStack;
    player.isReady = false;
    player.isInHand = false;
    player.hasFolded = false;
    player.isAllIn = false;
    player.isEliminated = false;

    // Clear bot profiles and states for old bots
    this.botProfiles.clear();
    this.playerPrivateState.forEach((_, id) => {
      if (id !== 1) this.playerPrivateState.delete(id);
    });

    // Add new bots for this round
    this.addGauntletRoundBots(nextRound, nextBotStack);

    // Reset for the new hand
    this.gameState.phase = HandPhase.Lobby;
    this.gameState.round = BettingRound.None;
    this.gameState.pot = 0;
    this.gameState.currentBetToMatch = 0;
    this.gameState.board = [];
    this.gameState.activePlayerId = 0;
    this.gameState.dealerPlayerId = 0;
    this.gameState.caughtCheaterPlayerId = null;
    this.gameState.turnDeadline = null;

    return true;
  }

  /**
   * Executes automatic shop purchases for bots with special shopping behaviors.
   * Called during the ItemShop phase for each bot that needs auto-purchases.
   * 
   * - Gunslinger: Buys a bullet for $100 if they have 0 bullets
   * - Mr. Roboto: Buys X-Ray Goggles and Hidden Camera if charges are depleted
   */
  executeBotShopPurchases(botId: number): void {
    const bot = this.gameState.players.find(p => p.id === botId);
    const profile = this.botProfiles.get(botId);
    const ps = this.playerPrivateState.get(botId);

    if (!bot || !profile || !ps) return;

    // Gunslinger: Buy bullets if empty
    if (profile.id === 'gunslinger') {
      if (ps.bullets === 0 && bot.stack >= 100) {
        bot.stack -= 100;
        ps.bullets += 1;
      }
    }

    // Mr. Roboto: Buy X-Ray Goggles if charges depleted
    if (profile.id === 'mr-roboto') {
      if (ps.xrayCharges === 0 && bot.stack >= getPrice(ShopItemType.XRayGoggles)) {
        const cost = getPrice(ShopItemType.XRayGoggles);
        bot.stack -= cost;
        ps.xrayCharges = 3; // X-Ray comes with 3 charges
      }

      // Mr. Roboto: Buy Hidden Camera if charges depleted
      if (ps.hiddenCameraCharges === 0 && bot.stack >= getPrice(ShopItemType.HiddenCamera)) {
        const cost = getPrice(ShopItemType.HiddenCamera);
        bot.stack -= cost;
        ps.hiddenCameraCharges = 3; // Hidden Camera comes with 3 charges
      }
    }
  }

  canStartHand(playerId: number): boolean {
    // Only allow if enough players are ready
    const readyCount = this.gameState.players.filter(p => p.isReady).length;
    return readyCount >= 2; // Minimum 2 players
  }

  startHand(): void {
    // Eliminate players who can't meet the big blind before the hand begins
    for (const player of this.gameState.players) {
      if (player.isSeated && !player.isEliminated && player.stack < this.bigBlind) {
        player.isEliminated = true;
      }
    }

    // Reset player states for new hand
    for (const player of this.gameState.players) {
      player.committedThisRound = 0;
      player.contributedThisHand = 0;
      player.hasFolded = false;
      player.isInHand = false;
      player.isAllIn = false;
      player.lastAction = undefined; // Clear last action
    }

    // Reset cheat tracking for each player + tick investments + tick luck buffs
    for (const [_, ps] of this.playerPrivateState) {
      ps.cheatedThisHand = false;

      // Age bonds and stock options
      for (const bond of ps.bonds) {
        bond.roundsHeld++;
        // Grow 25% per hand starting from the 2nd hand held (not the first)
        if (bond.roundsHeld >= 2) {
          bond.currentValue = Math.min(1000, Math.round(bond.currentValue * 1.25));
        }
      }
      for (const opt of ps.stockOptions) opt.roundsHeld++;

      // Tick down luck buffs and remove expired ones
      // (moved to tickLuckBuffs(), called when transitioning to ItemShop)

      // Note: unlockedShopSlots is intentionally NOT reset — slot unlocks persist across hands
    }

    // Rotate dealer button — skip eliminated players
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (activePlayers.length === 0) return;
    if (this.gameState.dealerPlayerId === 0) {
      this.gameState.dealerPlayerId = activePlayers[0].id;
    } else {
      const dealerIdx = activePlayers.findIndex(p => p.id === this.gameState.dealerPlayerId);
      const nextIdx = (dealerIdx + 1) % activePlayers.length;
      this.gameState.dealerPlayerId = activePlayers[nextIdx].id;
    }

    // Blind increase — double every two full rotations around the table
    this.handsPlayedSinceBlindIncrease++;
    const handsPerIncrease = activePlayers.length * 2;
    if (this.handsPlayedSinceBlindIncrease >= handsPerIncrease) {
      this.smallBlind *= 2;
      this.bigBlind *= 2;
      this.gameState.smallBlind = this.smallBlind;
      this.gameState.bigBlind = this.bigBlind;
      this.handsPlayedSinceBlindIncrease = 0;
    }

    this.gameState.phase = HandPhase.Dealing;
    this.gameState.round = BettingRound.Preflop;
    this.gameState.pot = 0;
    this.gameState.currentBetToMatch = 0;
    this.gameState.board = [];
    this.holeCards.clear();
    this.playersActedThisRound.clear(); // Reset action tracking for new hand
    this.sleeveSwappedThisRound.clear(); // Reset sleeve swap tracking for new hand
    this.cardRerolledThisHand.clear();   // Reset card reroll tracking for new hand
    this.botItemRulesFiredThisHand.clear();
    this.foldedOut = false;
    this.winnerId = 0;
    this.winnerIds = [];

    // Increment hand count for each bot
    for (const player of this.gameState.players) {
      if (player.isBot) {
        this.botHandCounts.set(player.id, (this.botHandCounts.get(player.id) ?? 0) + 1);
      }
    }
    this.lastRaiserId = 0;

    // Shuffle deck and deal
    this.shuffleDeck();
    this.dealHoleCards();

    // Post blinds
    this.postBlinds();

    // Transition to betting
    this.gameState.phase = HandPhase.Betting;
    // First to act preflop is the player after the big blind
    const sbId = this.getNextActivePlayerFromDealer(this.gameState.dealerPlayerId);
    const bbId = this.getNextActivePlayerFromDealer(sbId);
    const utgId = this.getNextActivePlayerFromDealer(bbId);
    this.gameState.activePlayerId = utgId || sbId || this.gameState.dealerPlayerId;
    
    // Big blind is last to act preflop — but this is a forced blind, not a voluntary raise
    // so lastRaiserId stays 0 (no raise yet; round ends when all non-all-in players have acted)
    this.lastRaiserId = 0;

    // Set initial betting deadline in multiplayer mode
    this.updateBettingDeadline();
  }

  private updateBettingDeadline(): void {
    if (this.gameState.gameMode !== 'multiplayer') return;
    if (this.gameState.phase === HandPhase.Betting) {
      const nextPlayer = this.gameState.players.find(p => p.id === this.gameState.activePlayerId);
      if (nextPlayer && !nextPlayer.isBot) {
        this.setTurnDeadline(this.gameState.timerSettings.bettingSeconds);
      } else {
        this.setTurnDeadline(null);
      }
    } else {
      this.setTurnDeadline(null);
    }
  }

  submitAction(playerId: number, action: PokerAction): boolean {
    if (this.gameState.activePlayerId !== playerId) {
      return false; // Not this player's turn
    }

    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player || player.hasFolded) {
      return false;
    }

    // All-in players can only Check (pass their turn — use items before clicking)
    if (player.isAllIn) {
      if (action.type !== PokerActionType.Check) {
        return false;
      }
      player.lastAction = { type: PokerActionType.Check };
      this.playersActedThisRound.add(playerId);

      const activePlayersCount = this.gameState.players.filter(
        p => p.isInHand && !p.hasFolded
      ).length;
      if (activePlayersCount === 1) {
        this.handleFoldOutWinner();
        this.updateBettingDeadline();
        return true;
      }

      this.gameState.activePlayerId = this.getNextActivePlayer(playerId);
      if (this.isBettingRoundComplete()) {
        this.advanceBettingRound();
      }
      this.updateBettingDeadline();
      return true;
    }

    switch (action.type) {
      case PokerActionType.Fold:
        player.hasFolded = true;
        player.lastAction = { type: PokerActionType.Fold };
        break;

      case PokerActionType.Check:
        // Can only check if player has matched the current bet
        const betToMatch = this.gameState.currentBetToMatch - player.committedThisRound;
        if (betToMatch > 0) {
          return false; // Can't check if there's unmatched bet
        }
        player.lastAction = { type: PokerActionType.Check };
        break;

      case PokerActionType.Call:
        const amountToCall = this.gameState.currentBetToMatch - player.committedThisRound;
        if (amountToCall > 0) {
          const actualAmount = Math.min(amountToCall, player.stack);
          player.stack -= actualAmount;
          player.committedThisRound += actualAmount;
          player.contributedThisHand += actualAmount;
          this.gameState.pot += actualAmount;
          player.lastAction = { type: PokerActionType.Call, amount: actualAmount };

          if (player.stack === 0) {
            player.isAllIn = true;
          }
        } else {
          player.lastAction = { type: PokerActionType.Check };
        }
        break;

      case PokerActionType.RaiseTo:
        const raiseAmount = (action.raiseToAmount || 0) - player.committedThisRound;
        if (raiseAmount > 0 && raiseAmount <= player.stack) {
          player.stack -= raiseAmount;
          player.committedThisRound += raiseAmount;
          player.contributedThisHand += raiseAmount;
          this.gameState.pot += raiseAmount;
          this.gameState.currentBetToMatch = action.raiseToAmount || 0;
          this.lastRaiserId = playerId;
          // Only non-all-in players need to respond — all-in players keep their acted flag
          for (const p of this.gameState.players) {
            if (p.isInHand && !p.hasFolded && !p.isAllIn) {
              this.playersActedThisRound.delete(p.id);
            }
          }
          player.lastAction = { type: PokerActionType.RaiseTo, amount: action.raiseToAmount };

          if (player.stack === 0) {
            player.isAllIn = true;
          }
        } else {
          return false;
        }
        break;

      default:
        return false;
    }

    // Track that this player has acted
    this.playersActedThisRound.add(playerId);

    // Check if only 1 active player remains (all others folded)
    const activePlayersCount = this.gameState.players.filter(
      p => p.isInHand && !p.hasFolded
    ).length;

    if (activePlayersCount === 1) {
      // One player remains - they win immediately
      this.handleFoldOutWinner();
      this.updateBettingDeadline();
      return true;
    }

    // Move to next active player
    this.gameState.activePlayerId = this.getNextActivePlayer(playerId);

    // Check if betting round is complete
    if (this.isBettingRoundComplete()) {
      this.advanceBettingRound();
    }

    this.updateBettingDeadline();
    return true;
  }

  useItem(playerId: number, useType: number, targetPlayerId?: number): boolean {
    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) return false;

    const privateState = this.playerPrivateState.get(playerId);
    if (!privateState) return false;

    // Only allow swaps before showdown phase
    if (this.gameState.phase === HandPhase.Showdown) {
      return false;
    }

    // Handle sleeve card swaps (slot 1)
    if (useType === UseItemType.UseSleeveCardSwapHoleA || useType === UseItemType.UseSleeveCardSwapHoleB) {
      // Validate player has unlock and sleeve card
      if (!privateState.hasCardSleeveUnlock || !privateState.sleeveCard) {
        return false;
      }

      // Only 1 swap allowed per hand
      if (this.sleeveSwappedThisRound.has(playerId)) {
        return false;
      }

      const holeCards = this.holeCards.get(playerId);
      if (!holeCards) return false;

      // Determine which hole card to swap
      const swapIndex = useType === UseItemType.UseSleeveCardSwapHoleA ? 0 : 1;
      const swappedCard = holeCards[swapIndex];

      // Perform the swap
      holeCards[swapIndex] = privateState.sleeveCard;
      privateState.sleeveCard = swappedCard;

      this.sleeveSwappedThisRound.add(playerId);
      privateState.cheatedThisHand = true;
      return true;
    }

    // Handle sleeve card swaps (slot 2)
    if (useType === UseItemType.UseSleeveCard2SwapHoleA || useType === UseItemType.UseSleeveCard2SwapHoleB) {
      if (!privateState.hasCardSleeveUnlock || !privateState.hasSleeveExtender || !privateState.sleeveCard2) {
        return false;
      }

      // Only 1 swap allowed per hand (shared limit with slot 1)
      if (this.sleeveSwappedThisRound.has(playerId)) {
        return false;
      }

      const holeCards = this.holeCards.get(playerId);
      if (!holeCards) return false;

      const swapIndex = useType === UseItemType.UseSleeveCard2SwapHoleA ? 0 : 1;
      const swappedCard = holeCards[swapIndex];

      holeCards[swapIndex] = privateState.sleeveCard2;
      privateState.sleeveCard2 = swappedCard;

      this.sleeveSwappedThisRound.add(playerId);
      privateState.cheatedThisHand = true;
      return true;
    }

    // Default: other item usages (banking, etc.)
    return true;
  }

  buyItem(playerId: number, itemType: number, targetSlot?: 0 | 1): boolean {
    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) return false;

    const privateState = this.playerPrivateState.get(playerId);
    if (!privateState) return false;

    // Handle CardSleeveUnlock
    if (itemType === ShopItemType.CardSleeveUnlock) {
      const cost = 200;
      if (player.stack < cost) return false;
      if (privateState.hasCardSleeveUnlock) return false;
      player.stack -= cost;
      privateState.hasCardSleeveUnlock = true;
      player.inventory.push(ShopItemType.CardSleeveUnlock);
      return true;
    }

    // Handle Joker - put joker card in sleeve (replaces existing card if both slots full)
    if (itemType === ShopItemType.Joker) {
      if (!privateState.hasCardSleeveUnlock) return false;
      const cost = getPrice(ShopItemType.Joker);
      if (player.stack < cost) return false;
      // If caller specified a target slot, honour it
      if (targetSlot === 0 || targetSlot === 1) {
        if (targetSlot === 1 && !privateState.hasSleeveExtender) return false;
        player.stack -= cost;
        if (targetSlot === 0) privateState.sleeveCard = JOKER_CARD;
        else privateState.sleeveCard2 = JOKER_CARD;
        return true;
      }
      // Auto-fill: slot 1 first, then slot 2, then replace slot 1
      if (privateState.sleeveCard === null) {
        player.stack -= cost;
        privateState.sleeveCard = JOKER_CARD;
        return true;
      }
      if (privateState.hasSleeveExtender && privateState.sleeveCard2 === null) {
        player.stack -= cost;
        privateState.sleeveCard2 = JOKER_CARD;
        return true;
      }
      // Both slots occupied — replace slot 1
      player.stack -= cost;
      privateState.sleeveCard = JOKER_CARD;
      return true;
    }

    // Handle SleeveExtender
    if (itemType === ShopItemType.SleeveExtender) {
      if (!privateState.hasCardSleeveUnlock) return false;
      if (privateState.hasSleeveExtender) return false;
      const cost = getPrice(ShopItemType.SleeveExtender);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.hasSleeveExtender = true;
      player.inventory.push(ShopItemType.SleeveExtender);
      return true;
    }

    // Handle XRayGoggles — adds 3 charges to existing
    if (itemType === ShopItemType.XRayGoggles) {
      const cost = getPrice(ShopItemType.XRayGoggles);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.xrayCharges += 3;
      player.inventory.push(ShopItemType.XRayGoggles);
      return true;
    }

    // Handle Rake
    if (itemType === ShopItemType.Rake) {
      if (privateState.hasRake) return false;
      const cost = getPrice(ShopItemType.Rake);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.hasRake = true;
      player.inventory.push(ShopItemType.Rake);
      return true;
    }

    // Handle HiddenCamera — adds 3 charges to existing
    if (itemType === ShopItemType.HiddenCamera) {
      const cost = getPrice(ShopItemType.HiddenCamera);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.hiddenCameraCharges += 3;
      player.inventory.push(ShopItemType.HiddenCamera);
      return true;
    }

    // Handle LoadedDeck — adds 3 charges; requires xray charges or existing loaded deck charges
    if (itemType === ShopItemType.LoadedDeck) {
      if (privateState.xrayCharges <= 0 && privateState.loadedDeckCharges <= 0) return false;
      const cost = getPrice(ShopItemType.LoadedDeck);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.loadedDeckCharges += 3;
      player.inventory.push(ShopItemType.LoadedDeck);
      return true;
    }

    // Handle CardReroll — adds 2 charges
    if (itemType === ShopItemType.CardReroll) {
      const cost = getPrice(ShopItemType.CardReroll);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.cardRerollCharges += 2;
      player.inventory.push(ShopItemType.CardReroll);
      return true;
    }

    // Handle StickyFingers — adds 1 charge; requires hidden camera and sleeve unlock
    if (itemType === ShopItemType.StickyFingers) {
      if (privateState.hiddenCameraCharges <= 0 && privateState.stickyFingersCharges <= 0) return false;
      if (!privateState.hasCardSleeveUnlock) return false;
      const cost = getPrice(ShopItemType.StickyFingers);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.stickyFingersCharges += 1;
      player.inventory.push(ShopItemType.StickyFingers);
      return true;
    }

    // Handle CardShark — unique passive; requires having lost at showdown
    if (itemType === ShopItemType.CardShark) {
      if (privateState.hasCardShark) return false;
      if (!privateState.hasLostAtShowdown) return false;
      const cost = getPrice(ShopItemType.CardShark);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.hasCardShark = true;
      player.inventory.push(ShopItemType.CardShark);
      return true;
    }

    // Handle RabbitsFoot — unique passive; requires having bought a luck item
    if (itemType === ShopItemType.RabbitsFoot) {
      if (privateState.hasRabbitsFoot) return false;
      if (!privateState.hasEverBoughtLuckItem) return false;
      const cost = getPrice(ShopItemType.RabbitsFoot);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.hasRabbitsFoot = true;
      player.inventory.push(ShopItemType.RabbitsFoot);
      return true;
    }

    if (itemType === ShopItemType.Gun) {
      if (privateState.hasGun) return false;
      const cost = getPrice(ShopItemType.Gun);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.hasGun = true;
      player.inventory.push(ShopItemType.Gun);
      return true;
    }

    // Handle Bullet
    if (itemType === ShopItemType.Bullet) {
      if (!privateState.hasGun) return false;
      const cost = getPrice(ShopItemType.Bullet);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.bullets++;
      return true;
    }

    // Handle Cigarette — +5 luck for 5 hands (cosmetic-only if player has 5-leaf clover)
    if (itemType === ShopItemType.Cigarette) {
      const cost = getPrice(ShopItemType.Cigarette);
      if (player.stack < cost) return false;
      player.stack -= cost;
      player.inventory.push(ShopItemType.Cigarette);
      privateState.hasEverBoughtLuckItem = true;
      if (!privateState.hasFiveLeafClover) {
        privateState.luckBuffs.push({ amount: 5, turnsRemaining: 5 });
      }
      return true;
    }

    // Handle Whiskey — +10 luck for 5 hands (cosmetic-only if player has 5-leaf clover)
    if (itemType === ShopItemType.Whiskey) {
      const cost = getPrice(ShopItemType.Whiskey);
      if (player.stack < cost) return false;
      player.stack -= cost;
      player.inventory.push(ShopItemType.Whiskey);
      privateState.hasEverBoughtLuckItem = true;
      if (!privateState.hasFiveLeafClover) {
        privateState.luckBuffs.push({ amount: 10, turnsRemaining: 5 });
      }
      return true;
    }

    // Handle 4 Leaf Clover — permanently +7 luck (one-time)
    if (itemType === ShopItemType.FourLeafClover) {
      const cost = getPrice(ShopItemType.FourLeafClover);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.permanentLuck += 7;
      privateState.hasFourLeafClover = true;
      privateState.hasEverBoughtLuckItem = true;
      player.inventory.push(ShopItemType.FourLeafClover);
      return true;
    }

    // Handle 5 Leaf Clover — lock luck to 77 (one-time effect); subsequent purchases are cosmetic
    if (itemType === ShopItemType.FiveLeafClover) {
      const cost = getPrice(ShopItemType.FiveLeafClover);
      if (player.stack < cost) return false;
      player.stack -= cost;
      if (!privateState.hasFiveLeafClover) {
        privateState.hasFiveLeafClover = true;
      }
      privateState.hasEverBoughtLuckItem = true;
      player.inventory.push(ShopItemType.FiveLeafClover);
      return true;
    }

    // Handle Bond — random-priced investment, value grows 10%/hand
    if (itemType === ShopItemType.Bond) {
      const slots = this.playerShopSlots.get(playerId) || [];
      const slot = slots.find(s => s.type === ShopItemType.Bond);
      const cost = slot?.price ?? getPrice(ShopItemType.Bond);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.bonds.push({ roundsHeld: 0, purchasePrice: cost, currentValue: cost });
      return true;
    }

    // Handle Stock Option — random-priced investment, cashable after 3 hands
    if (itemType === ShopItemType.StockOption) {
      const slots = this.playerShopSlots.get(playerId) || [];
      const slot = slots.find(s => s.type === ShopItemType.StockOption);
      const cost = slot?.price ?? getPrice(ShopItemType.StockOption);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.stockOptions.push({ roundsHeld: 0, purchasePrice: cost });
      return true;
    }

    // Handle ExtraCard - select random card and deduct dynamic cost (fallback; normally use buy-extra-card)
    if (itemType === ShopItemType.ExtraCard) {
      const randomCard = this.getRandomAvailableCard();
      if (!randomCard) return false;

      const cost = getCardPrice(randomCard);
      if (player.stack < cost) return false;

      if (privateState.sleeveCard === null) {
        player.stack -= cost;
        privateState.sleeveCard = randomCard;
        return true;
      }
      if (privateState.hasSleeveExtender && privateState.sleeveCard2 === null) {
        player.stack -= cost;
        privateState.sleeveCard2 = randomCard;
        return true;
      }
      return false;
    }

    // Handle HeartOfHearts
    if (itemType === ShopItemType.HeartOfHearts) {
      if (privateState.hasHeartOfHearts) return false;
      const cost = getPrice(ShopItemType.HeartOfHearts);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.hasHeartOfHearts = true;
      player.inventory.push(ShopItemType.HeartOfHearts);
      return true;
    }

    // Handle SpadeOfSpades
    if (itemType === ShopItemType.SpadeOfSpades) {
      if (privateState.hasSpadeOfSpades) return false;
      const cost = getPrice(ShopItemType.SpadeOfSpades);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.hasSpadeOfSpades = true;
      player.inventory.push(ShopItemType.SpadeOfSpades);
      return true;
    }

    // Handle PairOfPairs
    if (itemType === ShopItemType.PairOfPairs) {
      if (privateState.hasPairOfPairs) return false;
      const cost = getPrice(ShopItemType.PairOfPairs);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.hasPairOfPairs = true;
      player.inventory.push(ShopItemType.PairOfPairs);
      return true;
    }

    // Handle ImprovedPairOfPairs
    if (itemType === ShopItemType.ImprovedPairOfPairs) {
      if (!privateState.hasPairOfPairs || privateState.hasImprovedPairOfPairs) return false;
      const cost = getPrice(ShopItemType.ImprovedPairOfPairs);
      if (player.stack < cost) return false;
      player.stack -= cost;
      privateState.hasImprovedPairOfPairs = true;
      player.inventory.push(ShopItemType.ImprovedPairOfPairs);
      return true;
    }

    // Default existing items (Item1, Item2, Item3)
    const itemCosts: { [key: number]: number } = {
      [ItemType.Item1]: 50,
      [ItemType.Item2]: 75,
      [ItemType.Item3]: 100,
    };

    const cost = itemCosts[itemType];
    if (!cost || player.stack < cost) {
      return false; // Not enough chips
    }

    player.stack -= cost;
    player.inventory.push(itemType);
    return true;
  }

  cashOutBond(playerId: number, bondIndex: number): { success: boolean; amount: number; error?: string } {
    const player = this.gameState.players.find(p => p.id === playerId);
    const ps = this.playerPrivateState.get(playerId);
    if (!player || !ps) return { success: false, amount: 0, error: 'Player not found' };
    if (bondIndex < 0 || bondIndex >= ps.bonds.length) return { success: false, amount: 0, error: 'Invalid bond' };

    const bond = ps.bonds[bondIndex];
    const value = getBondCashOutValue(bond);
    player.stack += value;
    ps.bonds.splice(bondIndex, 1);
    return { success: true, amount: value };
  }

  cashOutStockOption(playerId: number, optionIndex: number): { success: boolean; amount: number; error?: string } {
    const player = this.gameState.players.find(p => p.id === playerId);
    const ps = this.playerPrivateState.get(playerId);
    if (!player || !ps) return { success: false, amount: 0, error: 'Player not found' };
    if (optionIndex < 0 || optionIndex >= ps.stockOptions.length) return { success: false, amount: 0, error: 'Invalid stock option' };

    const result = getStockOptionCashOutValue(ps.stockOptions[optionIndex]);
    if (!result.eligible) return { success: false, amount: 0, error: 'Must wait 3 hands before cashing out' };

    player.stack += result.amount;
    ps.stockOptions.splice(optionIndex, 1);
    return { success: true, amount: result.amount };
  }

  /**
   * Executes any pending item rules for a bot on the current hand.
   * Fires at most once per hand per bot. Returns true if an action was taken
   * (caller should emit an updated game state to clients).
   */
  executeBotItemRules(botId: number): boolean {
    if (this.botItemRulesFiredThisHand.has(botId)) return false;

    const profile = this.botProfiles.get(botId);
    if (!profile?.strategy.itemRules?.length) return false;

    const handCount = this.botHandCounts.get(botId) ?? 0;
    if (handCount === 0) return false;

    let didSomething = false;

    for (const rule of profile.strategy.itemRules) {
      if (handCount % rule.everyNHands !== 0) continue;

      if (rule.action === 'cash-out-stock-option') {
        const ps = this.playerPrivateState.get(botId);
        if (ps && ps.stockOptions.length > 0) {
          const result = this.cashOutStockOption(botId, 0);
          if (result.success) {
            didSomething = true;
            if (rule.replaceWith !== undefined) {
              this.applyBotStartingItems(botId, [rule.replaceWith]);
            }
          }
        }
      } else if (rule.action === 'cash-out-bond') {
        const ps = this.playerPrivateState.get(botId);
        if (ps && ps.bonds.length > 0) {
          const result = this.cashOutBond(botId, 0);
          if (result.success) {
            didSomething = true;
            if (rule.replaceWith !== undefined) {
              this.applyBotStartingItems(botId, [rule.replaceWith]);
            }
          }
        }
      }
    }

    if (didSomething) {
      this.botItemRulesFiredThisHand.add(botId);
    }
    return didSomething;
  }

  /**
   * Determines if a bot should use X-Ray Goggles and if so, returns the peeked card.
   * Only bots with strategic or random usage styles that own X-Ray Goggles will peek.
   * Strategic bots peek when pot odds justify it; random bots peek based on probability.
   * 
   * Returns true if bot should use X-Ray Goggles.
   * Note: The actual card consumption and cheating flag will be handled by the caller.
   */
  botShouldUseXRayGoggles(botId: number): boolean {
    const profile = this.botProfiles.get(botId);
    if (!profile) return false;

    const { itemStrategy } = profile;
    if (!itemStrategy.useXRayGoggles) return false;

    // Check if bot owns X-Ray Goggles with charges
    const ps = this.playerPrivateState.get(botId);
    if (!ps || ps.xrayCharges <= 0) return false;

    const botStack = this.gameState.players.find(p => p.id === botId)?.stack ?? 0;

    // Use helper from bots.ts to decide if bot should use X-Ray
    return shouldBotUseXRayGoggles(profile, this.gameState, botStack);
  }

  /**
   * Executes bot sleeve strategy: determines which hole cards the bot should place in sleeves.
   * Strategic bots hide high-value cards (face cards, pairs); others don't use sleeves.
   * 
   * Returns indices of cards to hide, or empty array if none should be hidden.
   */
  botExecuteSleeveStrategy(botId: number, holeCards: [Card, Card]): number[] {
    const profile = this.botProfiles.get(botId);
    if (!profile) return [];

    const ps = this.playerPrivateState.get(botId);
    if (!ps) return [];

    // Calculate available sleeve capacity
    let sleeveCapacity = 0;
    if (ps.hasCardSleeveUnlock) {
      sleeveCapacity = 1;
    }
    if (ps.hasSleeveExtender) {
      sleeveCapacity = 2;
    }

    if (sleeveCapacity === 0) return [];

    // Use selectCardsForBotSleeve from bots.ts to determine which cards to hide
    return selectCardsForBotSleeve(profile, holeCards, sleeveCapacity);
  }

  /**
   * Determines if a bot should use Gun item against a target.
   * Strategic bots only shoot confirmed cheaters; random bots shoot with low probability.
   * 
   * Returns true if bot should attempt to shoot.
   */
  botShouldUseGun(botId: number, targetId: number, targetCheated: boolean): boolean {
    const profile = this.botProfiles.get(botId);
    if (!profile) return false;

    const ps = this.playerPrivateState.get(botId);
    if (!ps) return false;

    // Check if bot owns Gun and bullets
    if (!ps.hasGun || ps.bullets <= 0) return false;

    // Use helper from bots.ts to decide if bot should shoot
    return shouldBotUseGun(profile, targetCheated);
  }

  playerDisconnected(playerId: number): void {
    const player = this.gameState.players.find(p => p.id === playerId);
    if (player) {
      player.isSeated = false;
    }
  }

  getRandomAvailableCardFor(playerId: number): Card | null {
    return this.getRandomAvailableCard();
  }

  buyExtraCard(playerId: number, card: Card, targetSlot?: 0 | 1): boolean {
    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) return false;

    const privateState = this.playerPrivateState.get(playerId);
    if (!privateState) return false;

    const cost = getCardPrice(card);
    if (player.stack < cost) return false;

    // If caller specified a target slot, honour it
    if (targetSlot === 0 || targetSlot === 1) {
      if (targetSlot === 1 && !privateState.hasSleeveExtender) return false;
      player.stack -= cost;
      if (targetSlot === 0) privateState.sleeveCard = card;
      else privateState.sleeveCard2 = card;
      return true;
    }

    // Auto-fill: slot 1 first, then slot 2, then replace slot 1
    if (privateState.sleeveCard === null) {
      player.stack -= cost;
      privateState.sleeveCard = card;
      return true;
    }
    if (privateState.hasSleeveExtender && privateState.sleeveCard2 === null) {
      player.stack -= cost;
      privateState.sleeveCard2 = card;
      return true;
    }
    // Both slots occupied — replace slot 1
    player.stack -= cost;
    privateState.sleeveCard = card;
    return true;
  }

  getPlayerSleeveCards(playerId: number): { sleeveCard: Card | null; sleeveCard2: Card | null } {
    const privateState = this.playerPrivateState.get(playerId);
    return {
      sleeveCard: privateState?.sleeveCard || null,
      sleeveCard2: privateState?.sleeveCard2 || null,
    };
  }

  hasCardSleeveUnlock(playerId: number): boolean {
    const privateState = this.playerPrivateState.get(playerId);
    return privateState?.hasCardSleeveUnlock || false;
  }

  hasUsedSleeveThisHand(playerId: number): boolean {
    return this.sleeveSwappedThisRound.has(playerId);
  }

  shootPlayer(shooterId: number, targetId: number): { success: boolean; backfired: boolean; error?: string } {
    if (this.gameState.phase !== HandPhase.Showdown) {
      return { success: false, backfired: false, error: 'Can only shoot during showdown' };
    }

    const shooter = this.gameState.players.find(p => p.id === shooterId);
    const target = this.gameState.players.find(p => p.id === targetId);
    if (!shooter || !target) return { success: false, backfired: false, error: 'Player not found' };
    if (shooter.isEliminated) return { success: false, backfired: false, error: 'You are eliminated' };
    if (target.isEliminated) return { success: false, backfired: false, error: 'Target is already eliminated' };
    if (shooterId === targetId) return { success: false, backfired: false, error: 'Cannot shoot yourself' };

    const shooterState = this.playerPrivateState.get(shooterId);
    if (!shooterState || !shooterState.hasGun || shooterState.bullets <= 0) {
      return { success: false, backfired: false, error: 'No gun or bullets' };
    }

    shooterState.bullets--;

    const targetState = this.playerPrivateState.get(targetId);
    const targetCheated = targetState?.cheatedThisHand || false;

    if (targetCheated) {
      // Target cheated — shooter takes all their money
      const stolen = target.stack;
      target.stack = 0;
      target.isEliminated = true;
      shooter.stack += stolen;
      return { success: true, backfired: false };
    } else {
      // Target was innocent — backfire: shooter gives all money to target
      const lost = shooter.stack;
      shooter.stack = 0;
      shooter.isEliminated = true;
      target.stack += lost;
      return { success: true, backfired: true };
    }
  }

  /** Tick down luck buffs for all players — call when a hand ends (ItemShop transition). */
  tickLuckBuffs(): void {
    for (const ps of this.playerPrivateState.values()) {
      ps.luckBuffs = ps.luckBuffs
        .map(b => ({ ...b, turnsRemaining: b.turnsRemaining - 1 }))
        .filter(b => b.turnsRemaining > 0);
    }
  }

  generateShopSlots(playerId: number): ShopSlotItem[] {
    const privateState = this.playerPrivateState.get(playerId);
    if (!privateState) return [];

    // Build the set of unique items already owned by any player
    const ownedUniqueItems = new Set<ShopItemType>();
    for (const player of this.gameState.players) {
      for (const itemType of player.inventory) {
        if (getItemRarity(itemType as ShopItemType) === ShopItemRarity.Unique) {
          ownedUniqueItems.add(itemType as ShopItemType);
        }
      }
    }

    const eligible = getEligibleShopItems(privateState, ownedUniqueItems);
    const playerLuck = getTotalLuck(privateState);

    // Build weighted pool using luck-adjusted weights
    let pool: ShopItemType[] = [];
    for (const type of eligible) {
      const weight = getLuckBoostedWeight(type, playerLuck);
      for (let i = 0; i < weight; i++) pool.push(type);
    }

    // Weighted random selection: ExtraCard can appear multiple times, others are unique
    const selected: ShopItemType[] = [];
    const usedTypes = new Set<ShopItemType>();

    while (selected.length < 3 && pool.length > 0) {
      const idx = Math.floor(Math.random() * pool.length);
      const type = pool[idx];
      if (type === ShopItemType.ExtraCard || type === ShopItemType.Bullet || type === ShopItemType.Cigarette || type === ShopItemType.Whiskey) {
        // These can appear in multiple slots
        selected.push(type);
        pool.splice(idx, 1); // Remove only this one ticket
      } else if (!usedTypes.has(type)) {
        selected.push(type);
        usedTypes.add(type);
        pool = pool.filter(t => t !== type);
      } else {
        pool = pool.filter(t => t !== type);
      }
    }

    const slots: ShopSlotItem[] = selected.map((type: ShopItemType) => {
      const info = getShopItemInfo(type);
      const slot: ShopSlotItem = {
        type,
        price: getPrice(type),
        name: info.name,
        description: info.description,
        rarity: getItemRarity(type),
      };

      if (type === ShopItemType.ExtraCard) {
        const card = this.getWeightedRandomCardForShop();
        if (card) {
          slot.previewCard = card;
          slot.price = getCardPrice(card);
          // Aces are bronze; all other ranks are copper
          slot.rarity = card.rank === Rank.Ace ? ShopItemRarity.Bronze : ShopItemRarity.Copper;
        }
      }

      // Dynamic description for Spade of Spades — show current per-spade payout
      if (type === ShopItemType.SpadeOfSpades) {
        slot.description = `Earn $${privateState.spadeOfSpadesBonus} per spade drawn (your cards + board). Grows by $5 each hand you win.`;
      }

      // Dynamic random pricing for Bond and StockOption
      if (type === ShopItemType.Bond) {
        const randPrice = Math.floor(Math.random() * 16) * 10 + 50; // $50-$200 in $10 steps
        slot.price = randPrice;
        slot.description = `Invest $${randPrice}. Value grows 25%/hand (max $1,000 sell).`;
      } else if (type === ShopItemType.StockOption) {
        const randPrice = (Math.floor(Math.random() * 10) + 1) * 50; // $50-$500 in $50 steps
        slot.price = randPrice;
        slot.description = `Invest $${randPrice}. After 3 hands: 1/3 chance to sell for $${randPrice * 5}.`;
      }

      return slot;
    });

    // Mark slots that haven't been unlocked yet
    const slotsWithLock = slots.map((slot, idx) => ({
      ...slot,
      locked: idx >= privateState.unlockedShopSlots,
    }));

    this.playerShopSlots.set(playerId, slotsWithLock);
    return slotsWithLock;
  }

  unlockShopSlot(playerId: number): { success: boolean; error?: string } {
    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) return { success: false, error: 'Player not found' };

    const ps = this.playerPrivateState.get(playerId);
    if (!ps) return { success: false, error: 'State not found' };

    if (ps.unlockedShopSlots >= 3) {
      return { success: false, error: 'All slots already unlocked' };
    }

    const cost = ps.unlockedShopSlots === 1 ? 50 : 200; // 2nd slot = $50, 3rd = $200
    if (player.stack < cost) {
      return { success: false, error: 'Insufficient funds' };
    }

    player.stack -= cost;
    ps.unlockedShopSlots++;

    // Update stored slots to reflect the new unlock
    const currentSlots = this.playerShopSlots.get(playerId) || [];
    const updatedSlots = currentSlots.map((slot, idx) => ({
      ...slot,
      locked: idx >= ps.unlockedShopSlots,
    }));
    this.playerShopSlots.set(playerId, updatedSlots);

    return { success: true };
  }

  getShopSlots(playerId: number): ShopSlotItem[] {
    return this.playerShopSlots.get(playerId) || [];
  }

  refreshExtraCardPreview(playerId: number): ShopSlotItem | null {
    const slots = this.playerShopSlots.get(playerId);
    if (!slots) return null;

    const extraCardSlot = slots.find(s => s.type === ShopItemType.ExtraCard);
    if (!extraCardSlot) return null;

    const card = this.getWeightedRandomCardForShop();
    if (!card) return null;

    extraCardSlot.previewCard = card;
    extraCardSlot.price = getCardPrice(card);
    extraCardSlot.rarity = card.rank === Rank.Ace ? ShopItemRarity.Bronze : ShopItemRarity.Copper;
    return extraCardSlot;
  }

  useXRayGoggles(playerId: number): Card | null {
    const privateState = this.playerPrivateState.get(playerId);
    if (!privateState || privateState.xrayCharges <= 0) return null;
    if (this.gameState.phase !== HandPhase.Betting) return null;
    // All 5 community cards already on board at river — nothing left to peek at
    if (this.gameState.round === BettingRound.River) return null;

    if (this.deck.length === 0) return null;
    privateState.xrayCharges--;
    privateState.cheatedThisHand = true;
    return this.deck[this.deck.length - 1];
  }

  /**
   * Use a Loaded Deck charge to move the next community card to the bottom of the deck.
   * Returns true if successful. Best paired with X-Ray Goggles (peek then discard).
   */
  useLoadedDeck(playerId: number): boolean {
    const privateState = this.playerPrivateState.get(playerId);
    if (!privateState || privateState.loadedDeckCharges <= 0) return false;
    if (this.gameState.phase !== HandPhase.Betting) return false;
    // No community cards left to affect after River
    if (this.gameState.round === BettingRound.River) return false;
    if (this.deck.length === 0) return false;

    // Move the top card (next to be dealt) to the bottom of the deck
    const topCard = this.deck.pop()!;
    this.deck.unshift(topCard);

    privateState.loadedDeckCharges--;
    privateState.cheatedThisHand = true;
    return true;
  }

  /**
   * Rerolls a player's hole cards. Pre-flop only, once per hand.
   * Luck/PairOfPairs/HeartOfHearts effects are applied to the new cards.
   */
  rerollHoleCards(playerId: number): boolean {
    if (this.gameState.phase !== HandPhase.Betting) return false;
    if (this.gameState.round !== BettingRound.Preflop) return false;
    const ps = this.playerPrivateState.get(playerId);
    if (!ps || ps.cardRerollCharges <= 0) return false;
    if (this.cardRerolledThisHand.has(playerId)) return false;
    if (this.deck.length < 2) return false;

    let cardA = this.deck.pop()!;
    let cardB = this.deck.pop()!;

    const luck = getTotalLuck(ps);
    if (luck > 0) {
      cardA = this.applyLuckToHoleCard(cardA, cardB, luck);
      cardB = this.applyLuckToHoleCard(cardB, cardA, luck);
    }

    if (ps.hasPairOfPairs) {
      const allSuits: Suit[] = [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades];
      if (ps.hasImprovedPairOfPairs) {
        const highRank = cardA.rank >= cardB.rank ? cardA.rank : cardB.rank;
        cardA = { rank: highRank, suit: allSuits[Math.floor(Math.random() * 4)] };
        cardB = { rank: highRank, suit: allSuits[Math.floor(Math.random() * 4)] };
      } else {
        cardB = { rank: cardA.rank, suit: allSuits[Math.floor(Math.random() * 4)] };
      }
    }

    if (ps.hasHeartOfHearts) {
      cardA = { ...cardA, suit: Suit.Hearts };
      cardB = { ...cardB, suit: Suit.Hearts };
    }

    this.holeCards.set(playerId, [cardA, cardB]);
    ps.cardRerollCharges--;
    this.cardRerolledThisHand.add(playerId);
    return true;
  }

  /**
   * Steals a random hole card from the target into the player's sleeve.
   * Target receives a random deck replacement. Sets cheatedThisHand on the thief.
   * Requires Big Sleeves (hasCardSleeveUnlock) on the thief.
   */
  useStickyFingers(playerId: number, targetPlayerId: number): boolean {
    if (this.gameState.phase !== HandPhase.Betting) return false;
    if (this.gameState.round === BettingRound.River) return false;
    const ps = this.playerPrivateState.get(playerId);
    if (!ps || ps.stickyFingersCharges <= 0) return false;
    if (!ps.hasCardSleeveUnlock) return false;
    if (playerId === targetPlayerId) return false;

    const target = this.gameState.players.find(p => p.id === targetPlayerId);
    if (!target || !target.isInHand || target.hasFolded) return false;

    const targetCards = this.holeCards.get(targetPlayerId);
    if (!targetCards || targetCards.length < 2) return false;
    if (this.deck.length === 0) return false;

    // Steal a random hole card from the target
    const stealIdx = Math.floor(Math.random() * 2);
    const stolenCard = targetCards[stealIdx];

    // Replace the stolen card with a fresh deck card
    const replacement = this.deck.pop()!;
    targetCards[stealIdx] = replacement;

    // Put the stolen card in the thief's sleeve (slot 1, replacing any existing)
    ps.sleeveCard = stolenCard;

    ps.stickyFingersCharges--;
    ps.cheatedThisHand = true;
    return true;
  }

  useHiddenCamera(playerId: number, targetPlayerId: number): Card | null {
    const privateState = this.playerPrivateState.get(playerId);
    if (!privateState || privateState.hiddenCameraCharges <= 0) return null;
    if (this.gameState.phase !== HandPhase.Betting) return null;

    // Target must be in hand and not folded
    const target = this.gameState.players.find(p => p.id === targetPlayerId);
    if (!target || !target.isInHand || target.hasFolded) return null;

    // Can't target yourself
    if (targetPlayerId === playerId) return null;

    const targetCards = this.holeCards.get(targetPlayerId);
    if (!targetCards) return null;

    privateState.hiddenCameraCharges--;
    privateState.cheatedThisHand = true;
    // Return a random one of their two hole cards
    const idx = Math.floor(Math.random() * 2);
    return targetCards[idx];
  }

  getPlayerPrivateState(playerId: number): PlayerPrivateState | undefined {
    return this.playerPrivateState.get(playerId);
  }

  // Private helpers

  private getWeightedRandomCardForShop(): Card | null {
    // Build available cards (excluding dealt hole cards + board)
    const consumedCards = new Set<string>();
    this.holeCards.forEach(([cardA, cardB]) => {
      consumedCards.add(cardToString(cardA));
      consumedCards.add(cardToString(cardB));
    });
    for (const card of this.gameState.board) {
      consumedCards.add(cardToString(card));
    }

    // Weight: aces are uncommon (1 ticket), all other ranks are common (3 tickets)
    const weightedPool: Card[] = [];
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 2; rank <= 14; rank++) {
        const card: Card = { suit: suit as Suit, rank: rank as Rank };
        if (consumedCards.has(cardToString(card))) continue;
        const weight = rank === Rank.Ace ? 1 : 3;
        for (let i = 0; i < weight; i++) weightedPool.push(card);
      }
    }

    if (weightedPool.length === 0) return null;
    return weightedPool[Math.floor(Math.random() * weightedPool.length)];
  }

  private getRandomAvailableCard(): Card | null {
    // Create a set of all consumed cards (dealt hole cards + board cards)
    const consumedCards = new Set<string>();

    // Add dealt hole cards
    this.holeCards.forEach(([cardA, cardB]) => {
      consumedCards.add(cardToString(cardA));
      consumedCards.add(cardToString(cardB));
    });

    // Add board cards
    for (const card of this.gameState.board) {
      consumedCards.add(cardToString(card));
    }

    // Generate all 52 cards
    const allCards: Card[] = [];
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 2; rank <= 14; rank++) {
        allCards.push({ suit: suit as Suit, rank: rank as Rank });
      }
    }

    // Filter out consumed cards
    const availableCards = allCards.filter(card => !consumedCards.has(cardToString(card)));

    if (availableCards.length === 0) {
      return null;
    }

    // Return random available card
    return availableCards[Math.floor(Math.random() * availableCards.length)];
  }

  private shuffleDeck(): void {
    this.deck = [];
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 2; rank <= 14; rank++) {
        this.deck.push({ suit: suit as Suit, rank: rank as Rank });
      }
    }

    // Fisher-Yates shuffle
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  private dealHoleCards(): void {
    let deckIndex = 0;
    for (const player of this.gameState.players) {
      if (player.isSeated && player.isReady && !player.isEliminated) {
        let cardA = this.deck[deckIndex++];
        let cardB = this.deck[deckIndex++];

        const ps = this.playerPrivateState.get(player.id);
        const luck = ps ? getTotalLuck(ps) : 0;
        if (luck > 0) {
          cardA = this.applyLuckToHoleCard(cardA, cardB, luck);
          cardB = this.applyLuckToHoleCard(cardB, cardA, luck);
        }

        // PairOfPairs — applied after luck
        if (ps?.hasPairOfPairs) {
          const allSuits: Suit[] = [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades];
          if (ps.hasImprovedPairOfPairs) {
            const highRank = cardA.rank >= cardB.rank ? cardA.rank : cardB.rank;
            cardA = { rank: highRank, suit: allSuits[Math.floor(Math.random() * 4)] };
            cardB = { rank: highRank, suit: allSuits[Math.floor(Math.random() * 4)] };
          } else {
            cardB = { rank: cardA.rank, suit: allSuits[Math.floor(Math.random() * 4)] };
          }
        }

        // HeartOfHearts — overrides suit to Hearts, applied last
        if (ps?.hasHeartOfHearts) {
          cardA = { ...cardA, suit: Suit.Hearts };
          cardB = { ...cardB, suit: Suit.Hearts };
        }

        this.holeCards.set(player.id, [cardA, cardB]);
        player.isInHand = true;
      }
    }
  }

  /** Apply luck to a single hole card. otherCard is the partner hole card for duplication. */
  private applyLuckToHoleCard(card: Card, otherCard: Card, luck: number): Card {
    if (isJokerCard(card)) return card;
    const chance = luck / 100; // each point = 1%
    if (Math.random() >= chance) return card; // no improvement

    const roll = Math.random();
    if (roll < 0.22) {
      // 22%: improve to Jack of same suit
      return { suit: card.suit, rank: Rank.Jack, improved: true };
    } else if (roll < 0.44) {
      // 22%: improve to Queen of same suit
      return { suit: card.suit, rank: Rank.Queen, improved: true };
    } else if (roll < 0.66) {
      // 22%: improve to King of same suit
      return { suit: card.suit, rank: Rank.King, improved: true };
    } else if (roll < 0.88) {
      // 22%: improve to Ace of same suit
      return { suit: card.suit, rank: Rank.Ace, improved: true };
    } else {
      // 12%: exact duplicate of the other card
      return { suit: otherCard.suit, rank: otherCard.rank, improved: true };
    }
  }

  /** Apply luck to a community card for all players with luck > 0. */
  private applyLuckToCommunityCard(card: Card): Card {
    if (isJokerCard(card)) return card;
    for (const player of this.gameState.players) {
      if (!player.isInHand || player.hasFolded) continue;
      const ps = this.playerPrivateState.get(player.id);
      if (!ps) continue;
      const luck = getTotalLuck(ps);
      if (luck <= 0) continue;

      const chance = luck * 0.0001; // 0.01% per luck point
      if (Math.random() < chance) {
        const holeCards = this.holeCards.get(player.id);
        if (holeCards && holeCards.length > 0) {
          const pick = holeCards[Math.floor(Math.random() * holeCards.length)];
          return { suit: pick.suit, rank: pick.rank, improved: true };
        }
      }
    }
    return card;
  }

  private postBlinds(): void {
    const smallBlind = this.smallBlind;
    const bigBlind = this.bigBlind;

    const smallBlindPlayer = this.getNextActivePlayer(this.gameState.dealerPlayerId);
    const bigBlindPlayer = this.getNextActivePlayer(smallBlindPlayer);

    const sbPlayer = this.gameState.players.find(p => p.id === smallBlindPlayer);
    const bbPlayer = this.gameState.players.find(p => p.id === bigBlindPlayer);

    if (sbPlayer) {
      const sbAmount = Math.min(smallBlind, sbPlayer.stack);
      sbPlayer.stack -= sbAmount;
      sbPlayer.committedThisRound = sbAmount;
      sbPlayer.contributedThisHand += sbAmount;
      this.gameState.pot += sbAmount;
      if (sbPlayer.stack === 0) sbPlayer.isAllIn = true;
    }

    if (bbPlayer) {
      const bbAmount = Math.min(bigBlind, bbPlayer.stack);
      bbPlayer.stack -= bbAmount;
      bbPlayer.committedThisRound = bbAmount;
      bbPlayer.contributedThisHand += bbAmount;
      this.gameState.pot += bbAmount;
      if (bbPlayer.stack === 0) bbPlayer.isAllIn = true;
    }

    this.gameState.currentBetToMatch = bigBlind;
  }

  private isBettingRoundComplete(): boolean {
    const nonAllIn = this.gameState.players.filter(
      p => p.isSeated && p.isInHand && !p.hasFolded && !p.isAllIn
    );

    // Everyone still active is all-in — board runs itself
    if (nonAllIn.length === 0) {
      return true;
    }

    // If the current active player is all-in and hasn't yet passed their item-use turn,
    // hold here so the client can show them the "End Turn" button
    const activePlayer = this.gameState.players.find(p => p.id === this.gameState.activePlayerId);
    if (activePlayer?.isAllIn && !this.playersActedThisRound.has(activePlayer.id)) {
      return false;
    }

    // All non-all-in players must have matched the current bet
    const allMatched = nonAllIn.every(
      p => p.committedThisRound === this.gameState.currentBetToMatch
    );
    if (!allMatched) {
      return false;
    }

    if (this.lastRaiserId === 0) {
      // No raise this round — ends when every non-all-in player has voluntarily acted
      return nonAllIn.every(p => this.playersActedThisRound.has(p.id));
    } else {
      // After a raise — ends when action returns to the raiser
      return this.gameState.activePlayerId === this.lastRaiserId;
    }
  }

  private advanceBettingRound(): void {
    // Reset committed amounts for next round and clear last actions
    for (const player of this.gameState.players) {
      if (player.isInHand && !player.hasFolded) {
        player.committedThisRound = 0;
      }
      player.lastAction = undefined; // Clear last action for new round
    }

    this.gameState.currentBetToMatch = 0;
    this.lastRaiserId = 0; // No raise yet in the new round
    this.playersActedThisRound.clear();
    // NOTE: sleeveSwappedThisRound is intentionally NOT cleared here — once per hand

    if (this.gameState.round === BettingRound.Preflop) {
      this.gameState.board = this.dealFlop();
      this.gameState.round = BettingRound.Flop;
    } else if (this.gameState.round === BettingRound.Flop) {
      this.gameState.board.push(this.dealCommunityCard());
      this.gameState.round = BettingRound.Turn;
    } else if (this.gameState.round === BettingRound.Turn) {
      this.gameState.board.push(this.dealCommunityCard());
      this.gameState.round = BettingRound.River;
    } else if (this.gameState.round === BettingRound.River) {
      this.gameState.phase = HandPhase.Showdown;
      this.evaluateShowdown();
      return;
    }

    // Find first non-folded player to act (includes all-in players so they can use items)
    const dealerIndex = this.gameState.players.findIndex(p => p.id === this.gameState.dealerPlayerId);
    const playerCount = this.gameState.players.length;
    let firstToActId = 0;
    for (let i = 1; i <= playerCount; i++) {
      const candidate = this.gameState.players[(dealerIndex + i) % playerCount];
      if (candidate.isInHand && !candidate.hasFolded) {
        firstToActId = candidate.id;
        break;
      }
    }

    if (firstToActId === 0) {
      // No active players remain — advance directly
      this.advanceBettingRound();
      return;
    }

    this.gameState.activePlayerId = firstToActId;
  }

  private dealFlop(): Card[] {
    return [this.dealCommunityCard(), this.dealCommunityCard(), this.dealCommunityCard()];
  }

  private dealCommunityCard(): Card {
    const raw = this.deck.pop() || { suit: Suit.Clubs, rank: Rank.Two };
    return this.applyLuckToCommunityCard(raw);
  }

  private getNextActivePlayer(fromPlayerId: number): number {
    // Use the full in-hand list (including folded) to preserve seating order,
    // then step forward to find the next non-folded player.
    const inHand = this.gameState.players.filter(p => p.isSeated && p.isInHand);
    if (inHand.length === 0) return 0;

    const fromIdx = inHand.findIndex(p => p.id === fromPlayerId);
    for (let i = 1; i <= inHand.length; i++) {
      const candidate = inHand[(fromIdx + i) % inHand.length];
      if (!candidate.hasFolded) return candidate.id;
    }
    return 0;
  }

  /** Like getNextActivePlayer but uses the full players list order, for preflop seat rotation. Skips eliminated players. */
  private getNextActivePlayerFromDealer(fromPlayerId: number): number {
    const seated = this.gameState.players.filter(p => p.isSeated && p.isInHand && !p.isEliminated);
    if (seated.length === 0) return 0;
    const idx = seated.findIndex(p => p.id === fromPlayerId);
    return seated[(idx + 1) % seated.length].id;
  }

  private evaluateShowdown(): void {
    const activePlayers = this.gameState.players.filter(
      p => p.isInHand && !p.hasFolded
    );

    if (activePlayers.length === 0) return;

    // Score all non-folded players' hands
    const playerScores: { player: PlayerPublicState; score: number; ranking: HandRanking }[] = [];
    for (const player of activePlayers) {
      const hole = this.holeCards.get(player.id);
      if (hole) {
        const hasJoker = hole.some(c => isJokerCard(c));
        const handValue = hasJoker
          ? evaluateBestHandWithJokers([hole[0], hole[1]], this.gameState.board)
          : evaluateBestHand([hole[0], hole[1]], this.gameState.board);
        playerScores.push({ player, score: handValue.score, ranking: handValue.ranking });
      }
    }

    // ── Side pot distribution ──────────────────────────────────────────────
    // Each all-in player can only win chips from players they covered.
    // computeSidePots() builds ordered side pots from contributedThisHand values.
    const sidePots = this.computeSidePots();
    const mainPotWinnerIds: number[] = [];

    for (let si = 0; si < sidePots.length; si++) {
      const sidePot = sidePots[si];

      const eligibleScores = playerScores.filter(ps => sidePot.eligibleIds.has(ps.player.id));
      if (eligibleScores.length === 0) continue;

      // Apply rake (per eligible player who owns one) to this side pot
      let potAmount = sidePot.amount;
      for (const player of this.gameState.players) {
        const ps = this.playerPrivateState.get(player.id);
        if (ps?.hasRake && sidePot.eligibleIds.has(player.id)) {
          const rakeAmount = Math.floor(potAmount * 0.05);
          if (rakeAmount > 0) {
            player.stack += rakeAmount;
            potAmount -= rakeAmount;
          }
        }
      }

      // Best hand among players eligible for this side pot
      const bestScore = Math.max(...eligibleScores.map(e => e.score));
      const winners = eligibleScores.filter(e => e.score === bestScore).map(e => e.player);

      // Split this side pot among its winners
      const share = Math.floor(potAmount / winners.length);
      const rem = potAmount % winners.length;
      for (let i = 0; i < winners.length; i++) {
        winners[i].stack += share + (i === 0 ? rem : 0);
      }

      // Track win-with-one-pair unlock for PairOfPairs shop entry
      for (const entry of eligibleScores.filter(e => e.score === bestScore)) {
        const ps = this.playerPrivateState.get(entry.player.id);
        if (ps && entry.ranking === HandRanking.OnePair) ps.hasWonWithOnePair = true;
      }

      // The last (largest) side pot determines the displayed winner
      if (si === sidePots.length - 1) {
        for (const w of winners) mainPotWinnerIds.push(w.id);
      }
    }

    // Fall back to first active player if side pots were empty (shouldn't happen)
    this.winnerIds = mainPotWinnerIds.length > 0 ? mainPotWinnerIds : [activePlayers[0].id];
    this.winnerId = this.winnerIds[0];

    // Apply Spade of Spades bonuses and increment winner's bonus
    this.applySpadeOfSpadesBonuses();
    for (const winnerId of this.winnerIds) {
      const ps = this.playerPrivateState.get(winnerId);
      if (ps?.hasSpadeOfSpades) ps.spadeOfSpadesBonus += 5;
    }

    // Rabbit's Foot: refund 33% of bet contribution for lucky losers.
    // Also mark hasLostAtShowdown to unlock Card Shark in the shop.
    const winnerIdSet = new Set(this.winnerIds);
    for (const player of activePlayers) {
      if (winnerIdSet.has(player.id)) continue;
      const ps = this.playerPrivateState.get(player.id);
      if (!ps) continue;
      ps.hasLostAtShowdown = true;
      if (ps.hasRabbitsFoot) {
        const luck = getTotalLuck(ps);
        if (luck > 0 && Math.random() < luck / 100) {
          const refund = Math.floor(player.contributedThisHand * 0.33);
          if (refund > 0) player.stack += refund;
        }
      }
    }

    // Eliminate players who are now broke
    for (const player of this.gameState.players) {
      if (player.stack === 0 && !player.isEliminated) {
        player.isEliminated = true;
      }
    }

    this.gameState.phase = HandPhase.Showdown;
  }

  /**
   * Builds side pots from players' total contributions this hand.
   * Each side pot covers one contribution "level" and lists only the
   * non-folded players who are eligible to win it.
   *
   * Example: A=100, B=50 (all-in), C=100, D=30 (folded)
   *   Level 30 → pot 120, eligible {A,B,C,D→excluded because folded}
   *   Level 50 → pot  60, eligible {A,B,C}
   *   Level 100→ pot 100, eligible {A,C}
   */
  private computeSidePots(): { amount: number; eligibleIds: Set<number> }[] {
    // All players who put chips in this hand
    const contributors = this.gameState.players.filter(p => p.isInHand);
    // Only non-folded players can win
    const eligible = contributors.filter(p => !p.hasFolded);

    // Unique, ascending contribution levels
    const levels = [...new Set(contributors.map(p => p.contributedThisHand))]
      .filter(l => l > 0)
      .sort((a, b) => a - b);

    if (levels.length === 0) return [];

    const sidePots: { amount: number; eligibleIds: Set<number> }[] = [];
    let prevLevel = 0;

    for (const level of levels) {
      const height = level - prevLevel;
      if (height <= 0) continue;

      // Each contributor puts at most `height` chips into this layer
      let amount = 0;
      for (const p of contributors) {
        amount += Math.min(p.contributedThisHand, level) - prevLevel;
      }

      // Eligible winners are non-folded players who contributed at least up to this level
      const eligibleIds = new Set(eligible.filter(p => p.contributedThisHand >= level).map(p => p.id));

      if (amount > 0) {
        sidePots.push({ amount, eligibleIds });
      }

      prevLevel = level;
    }

    return sidePots;
  }

  private handleFoldOutWinner(): void {
    // Find the last remaining active player
    const activePlayers = this.gameState.players.filter(
      p => p.isInHand && !p.hasFolded
    );

    if (activePlayers.length !== 1) return;

    const winner = activePlayers[0];

    // Apply rake before pot distribution
    let remainingPot = this.gameState.pot;
    for (const player of this.gameState.players) {
      const ps = this.playerPrivateState.get(player.id);
      if (ps?.hasRake && player.isInHand && player.stack > 0) {
        const rakeAmount = Math.floor(this.gameState.pot * 0.05);
        if (rakeAmount > 0) {
          player.stack += rakeAmount;
          remainingPot -= rakeAmount;
        }
      }
    }

    // Award remaining pot to winner
    winner.stack += remainingPot;
    this.winnerId = winner.id;
    this.foldedOut = true;

    // Apply Spade of Spades bonuses and increment winner's bonus
    this.applySpadeOfSpadesBonuses();
    const winnerPs = this.playerPrivateState.get(winner.id);
    if (winnerPs?.hasSpadeOfSpades) winnerPs.spadeOfSpadesBonus += 5;

    // Eliminate players who are now broke
    for (const player of this.gameState.players) {
      if (player.stack === 0 && !player.isEliminated) {
        player.isEliminated = true;
      }
    }

    // Transition to showdown phase (will show simplified winner screen)
    this.gameState.phase = HandPhase.Showdown;
  }

  private applySpadeOfSpadesBonuses(): void {
    const boardSpades = this.gameState.board.filter(c => c.suit === Suit.Spades).length;
    for (const player of this.gameState.players) {
      if (!player.isInHand) continue;
      const ps = this.playerPrivateState.get(player.id);
      if (!ps?.hasSpadeOfSpades) continue;
      const hc = this.holeCards.get(player.id);
      const holeSpades = hc ? hc.filter(c => c.suit === Suit.Spades).length : 0;
      const total = holeSpades + boardSpades;
      if (total > 0) player.stack += ps.spadeOfSpadesBonus * total;
    }
  }
}
