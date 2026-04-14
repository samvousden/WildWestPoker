import { Card, Rank } from './card';

/**
 * Hand rankings (higher is better)
 */
export enum HandRanking {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

export interface HandValue {
  ranking: HandRanking;
  score: number;
  kickerCards: Card[];
}

export interface BestHandResult {
  ranking: HandRanking;
  cards: Card[];
}

/**
 * Convert HandRanking enum to human-readable string
 */
export function getHandRankingName(ranking: HandRanking): string {
  const names: { [key in HandRanking]: string } = {
    [HandRanking.HighCard]: 'High Card',
    [HandRanking.OnePair]: 'One Pair',
    [HandRanking.TwoPair]: 'Two Pair',
    [HandRanking.ThreeOfAKind]: 'Three of a Kind',
    [HandRanking.Straight]: 'Straight',
    [HandRanking.Flush]: 'Flush',
    [HandRanking.FullHouse]: 'Full House',
    [HandRanking.FourOfAKind]: 'Four of a Kind',
    [HandRanking.StraightFlush]: 'Straight Flush',
    [HandRanking.RoyalFlush]: 'Royal Flush',
  };
  return names[ranking];
}

/**
 * Evaluates a 5-card poker hand.
 * Returns a comparable score where higher is better.
 */
export function evaluateFiveCardHand(cards: Card[]): HandValue {
  if (cards.length !== 5) {
    throw new Error('Hand must contain exactly 5 cards');
  }

  // Check for straight flush
  const straightFlushValue = checkStraightFlush(cards);
  if (straightFlushValue) return straightFlushValue;

  // Check for four of a kind
  const fourOfAKindValue = checkFourOfAKind(cards);
  if (fourOfAKindValue) return fourOfAKindValue;

  // Check for full house
  const fullHouseValue = checkFullHouse(cards);
  if (fullHouseValue) return fullHouseValue;

  // Check for flush
  const flushValue = checkFlush(cards);
  if (flushValue) return flushValue;

  // Check for straight
  const straightValue = checkStraight(cards);
  if (straightValue) return straightValue;

  // Check for three of a kind
  const threeOfAKindValue = checkThreeOfAKind(cards);
  if (threeOfAKindValue) return threeOfAKindValue;

  // Check for two pair
  const twoPairValue = checkTwoPair(cards);
  if (twoPairValue) return twoPairValue;

  // Check for one pair
  const onePairValue = checkOnePair(cards);
  if (onePairValue) return onePairValue;

  // High card
  const sortedByRank = [...cards].sort((a, b) => b.rank - a.rank);
  return {
    ranking: HandRanking.HighCard,
    score: calculateTiebreaker(HandRanking.HighCard, sortedByRank.map(c => c.rank)),
    kickerCards: sortedByRank,
  };
}

/**
 * Evaluates the best 5-card hand from 7 cards (hole + board in Texas Hold'em)
 */
export function evaluateBestHand(holeCards: Card[], boardCards: Card[]): HandValue {
  const allCards = [...holeCards, ...boardCards];
  
  if (allCards.length !== 7) {
    throw new Error('Must provide 2 hole cards and 5 board cards');
  }

  let bestHand: HandValue | null = null;

  // Try all 5-card combinations
  for (let i = 0; i < allCards.length; i++) {
    for (let j = i + 1; j < allCards.length; j++) {
      for (let k = j + 1; k < allCards.length; k++) {
        for (let l = k + 1; l < allCards.length; l++) {
          for (let m = l + 1; m < allCards.length; m++) {
            const fiveCards = [allCards[i], allCards[j], allCards[k], allCards[l], allCards[m]];
            const hand = evaluateFiveCardHand(fiveCards);

            if (!bestHand || hand.score > bestHand.score) {
              bestHand = hand;
            }
          }
        }
      }
    }
  }

  return bestHand!;
}

/**
 * Evaluates the best 5-card hand from 7 cards and returns the actual cards
 */
export function evaluateBestHandWithCards(holeCards: Card[], boardCards: Card[]): BestHandResult {
  const allCards = [...holeCards, ...boardCards];
  
  if (allCards.length !== 7) {
    throw new Error('Must provide 2 hole cards and 5 board cards');
  }

  let bestHand: HandValue | null = null;
  let bestCards: Card[] = [];

  // Try all 5-card combinations
  for (let i = 0; i < allCards.length; i++) {
    for (let j = i + 1; j < allCards.length; j++) {
      for (let k = j + 1; k < allCards.length; k++) {
        for (let l = k + 1; l < allCards.length; l++) {
          for (let m = l + 1; m < allCards.length; m++) {
            const fiveCards = [allCards[i], allCards[j], allCards[k], allCards[l], allCards[m]];
            const hand = evaluateFiveCardHand(fiveCards);

            if (!bestHand || hand.score > bestHand.score) {
              bestHand = hand;
              bestCards = fiveCards;
            }
          }
        }
      }
    }
  }

  return {
    ranking: bestHand!.ranking,
    cards: bestCards,
  };
}

function checkStraightFlush(cards: Card[]): HandValue | null {
  const straight = checkStraight(cards);
  const flush = checkFlush(cards);

  if (straight && flush) {
    const sortedByRank = [...cards].sort((a, b) => b.rank - a.rank);
    const score = calculateTiebreaker(HandRanking.StraightFlush, sortedByRank.map(c => c.rank));
    return {
      ranking: HandRanking.StraightFlush,
      score,
      kickerCards: sortedByRank,
    };
  }

  return null;
}

function checkFourOfAKind(cards: Card[]): HandValue | null {
  const rankCounts = countRanks(cards);
  const fourRank = Object.entries(rankCounts).find(([_, count]) => count === 4)?.[0];

  if (fourRank) {
    const rank = parseInt(fourRank);
    const kicker = cards.find(c => c.rank !== rank)!;
    const score = calculateTiebreaker(HandRanking.FourOfAKind, [rank, rank, rank, rank, kicker.rank]);
    return {
      ranking: HandRanking.FourOfAKind,
      score,
      kickerCards: [{ suit: 0, rank: rank as Rank }, kicker],
    };
  }

  return null;
}

function checkFullHouse(cards: Card[]): HandValue | null {
  const rankCounts = countRanks(cards);
  const threeRank = Object.entries(rankCounts).find(([_, count]) => count === 3)?.[0];
  const twoRank = Object.entries(rankCounts).find(([_, count]) => count === 2)?.[0];

  if (threeRank && twoRank) {
    const threeRankNum = parseInt(threeRank);
    const twoRankNum = parseInt(twoRank);
    const score = calculateTiebreaker(HandRanking.FullHouse, [threeRankNum, threeRankNum, threeRankNum, twoRankNum, twoRankNum]);
    return {
      ranking: HandRanking.FullHouse,
      score,
      kickerCards: cards.filter(c => c.rank === threeRankNum || c.rank === twoRankNum),
    };
  }

  return null;
}

function checkFlush(cards: Card[]): HandValue | null {
  const suitCounts = countSuits(cards);
  const flushSuit = Object.entries(suitCounts).find(([_, count]) => count === 5)?.[0];

  if (flushSuit) {
    const suit = parseInt(flushSuit);
    const flushCards = cards.filter(c => c.suit === suit).sort((a, b) => b.rank - a.rank);
    const score = calculateTiebreaker(HandRanking.Flush, flushCards.map(c => c.rank));
    return {
      ranking: HandRanking.Flush,
      score,
      kickerCards: flushCards,
    };
  }

  return null;
}

function checkStraight(cards: Card[]): HandValue | null {
  const ranks = [...new Set(cards.map(c => c.rank))].sort((a, b) => b - a);

  // Check for regular straight
  for (let i = 0; i < ranks.length - 4; i++) {
    if (ranks[i] - ranks[i + 4] === 4) {
      const score = calculateTiebreaker(HandRanking.Straight, ranks.slice(i, i + 5));
      return {
        ranking: HandRanking.Straight,
        score,
        kickerCards: cards.filter(c => c.rank >= ranks[i + 4] && c.rank <= ranks[i]),
      };
    }
  }

  // Check for A-2-3-4-5 (wheel)
  if (ranks[0] === 14 && ranks.slice(1, 5).every((r, i) => r === 5 - i)) {
    const score = calculateTiebreaker(HandRanking.Straight, [5, 4, 3, 2, 1]);
    return {
      ranking: HandRanking.Straight,
      score,
      kickerCards: cards.filter(c => c.rank <= 5 || c.rank === 14),
    };
  }

  return null;
}

function checkThreeOfAKind(cards: Card[]): HandValue | null {
  const rankCounts = countRanks(cards);
  const threeRank = Object.entries(rankCounts).find(([_, count]) => count === 3)?.[0];

  if (threeRank) {
    const rank = parseInt(threeRank);
    const kickers = cards
      .filter(c => c.rank !== rank)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 2);
    const score = calculateTiebreaker(HandRanking.ThreeOfAKind, [rank, rank, rank, ...kickers.map(c => c.rank)]);
    return {
      ranking: HandRanking.ThreeOfAKind,
      score,
      kickerCards: [...cards.filter(c => c.rank === rank), ...kickers],
    };
  }

  return null;
}

function checkTwoPair(cards: Card[]): HandValue | null {
  const rankCounts = countRanks(cards);
  const pairs = Object.entries(rankCounts)
    .filter(([_, count]) => count === 2)
    .map(([rank]) => parseInt(rank))
    .sort((a, b) => b - a);

  if (pairs.length >= 2) {
    const kicker = cards.find(c => c.rank !== pairs[0] && c.rank !== pairs[1])!;
    const score = calculateTiebreaker(HandRanking.TwoPair, [pairs[0], pairs[0], pairs[1], pairs[1], kicker.rank]);
    return {
      ranking: HandRanking.TwoPair,
      score,
      kickerCards: [...cards.filter(c => c.rank === pairs[0] || c.rank === pairs[1]), kicker],
    };
  }

  return null;
}

function checkOnePair(cards: Card[]): HandValue | null {
  const rankCounts = countRanks(cards);
  const pairRank = Object.entries(rankCounts).find(([_, count]) => count === 2)?.[0];

  if (pairRank) {
    const rank = parseInt(pairRank);
    const kickers = cards
      .filter(c => c.rank !== rank)
      .sort((a, b) => b.rank - a.rank);
    const score = calculateTiebreaker(HandRanking.OnePair, [rank, rank, ...kickers.map(c => c.rank)]);
    return {
      ranking: HandRanking.OnePair,
      score,
      kickerCards: [...cards.filter(c => c.rank === rank), ...kickers],
    };
  }

  return null;
}

function countRanks(cards: Card[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const card of cards) {
    counts[card.rank] = (counts[card.rank] || 0) + 1;
  }
  return counts;
}

function countSuits(cards: Card[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const card of cards) {
    counts[card.suit] = (counts[card.suit] || 0) + 1;
  }
  return counts;
}

function calculateTiebreaker(ranking: HandRanking, ranks: number[]): number {
  // Score = (ranking << 20) + (rank1 << 16) + (rank2 << 12) + ...
  let score = ranking << 24;
  for (let i = 0; i < Math.min(ranks.length, 5); i++) {
    score += ranks[i] << (20 - i * 4);
  }
  return score;
}
