import { Card, Rank, Suit, isJokerCard } from './card.js';

export enum ShopItemType {
  None = 0,
  Cigarette = 12,
  Whiskey = 13,
  FourLeafClover = 14,
  FiveLeafClover = 15,
  Gun = 20,
  Bullet = 21,
  CardSleeveUnlock = 30,
  ExtraCard = 31,
  Joker = 32,
  SleeveExtender = 33,
  XRayGoggles = 40,
  Rake = 41,
  HiddenCamera = 42,
  Bond = 50,
  StockOption = 51,
  HeartOfHearts = 60,
  SpadeOfSpades = 61,
  PairOfPairs = 62,
  ImprovedPairOfPairs = 63,
}

export enum UseItemType {
  None = 0,
  UseSleeveCardSwapHoleA = 21,
  UseSleeveCardSwapHoleB = 22,
  UseSleeveCard2SwapHoleA = 23,
  UseSleeveCard2SwapHoleB = 24,
  ShootPlayer = 30,
  UseXRayGoggles = 40,
  UseHiddenCamera = 41,
  CashOutBond = 50,
  CashOutStockOption = 51,
}

export interface LuckBuff {
  amount: number;
  turnsRemaining: number;
}

export interface BondState {
  roundsHeld: number;
  purchasePrice: number;
  currentValue: number;
}

export interface StockOptionState {
  roundsHeld: number;
  purchasePrice: number;
}

export interface PlayerPrivateState {
  hasGun: boolean;
  bullets: number;
  hasCardSleeveUnlock: boolean;
  sleeveCard: Card | null;
  hasSleeveExtender: boolean;
  sleeveCard2: Card | null;
  xrayCharges: number;
  permanentLuck: number;
  luckBuffs: LuckBuff[];
  hasRake: boolean;
  hiddenCameraCharges: number;
  cheatedThisHand: boolean;
  bonds: BondState[];
  stockOptions: StockOptionState[];
  hasFourLeafClover: boolean;
  hasFiveLeafClover: boolean;
  unlockedShopSlots: number; // How many shop slots unlocked this visit (default 1, max 3)
  hasHeartOfHearts: boolean;
  hasSpadeOfSpades: boolean;
  spadeOfSpadesBonus: number; // per-spade payout, starts at 5, +5 each hand won
  hasPairOfPairs: boolean;
  hasImprovedPairOfPairs: boolean;
  hasWonWithOnePair: boolean; // unlock flag for PairOfPairs shop entry
}

export enum ShopItemRarity {
  Copper = 'copper',
  Bronze = 'bronze',
  Silver = 'silver',
  Gold = 'gold',
  Unique = 'unique',
}

export interface ShopSlotItem {
  type: ShopItemType;
  price: number;
  name: string;
  description: string;
  rarity: ShopItemRarity;
  previewCard?: Card; // For ExtraCard only
  locked?: boolean; // True if slot hasn't been unlocked yet
}

/** Canonical rarity for every purchasable item. Drives both the displayed rarity badge and shop spawn weights. */
export const ITEM_RARITY_MAP: Record<ShopItemType, ShopItemRarity> = {
  [ShopItemType.None]:                ShopItemRarity.Copper,
  [ShopItemType.Cigarette]:           ShopItemRarity.Copper,
  [ShopItemType.Whiskey]:             ShopItemRarity.Bronze,
  [ShopItemType.FourLeafClover]:      ShopItemRarity.Silver,
  [ShopItemType.FiveLeafClover]:      ShopItemRarity.Gold,
  [ShopItemType.Gun]:                 ShopItemRarity.Silver,
  [ShopItemType.Bullet]:              ShopItemRarity.Copper,
  [ShopItemType.CardSleeveUnlock]:    ShopItemRarity.Silver,
  [ShopItemType.ExtraCard]:           ShopItemRarity.Copper,
  [ShopItemType.Joker]:               ShopItemRarity.Silver,
  [ShopItemType.SleeveExtender]:      ShopItemRarity.Gold,
  [ShopItemType.XRayGoggles]:         ShopItemRarity.Copper,
  [ShopItemType.Rake]:                ShopItemRarity.Silver,
  [ShopItemType.HiddenCamera]:        ShopItemRarity.Bronze,
  [ShopItemType.Bond]:                ShopItemRarity.Copper,
  [ShopItemType.StockOption]:         ShopItemRarity.Copper,
  [ShopItemType.HeartOfHearts]:       ShopItemRarity.Bronze,
  [ShopItemType.SpadeOfSpades]:       ShopItemRarity.Bronze,
  [ShopItemType.PairOfPairs]:         ShopItemRarity.Silver,
  [ShopItemType.ImprovedPairOfPairs]: ShopItemRarity.Gold,
};

export function getItemRarity(type: ShopItemType): ShopItemRarity {
  return ITEM_RARITY_MAP[type] ?? ShopItemRarity.Copper;
}

/**
 * Shop spawn weight derived directly from rarity.
 * To adjust how often an item appears in the shop, change its entry in ITEM_RARITY_MAP.
 *   Rare     → 1  (low spawn chance)
 *   Uncommon → 4
 *   Common   → 6  (high spawn chance)
 */
export function getItemShopWeight(type: ShopItemType): number {
  switch (getItemRarity(type)) {
    case ShopItemRarity.Unique: return 1;
    case ShopItemRarity.Gold:   return 2;
    case ShopItemRarity.Silver: return 4;
    case ShopItemRarity.Bronze: return 10;
    case ShopItemRarity.Copper: return 20;
  }
}

/**
 * Active items require explicit player action to trigger (have a "Use" button).
 * Passive items apply their effect automatically and are just held in the bag.
 *
 * Active:  Gun, Bullet, ExtraCard, Joker, XRayGoggles, HiddenCamera, Bond, StockOption
 * Passive: Cigarette, Whiskey, FourLeafClover, FiveLeafClover, CardSleeveUnlock, SleeveExtender, Rake
 */
export const ITEM_IS_ACTIVE: Record<ShopItemType, boolean> = {
  [ShopItemType.None]:             false,
  [ShopItemType.Cigarette]:        false,
  [ShopItemType.Whiskey]:          false,
  [ShopItemType.FourLeafClover]:   false,
  [ShopItemType.FiveLeafClover]:   false,
  [ShopItemType.Gun]:              true,
  [ShopItemType.Bullet]:           true,
  [ShopItemType.CardSleeveUnlock]: false,
  [ShopItemType.ExtraCard]:        true,
  [ShopItemType.Joker]:            true,
  [ShopItemType.SleeveExtender]:   false,
  [ShopItemType.XRayGoggles]:      true,
  [ShopItemType.Rake]:             false,
  [ShopItemType.HiddenCamera]:     true,
  [ShopItemType.Bond]:                true,
  [ShopItemType.StockOption]:         true,
  [ShopItemType.HeartOfHearts]:       false,
  [ShopItemType.SpadeOfSpades]:       false,
  [ShopItemType.PairOfPairs]:         false,
  [ShopItemType.ImprovedPairOfPairs]: false,
};

export function isItemActive(type: ShopItemType): boolean {
  return ITEM_IS_ACTIVE[type] ?? false;
}

/** Single source of truth for item base prices. getPrice reads from this. */
export const ShopCatalog: Record<ShopItemType, number> = {
  [ShopItemType.None]:             Infinity,
  [ShopItemType.Cigarette]:        25,
  [ShopItemType.Whiskey]:          50,
  [ShopItemType.FourLeafClover]:   77,
  [ShopItemType.FiveLeafClover]:   333,
  [ShopItemType.Gun]:              250,
  [ShopItemType.Bullet]:           50,
  [ShopItemType.CardSleeveUnlock]: 200,
  [ShopItemType.ExtraCard]:        0,
  [ShopItemType.Joker]:            150,
  [ShopItemType.SleeveExtender]:   300,
  [ShopItemType.XRayGoggles]:      80,
  [ShopItemType.Rake]:             200,
  [ShopItemType.HiddenCamera]:     150,
  [ShopItemType.Bond]:                150,
  [ShopItemType.StockOption]:         100,
  [ShopItemType.HeartOfHearts]:       90,
  [ShopItemType.SpadeOfSpades]:       80,
  [ShopItemType.PairOfPairs]:         100,
  [ShopItemType.ImprovedPairOfPairs]: 5,
};

export function getPrice(item: ShopItemType): number {
  return ShopCatalog[item];
}

export function getCardPrice(card: Card): number {
  if (isJokerCard(card)) return 100;
  // Number cards (2-10): $30, Face cards (J/Q/K): $40, Ace: $50
  if (card.rank >= Rank.Two && card.rank <= Rank.Ten) {
    return 30;
  } else if (card.rank >= Rank.Jack && card.rank <= Rank.King) {
    return 40;
  } else if (card.rank === Rank.Ace) {
    return 50;
  }
  return 0; // Fallback
}

export function getShopItemInfo(type: ShopItemType): { name: string; description: string } {
  const info: Record<ShopItemType, { name: string; description: string }> = {
    [ShopItemType.None]: { name: '', description: '' },
    [ShopItemType.Cigarette]: { name: 'Cigarette', description: '+5 luck for 5 hands' },
    [ShopItemType.Whiskey]: { name: 'Whiskey', description: '+10 luck for 5 hands' },
    [ShopItemType.FourLeafClover]: { name: '4 Leaf Clover', description: 'Permanently +7 luck (one-time)' },
    [ShopItemType.FiveLeafClover]: { name: '5 Leaf Clover', description: 'Permanently gain +70 luck. Cigarettes and whiskey have no further effect.' },
    [ShopItemType.Gun]: { name: 'Gun', description: 'For use on dirty cheaters' },
    [ShopItemType.Bullet]: { name: 'Bullet', description: 'You show those dirty cheaters who they\'re messing with' },
    [ShopItemType.CardSleeveUnlock]: { name: 'Big Sleeves', description: 'A spot to hide a card in your sleeve' },
    [ShopItemType.ExtraCard]: { name: 'Extra Card', description: 'A random card from the deck to put in your sleeve' },
    [ShopItemType.SleeveExtender]: { name: 'Bigger Sleeves', description: 'Expand your sleeve to hold a second card' },
    [ShopItemType.Joker]: { name: 'Joker', description: 'A wild card that becomes the best possible card at showdown' },
    [ShopItemType.XRayGoggles]: { name: 'X-Ray Goggles', description: 'Peek at the next community card (+3 charges)' },
    [ShopItemType.Rake]: { name: 'Rake', description: 'Secretly take 5% of every pot' },
    [ShopItemType.HiddenCamera]: { name: 'Hidden Camera', description: 'See one of an opponent\'s hole cards (+3 charges)' },
    [ShopItemType.Bond]: { name: 'Bond', description: 'Invest at a random price. Value grows 25%/hand up to $1,000.' },
    [ShopItemType.StockOption]: { name: 'Stock Option', description: 'Invest at a random price. After 3 hands: 1/3 chance for 5x return.' },
    [ShopItemType.HeartOfHearts]:       { name: 'Heart of Hearts',        description: 'All hole cards become hearts on draw (applied after luck).' },
    [ShopItemType.SpadeOfSpades]:       { name: 'Spade of Spades',        description: 'Earn bonus per spade drawn (your cards + board). Grows by $5 each hand you win.' },
    [ShopItemType.PairOfPairs]:         { name: 'Pair of Pairs',          description: 'Your hole cards always form a pair (applied after luck).' },
    [ShopItemType.ImprovedPairOfPairs]: { name: 'Improved Pair of Pairs', description: 'Makes Pair of Pairs better — uses the higher-ranked card.' },
  };
  return info[type];
}

export function getEligibleShopItems(state: PlayerPrivateState, ownedUniqueItems: Set<ShopItemType> = new Set()): ShopItemType[] {
  const items: ShopItemType[] = [];

  // Helper: suppress unique items already owned by any player
  const unique = (type: ShopItemType) => getItemRarity(type) !== ShopItemRarity.Unique || !ownedUniqueItems.has(type);

  // One-time unlocks
  if (!state.hasCardSleeveUnlock) items.push(ShopItemType.CardSleeveUnlock);
  if (!state.hasRake) items.push(ShopItemType.Rake);

  // Card sleeve extender (requires unlock, one-time purchase)
  if (state.hasCardSleeveUnlock && !state.hasSleeveExtender) items.push(ShopItemType.SleeveExtender);

  // Card sleeve items (requires sleeve unlock; always available for repurchase to replace)
  if (state.hasCardSleeveUnlock) {
    items.push(ShopItemType.ExtraCard);
    items.push(ShopItemType.Joker);
  }

  // Gun (one-time purchase, rare)
  if (!state.hasGun) items.push(ShopItemType.Gun);

  // Bullets (requires gun, can always buy more)
  if (state.hasGun) items.push(ShopItemType.Bullet);

  // Charge-based items (can always buy more — each purchase adds charges)
  items.push(ShopItemType.XRayGoggles);
  items.push(ShopItemType.HiddenCamera);

  // Luck items — cigarette/whiskey blocked if player has 5 Leaf Clover
  if (!state.hasFiveLeafClover) {
    items.push(ShopItemType.Cigarette);
    items.push(ShopItemType.Whiskey);
  }
  if (!state.hasFourLeafClover && getTotalLuck(state) >= 5) items.push(ShopItemType.FourLeafClover);
  if (state.hasFourLeafClover && !state.hasFiveLeafClover) items.push(ShopItemType.FiveLeafClover);

  // Investment items — only 1 of each at a time; repurchasable after cashing out
  if (state.bonds.length === 0) items.push(ShopItemType.Bond);
  if (state.stockOptions.length === 0) items.push(ShopItemType.StockOption);

  // Suit passives — one-time purchases
  if (!state.hasHeartOfHearts) items.push(ShopItemType.HeartOfHearts);
  if (!state.hasSpadeOfSpades) items.push(ShopItemType.SpadeOfSpades);

  // Pair mechanics — unlock gated
  if (state.hasWonWithOnePair && !state.hasPairOfPairs) items.push(ShopItemType.PairOfPairs);
  if (state.hasPairOfPairs && !state.hasImprovedPairOfPairs) items.push(ShopItemType.ImprovedPairOfPairs);

  return items.filter(unique);
}

export function getTotalLuck(state: PlayerPrivateState): number {
  if (state.hasFiveLeafClover) return 77;
  const buffLuck = state.luckBuffs.reduce((sum, b) => sum + b.amount, 0);
  return state.permanentLuck + buffLuck;
}

export function getBondCashOutValue(bond: BondState): number {
  return bond.currentValue;
}

/**
 * Resolves a stock option cash-out. Returns { eligible: false } if not yet cashable.
 * The 1-in-3 roll is performed here so the resolution rule stays in one place.
 */
export function getStockOptionCashOutValue(option: StockOptionState): { eligible: boolean; amount: number } {
  if (option.roundsHeld < 3) return { eligible: false, amount: 0 };
  const amount = Math.random() < 1 / 3 ? option.purchasePrice * 5 : 0;
  return { eligible: true, amount };
}
