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
}

export enum ShopItemRarity {
  Common = 'common',
  Uncommon = 'uncommon',
  Rare = 'rare',
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
  [ShopItemType.None]:             ShopItemRarity.Common,
  [ShopItemType.Cigarette]:        ShopItemRarity.Common,
  [ShopItemType.Whiskey]:          ShopItemRarity.Common,
  [ShopItemType.FourLeafClover]:   ShopItemRarity.Uncommon,
  [ShopItemType.FiveLeafClover]:   ShopItemRarity.Rare,
  [ShopItemType.Gun]:              ShopItemRarity.Rare,
  [ShopItemType.Bullet]:           ShopItemRarity.Common,
  [ShopItemType.CardSleeveUnlock]: ShopItemRarity.Uncommon,
  [ShopItemType.ExtraCard]:        ShopItemRarity.Common,
  [ShopItemType.Joker]:            ShopItemRarity.Rare,
  [ShopItemType.SleeveExtender]:   ShopItemRarity.Rare,
  [ShopItemType.XRayGoggles]:      ShopItemRarity.Common,
  [ShopItemType.Rake]:             ShopItemRarity.Rare,
  [ShopItemType.HiddenCamera]:     ShopItemRarity.Uncommon,
  [ShopItemType.Bond]:             ShopItemRarity.Common,
  [ShopItemType.StockOption]:      ShopItemRarity.Uncommon,
};

export function getItemRarity(type: ShopItemType): ShopItemRarity {
  return ITEM_RARITY_MAP[type] ?? ShopItemRarity.Common;
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
    case ShopItemRarity.Rare:     return 1;
    case ShopItemRarity.Uncommon: return 4;
    case ShopItemRarity.Common:   return 6;
  }
}

/** Single source of truth for item base prices. getPrice reads from this. */
export const ShopCatalog: Record<ShopItemType, number> = {
  [ShopItemType.None]:             Infinity,
  [ShopItemType.Cigarette]:        25,
  [ShopItemType.Whiskey]:          30,
  [ShopItemType.FourLeafClover]:   77,
  [ShopItemType.FiveLeafClover]:   333,
  [ShopItemType.Gun]:              400,
  [ShopItemType.Bullet]:           25,
  [ShopItemType.CardSleeveUnlock]: 200,
  [ShopItemType.ExtraCard]:        0,
  [ShopItemType.Joker]:            100,
  [ShopItemType.SleeveExtender]:   300,
  [ShopItemType.XRayGoggles]:      80,
  [ShopItemType.Rake]:             200,
  [ShopItemType.HiddenCamera]:     150,
  [ShopItemType.Bond]:             150,
  [ShopItemType.StockOption]:      100,
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
    [ShopItemType.Whiskey]: { name: 'Whiskey', description: '+10 luck for 3 hands' },
    [ShopItemType.FourLeafClover]: { name: '4 Leaf Clover', description: 'Permanently +7 luck (one-time)' },
    [ShopItemType.FiveLeafClover]: { name: '5 Leaf Clover', description: 'Set luck to 77 permanently. Cigarettes and whiskey have no further effect.' },
    [ShopItemType.Gun]: { name: 'Gun', description: 'For use on dirty cheaters' },
    [ShopItemType.Bullet]: { name: 'Bullet', description: 'You show those dirty cheaters who they\'re messing with' },
    [ShopItemType.CardSleeveUnlock]: { name: 'Card Sleeve Unlock', description: 'A spot to hide a card in your sleeve' },
    [ShopItemType.ExtraCard]: { name: 'Extra Card', description: 'A random card from the deck to put in your sleeve' },
    [ShopItemType.SleeveExtender]: { name: 'Card Sleeve Extender', description: 'Expand your sleeve to hold a second card' },
    [ShopItemType.Joker]: { name: 'Joker', description: 'A wild card that becomes the best possible card at showdown' },
    [ShopItemType.XRayGoggles]: { name: 'X-Ray Goggles', description: 'Peek at the next community card (+3 charges)' },
    [ShopItemType.Rake]: { name: 'Rake', description: 'Secretly take 5% of every pot' },
    [ShopItemType.HiddenCamera]: { name: 'Hidden Camera', description: 'See one of an opponent\'s hole cards (+3 charges)' },
    [ShopItemType.Bond]: { name: 'Bond', description: 'Invest at a random price. Value grows 10%/hand up to $1,000.' },
    [ShopItemType.StockOption]: { name: 'Stock Option', description: 'Invest at a random price. After 3 hands: 1/3 chance for 5x return.' },
  };
  return info[type];
}

export function getEligibleShopItems(state: PlayerPrivateState): ShopItemType[] {
  const items: ShopItemType[] = [];

  // One-time unlocks
  if (!state.hasCardSleeveUnlock) items.push(ShopItemType.CardSleeveUnlock);
  if (!state.hasRake) items.push(ShopItemType.Rake);

  // Card sleeve extender (requires unlock, one-time purchase)
  if (state.hasCardSleeveUnlock && !state.hasSleeveExtender) items.push(ShopItemType.SleeveExtender);

  // Card sleeve items (requires unlock + at least one empty sleeve slot)
  if (state.hasCardSleeveUnlock) {
    const hasSlot1Empty = state.sleeveCard === null;
    const hasSlot2Empty = state.hasSleeveExtender && state.sleeveCard2 === null;
    if (hasSlot1Empty || hasSlot2Empty) {
      items.push(ShopItemType.ExtraCard);
    }
    if (hasSlot1Empty || hasSlot2Empty) {
      items.push(ShopItemType.Joker);
    }
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

  return items;
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
