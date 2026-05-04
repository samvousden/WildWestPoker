export enum BettingRound {
  None = 0,
  Preflop = 1,
  Flop = 2,
  Turn = 3,
  River = 4,
}

export enum HandPhase {
  Lobby = 0,
  Dealing = 1,
  Betting = 2,
  Showdown = 3,
  ItemShop = 4,
}

export enum PokerActionType {
  Fold = 0,
  Check = 1,
  Call = 2,
  RaiseTo = 3,
}

export enum ItemType {
  Item1 = 1,
  Item2 = 2,
  Item3 = 3,
}

export interface Item {
  id: ItemType;
  name: string;
  description: string;
  cost: number;
}

export interface PokerAction {
  type: PokerActionType;
  raiseToAmount?: number;
}

export interface PlayerPublicState {
  id: number;
  name: string;
  stack: number;
  committedThisRound: number;
  contributedThisHand: number;
  isSeated: boolean;
  isReady: boolean;
  isInHand: boolean;
  hasFolded: boolean;
  isAllIn: boolean;
  isBot: boolean;
  isEliminated: boolean;
  inventory: number[]; // Items owned by player (ItemType or ShopItemType)
  lastAction?: {
    type: PokerActionType;
    amount?: number;
  };
}

export interface TimerSettings {
  bettingSeconds: number;
  shopSeconds: number;
}

export interface GameState {
  phase: HandPhase;
  round: BettingRound;
  dealerPlayerId: number;
  activePlayerId: number;
  pot: number;
  currentBetToMatch: number;
  smallBlind: number;
  bigBlind: number;
  players: PlayerPublicState[];
  board: Card[];
  caughtCheaterPlayerId: number | null;
  gameMode: 'multiplayer' | 'vsBot';
  timerSettings: TimerSettings;
  turnDeadline: number | null; // UTC ms timestamp; null = no active timer
}

import { Card } from './card.js';
