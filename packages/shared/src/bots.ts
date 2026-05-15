import { ShopItemType } from './economy.js';
import { GameState, PlayerPublicState } from './game.js';
import { Card } from './card.js';

/**
 * Defines how a bot uses active items based on its personality.
 * Each bot type has distinct item-usage behavior:
 * - 'strategic': Uses items only when conditions justify (e.g., shoot confirmed cheaters, peek before big decisions)
 * - 'random': Uses items randomly (~10-20% frequency) regardless of state
 * - 'passive': Avoids active items entirely, focuses on passive luck items
 * - 'wealth-focused': Minimizes active item use, prioritizes investment items
 */
export type BotItemUsageStyle = 'strategic' | 'random' | 'passive' | 'wealth-focused';

/**
 * Defines active-item decision-making for a bot personality.
 */
export interface BotItemStrategy {
  /** Defines this bot's overall active-item usage style */
  usageStyle: BotItemUsageStyle;
  /** If true, bot will place high-value cards in sleeves to protect them */
  useSleevesStrategically: boolean;
  /** If true, bot will use X-Ray Goggles when justified (strong hand, big pot, etc.) */
  useXRayGoggles: boolean;
  /** If true, bot will use Gun item when cheating is detected */
  useGun: boolean;
  /** Base probability (0-1) for random item usage (applies when usageStyle='random') */
  randomItemUsageProbability: number;
}

/**
 * Strategy parameters that control a bot's decision-making.
 * All threshold values are 0–100 effective hand strength and should be tuned
 * together to create a coherent personality.
 */
export interface BotStrategy {
  /** Minimum preflop hand strength (0–100) required to call a bet */
  preflopCallMinStrength: number;
  /** Minimum preflop hand strength (0–100) required to raise */
  preflopRaiseMinStrength: number;
  /** Minimum effective post-flop strength (0–100) required to call; accounts for board texture */
  postflopCallMinStrength: number;
  /** Minimum effective post-flop strength (0–100) required to raise; accounts for board texture */
  postflopRaiseMinStrength: number;
  /** Probability (0–1) of bluff-raising with a weak hand */
  bluffFrequency: number;
  /** Probability (0–1) of folding when facing a raise with a weak hand */
  foldToRaiseFrequency: number;
  /** How big to size raises: 'min' = 2×, 'pot' = bet + pot, 'large' = 3× */
  raiseSizing: 'min' | 'pot' | 'large';
  /** Active item rules: periodic actions the bot takes automatically during play */
  itemRules?: BotItemRule[];
}

/**
 * Describes a periodic active-item action a bot performs automatically.
 * The action fires at most once per hand, on hands where handCount % everyNHands === 0.
 */
export interface BotItemRule {
  /** The financial action to execute */
  action: 'cash-out-stock-option' | 'cash-out-bond';
  /** Perform this action once every N hands */
  everyNHands: number;
  /** After performing the action, immediately grant this item as a free replacement */
  replaceWith?: ShopItemType;
}

/**
 * Full profile for a named bot: identity, starting items, and strategy.
 */
export interface BotProfile {
  /** Unique slug identifier */
  id: string;
  /** Display name shown in the game UI */
  displayName: string;
  /**
   * Items granted at game start, applied directly to the bot's private state.
   * These are starting perks, not shop purchases — they will NOT appear in inventory.
   */
  startingItems: ShopItemType[];
  strategy: BotStrategy;
  /** Defines how this bot uses active items */
  itemStrategy: BotItemStrategy;
}

// ─── Named Bot Profiles ────────────────────────────────────────────────────

/**
 * Mr. Lucky — relies on his five-leaf clover fortune rather than skill.
 * Loose-passive: plays most hands, calls freely, rarely raises, never bluffs.
 * Avoids active items, trusts luck instead.
 */
export const MR_LUCKY: BotProfile = {
  id: 'mr-lucky',
  displayName: 'Mr. Lucky',
  startingItems: [ShopItemType.FiveLeafClover],
  strategy: {
    preflopCallMinStrength: 20,
    preflopRaiseMinStrength: 82,
    postflopCallMinStrength: 15,
    postflopRaiseMinStrength: 65,
    bluffFrequency: 0,
    foldToRaiseFrequency: 0.15,
    raiseSizing: 'min',
  },
  itemStrategy: {
    usageStyle: 'passive',
    useSleevesStrategically: false,
    useXRayGoggles: false,
    useGun: false,
    randomItemUsageProbability: 0,
  },
};

/**
 * The Shark — patient and disciplined; only enters pots with premium hands
 * and punishes opponents with large raises.
 * Uses active items strategically: shoots cheaters, peeks with strong hands.
 */
export const THE_SHARK: BotProfile = {
  id: 'the-shark',
  displayName: 'The Shark',
  startingItems: [],
  strategy: {
    preflopCallMinStrength: 52,
    preflopRaiseMinStrength: 74,
    postflopCallMinStrength: 35,
    postflopRaiseMinStrength: 55,
    bluffFrequency: 0.07,
    foldToRaiseFrequency: 0.55,
    raiseSizing: 'large',
  },
  itemStrategy: {
    usageStyle: 'strategic',
    useSleevesStrategically: true,
    useXRayGoggles: true,
    useGun: true,
    randomItemUsageProbability: 0,
  },
};

/**
 * Loose Larry — plays almost every hand, loves to bluff, and bets the pot.
 * Loose-aggressive: unpredictable and hard to read.
 * Uses active items randomly, keeping opponents guessing.
 */
export const LOOSE_LARRY: BotProfile = {
  id: 'loose-larry',
  displayName: 'Loose Larry',
  startingItems: [],
  strategy: {
    preflopCallMinStrength: 10,
    preflopRaiseMinStrength: 44,
    postflopCallMinStrength: 12,
    postflopRaiseMinStrength: 30,
    bluffFrequency: 0.25,
    foldToRaiseFrequency: 0.12,
    raiseSizing: 'pot',
  },
  itemStrategy: {
    usageStyle: 'random',
    useSleevesStrategically: false,
    useXRayGoggles: true,
    useGun: true,
    randomItemUsageProbability: 0.15,
  },
};

/**
 * The Investor - gains wealth per hand. Starts with 2 rakes and an option. Gets a new option every 3 rounds. Sells an option every 3 rounds. Sells a rake every 4 rounds. Always raises with a strong hand, and bluffs more as the game goes on.
 * Balanced: plays a solid game but is more likely to bluff as time goes on.
 * Focuses on wealth accumulation, avoids risky active items.
 */
export const THE_INVESTOR: BotProfile = {
  id: 'the-investor',
  displayName: 'The Investor',
  startingItems: [ShopItemType.Rake, ShopItemType.Rake, ShopItemType.StockOption],
  strategy: {
    preflopCallMinStrength: 30,
    preflopRaiseMinStrength: 65,
    postflopCallMinStrength: 28,
    postflopRaiseMinStrength: 50,
    bluffFrequency: 0.09,
    foldToRaiseFrequency: 0.33,
    raiseSizing: 'pot',
    itemRules: [
      { action: 'cash-out-stock-option', everyNHands: 3, replaceWith: ShopItemType.StockOption },
    ],
  },
  itemStrategy: {
    usageStyle: 'wealth-focused',
    useSleevesStrategically: false,
    useXRayGoggles: false,
    useGun: false,
    randomItemUsageProbability: 0,
  },
};

/**
 * Shady Sam — a deceptive player who keeps an ace up his sleeve.
 * Tight-aggressive: plays premium hands and bluffs selectively.
 * Relies on the hidden ace for protection and advantage.
 * Strategically uses sleeves to protect strong cards, especially aces.
 */
export const SHADY_SAM: BotProfile = {
  id: 'shady-sam',
  displayName: 'Shady Sam',
  startingItems: [ShopItemType.CardSleeveUnlock],
  strategy: {
    preflopCallMinStrength: 40,
    preflopRaiseMinStrength: 68,
    postflopCallMinStrength: 32,
    postflopRaiseMinStrength: 52,
    bluffFrequency: 0.12,
    foldToRaiseFrequency: 0.40,
    raiseSizing: 'pot',
  },
  itemStrategy: {
    usageStyle: 'strategic',
    useSleevesStrategically: true,
    useXRayGoggles: false,
    useGun: false,
    randomItemUsageProbability: 0,
  },
};

/**
 * Gunslinger — an aggressive bot armed with a gun.
 * Medium-aggressive: plays a wide range but disciplined.
 * Shoots players caught cheating with 1/3 probability.
 * Maintains bullets through shop purchases (costs $100 per bullet).
 */
export const GUNSLINGER: BotProfile = {
  id: 'gunslinger',
  displayName: 'Gunslinger',
  startingItems: [ShopItemType.Gun],
  strategy: {
    preflopCallMinStrength: 35,
    preflopRaiseMinStrength: 60,
    postflopCallMinStrength: 28,
    postflopRaiseMinStrength: 48,
    bluffFrequency: 0.14,
    foldToRaiseFrequency: 0.35,
    raiseSizing: 'pot',
  },
  itemStrategy: {
    usageStyle: 'strategic',
    useSleevesStrategically: false,
    useXRayGoggles: false,
    useGun: true,
    randomItemUsageProbability: 0,
  },
};

/**
 * Mr. Roboto — a high-tech bot relying on surveillance and information gathering.
 * Balanced with strong post-flop: plays solid fundamentals enhanced by information advantage.
 * Buys X-Ray Goggles and Hidden Camera after first hand.
 * Replaces items when charges run out (continuously maintains surveillance capability).
 */
export const MR_ROBOTO: BotProfile = {
  id: 'mr-roboto',
  displayName: 'Mr. Roboto',
  startingItems: [],
  strategy: {
    preflopCallMinStrength: 32,
    preflopRaiseMinStrength: 62,
    postflopCallMinStrength: 25,
    postflopRaiseMinStrength: 45,
    bluffFrequency: 0.11,
    foldToRaiseFrequency: 0.38,
    raiseSizing: 'pot',
  },
  itemStrategy: {
    usageStyle: 'strategic',
    useSleevesStrategically: false,
    useXRayGoggles: true,
    useGun: false,
    randomItemUsageProbability: 0,
  },
};

/** Default set of bots used in a Play vs. Bots game. */
export const DEFAULT_BOT_PROFILES: BotProfile[] = [
  MR_LUCKY, 
  THE_SHARK, 
  LOOSE_LARRY, 
  THE_INVESTOR,
  SHADY_SAM,
  GUNSLINGER,
  MR_ROBOTO,
];

// ─── Bot Item Decision Helpers ──────────────────────────────────────────────

/**
 * Determines if a bot should use X-Ray Goggles based on its strategy and game state.
 * Strategic bots peek when pot odds are good or facing large bets.
 * Random bots peek with a random probability.
 * @param botProfile The bot's profile
 * @param gameState Current game state
 * @param botStack Bot's current stack size
 * @returns true if bot should use X-Ray Goggles
 */
export function shouldBotUseXRayGoggles(
  botProfile: BotProfile,
  gameState: GameState,
  botStack: number
): boolean {
  const { itemStrategy } = botProfile;

  // If bot doesn't use this item type, never peek
  if (!itemStrategy.useXRayGoggles) return false;

  // Passive and wealth-focused bots avoid X-Ray
  if (itemStrategy.usageStyle === 'passive' || itemStrategy.usageStyle === 'wealth-focused') {
    return false;
  }

  if (itemStrategy.usageStyle === 'random') {
    return Math.random() < itemStrategy.randomItemUsageProbability;
  }

  // Strategic usage: peek if pot is large or bet-to-call ratio justifies it
  if (itemStrategy.usageStyle === 'strategic') {
    const potToStack = gameState.pot / botStack;
    const betToMatch = gameState.currentBetToMatch;

    // Use X-Ray if: pot is substantial (> 15% of stack) AND we're facing a significant bet
    return potToStack > 0.15 && betToMatch > gameState.bigBlind * 2;
  }

  return false;
}

/**
 * Determines if a bot should use the Gun item based on its strategy.
 * Strategic bots only shoot confirmed cheaters. Random bots shoot with low probability.
 * Gunslinger: shoots confirmed cheaters with 1/3 probability (reckless style).
 * @param botProfile The bot's profile
 * @param caughtCheater Whether the target has been caught cheating this hand
 * @returns true if bot should attempt to shoot
 */
export function shouldBotUseGun(botProfile: BotProfile, caughtCheater: boolean): boolean {
  const { itemStrategy, id } = botProfile;

  // If bot doesn't use Gun, never shoot
  if (!itemStrategy.useGun) return false;

  // Passive and wealth-focused bots avoid the Gun
  if (itemStrategy.usageStyle === 'passive' || itemStrategy.usageStyle === 'wealth-focused') {
    return false;
  }

  // Gunslinger: shoots confirmed cheaters with 1/3 probability (wild card style)
  if (id === 'gunslinger') {
    return caughtCheater && Math.random() < 1/3;
  }

  if (itemStrategy.usageStyle === 'random') {
    // Random bots use Gun very rarely (1% base rate, boosted to 3% if cheater detected)
    return Math.random() < (caughtCheater ? 0.03 : 0.01);
  }

  // Strategic usage: only shoot if cheating is confirmed (always, like The Shark)
  if (itemStrategy.usageStyle === 'strategic') {
    return caughtCheater;
  }

  return false;
}

/**
 * Determines which cards a bot should place in sleeves to protect them.
 * Strategic bots hide face cards and strong pairs.
 * Other bots don't use sleeves strategically.
 * @param botProfile The bot's profile
 * @param holeCards Bot's hole cards
 * @param sleeveCapacity Number of cards the bot can hold in sleeve(s)
 * @returns Indices of cards to place in sleeve (0-indexed), or empty array if none
 */
export function selectCardsForBotSleeve(
  botProfile: BotProfile,
  holeCards: Card[],
  sleeveCapacity: number
): number[] {
  const { itemStrategy } = botProfile;

  if (!itemStrategy.useSleevesStrategically || sleeveCapacity === 0) {
    return [];
  }

  // Identify high-value cards: face cards (J, Q, K, A) and pairs
  const selectedIndices: number[] = [];

  // Check for pairs first (highest priority)
  if (holeCards.length >= 2 && holeCards[0].rank === holeCards[1].rank) {
    // Both cards form a pair - hide the first one (or both if capacity allows)
    selectedIndices.push(0);
    if (sleeveCapacity > 1 && selectedIndices.length < sleeveCapacity) {
      selectedIndices.push(1);
    }
    return selectedIndices;
  }

  // No pair: hide the highest-ranked cards (face cards, Aces preferred)
  const rankedCards = holeCards
    .map((card, index) => ({ index, rank: card.rank }))
    .sort((a, b) => b.rank - a.rank); // Sort descending by rank

  for (let i = 0; i < Math.min(sleeveCapacity, rankedCards.length); i++) {
    const card = rankedCards[i];
    // Hide if face card or high value (K, Q, J, or 10+)
    if (card.rank >= 10) {
      selectedIndices.push(card.index);
    }
  }

  return selectedIndices.slice(0, sleeveCapacity);
}

/**
 * Retrieves a named bot profile by ID.
 * @param botId The bot's unique ID (e.g., 'the-shark')
 * @returns The BotProfile if found, undefined otherwise
 */
export function getBotProfileById(botId: string): BotProfile | undefined {
  return DEFAULT_BOT_PROFILES.find(bot => bot.id === botId);
}

// ─── Bot Gauntlet Progression ──────────────────────────────────────────────

/**
 * Defines the difficulty progression for bot gauntlet mode.
 * Each round presents 3 bots in order of expected difficulty.
 * Row index corresponds to round number (0 = round 1, 1 = round 2, etc.)
 */
export const GAUNTLET_BOT_PROGRESSION: string[][] = [
  // Round 1: Easy difficulty (Loose Larry, Mr. Lucky are loose/passive)
  ['loose-larry', 'mr-lucky', 'loose-larry'],
  // Round 2: Medium difficulty (Mix with new bots - Shady Sam, Gunslinger, Mr. Roboto)
  ['shady-sam', 'loose-larry', 'mr-roboto'],
  // Round 3: Hard difficulty (Gunslinger, The Shark, Shady Sam with tricks)
  ['gunslinger', 'the-shark', 'shady-sam'],
  // Round 4 (optional): Expert difficulty (Mix of strong bots with tech)
  ['mr-roboto', 'the-shark', 'gunslinger'],
  // Round 5: Final boss - The ultimate challenge
  ['the-shark', 'the-shark', 'gunslinger'],
];

/**
 * Maximum number of rounds in gauntlet mode.
 * Players must beat all rounds to win.
 */
export const GAUNTLET_MAX_ROUNDS = GAUNTLET_BOT_PROGRESSION.length;

/**
 * Calculates the starting stack for bots in the next gauntlet round.
 * Formula: startingStack = totalChipsFromPreviousRound / numberOfBotsInRound
 * (Distributed equally among all bots, or could be based on their "share" of the previous total)
 * 
 * For simplicity: Each bot gets the total from previous round (so they all match player's escalated challenge)
 * 
 * @param previousRoundTotal Total chips from previous round (player + all bots)
 * @returns Starting stack for each bot in next round
 */
export function calculateNextRoundBotStartingStack(previousRoundTotal: number): number {
  // In gauntlet progression, bots start with the total from previous round
  // This creates escalating difficulty as player's challenge increases with their own stack
  return previousRoundTotal;
}

/**
 * Retrieves the bot progression for a specific gauntlet round.
 * @param roundNumber 1-indexed round number (1 = first round)
 * @returns Array of 3 bot IDs for this round, or undefined if round exceeds max
 */
export function getGauntletRoundBots(roundNumber: number): string[] | undefined {
  const index = roundNumber - 1; // Convert to 0-indexed
  if (index < 0 || index >= GAUNTLET_BOT_PROGRESSION.length) {
    return undefined;
  }
  return GAUNTLET_BOT_PROGRESSION[index];
}
