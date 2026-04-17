import { ShopItemType } from './economy.js';
import { HandRanking } from './handEvaluator.js';

/**
 * Strategy parameters that control a bot's decision-making.
 * All threshold values should be tuned together to create a coherent personality.
 */
export interface BotStrategy {
  /** Minimum preflop hand strength (0–100) required to call a bet */
  preflopCallMinStrength: number;
  /** Minimum preflop hand strength (0–100) required to raise */
  preflopRaiseMinStrength: number;
  /** Minimum made-hand ranking required to call a post-flop bet */
  postflopCallMinRanking: HandRanking;
  /** Minimum made-hand ranking required to raise post-flop */
  postflopRaiseMinRanking: HandRanking;
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
}

// ─── Named Bot Profiles ────────────────────────────────────────────────────

/**
 * Mr. Lucky — relies on his five-leaf clover fortune rather than skill.
 * Loose-passive: plays most hands, calls freely, rarely raises, never bluffs.
 */
export const MR_LUCKY: BotProfile = {
  id: 'mr-lucky',
  displayName: 'Mr. Lucky',
  startingItems: [ShopItemType.FiveLeafClover],
  strategy: {
    preflopCallMinStrength: 20,
    preflopRaiseMinStrength: 82,
    postflopCallMinRanking: HandRanking.HighCard,
    postflopRaiseMinRanking: HandRanking.ThreeOfAKind,
    bluffFrequency: 0,
    foldToRaiseFrequency: 0.15,
    raiseSizing: 'min',
  },
};

/**
 * The Shark — patient and disciplined; only enters pots with premium hands
 * and punishes opponents with large raises.
 */
export const THE_SHARK: BotProfile = {
  id: 'the-shark',
  displayName: 'The Shark',
  startingItems: [],
  strategy: {
    preflopCallMinStrength: 52,
    preflopRaiseMinStrength: 74,
    postflopCallMinRanking: HandRanking.OnePair,
    postflopRaiseMinRanking: HandRanking.TwoPair,
    bluffFrequency: 0.07,
    foldToRaiseFrequency: 0.55,
    raiseSizing: 'large',
  },
};

/**
 * Loose Larry — plays almost every hand, loves to bluff, and bets the pot.
 * Loose-aggressive: unpredictable and hard to read.
 */
export const LOOSE_LARRY: BotProfile = {
  id: 'loose-larry',
  displayName: 'Loose Larry',
  startingItems: [],
  strategy: {
    preflopCallMinStrength: 10,
    preflopRaiseMinStrength: 44,
    postflopCallMinRanking: HandRanking.HighCard,
    postflopRaiseMinRanking: HandRanking.OnePair,
    bluffFrequency: 0.25,
    foldToRaiseFrequency: 0.12,
    raiseSizing: 'pot',
  },
};

/**
 * The Investor - gains wealth per hand. Starts with 2 rakes and an option. Gets a new option every 3 rounds. Sells an option every 3 rounds. Sells a rake every 4 rounds. Always raises with a strong hand, and bluffs more as the game goes on.
 * Balanced: plays a solid game but is more likely to bluff as time goes on.
 */
export const THE_INVESTOR: BotProfile = {
  id: 'the-investor',
  displayName: 'The Investor',
  startingItems: [ShopItemType.Rake, ShopItemType.Rake, ShopItemType.StockOption],
  strategy: {
    preflopCallMinStrength: 30,
    preflopRaiseMinStrength: 65,
    postflopCallMinRanking: HandRanking.OnePair,
    postflopRaiseMinRanking: HandRanking.TwoPair,
    bluffFrequency: 0.09,
    foldToRaiseFrequency: 0.33,
    raiseSizing: 'pot',
    itemRules: [
      { action: 'cash-out-stock-option', everyNHands: 3, replaceWith: ShopItemType.StockOption },
    ],
  },
};

/** Default set of three bots used in a Play vs. Bots game. */
export const DEFAULT_BOT_PROFILES: BotProfile[] = [MR_LUCKY, THE_SHARK, LOOSE_LARRY, THE_INVESTOR];
