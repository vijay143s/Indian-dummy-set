import { CardType } from '../types.ts';

// Map rank strings to sequence order numbers
export const RANK_VALUES: Record<string, number> = {
  'A': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'J': 11,
  'Q': 12,
  'K': 13,
  'joker': 0, // Wild/Joker placeholder value
};

// Map card ranks to Rummy scoring points
export function getCardScoreValue(rank: string, isWild: boolean): number {
  if (rank === 'joker' || isWild) {
    return 0; // Jokers and wildcards carry 0 penalty points in most Dummy Rummy rules
  }
  if (['10', 'J', 'Q', 'K'].includes(rank)) {
    return 10;
  }
  if (rank === 'A') {
    return 10; // or 10 or 15. Let's make it 10 points.
  }
  return parseInt(rank, 10) || 5;
}

/**
 * Checks if a group of cards forms a valid Pure Sequence.
 * Must have at least 3 cards of the exact same suit with consecutive ranks,
 * and contains NO jokers or wildcards used as substitutes.
 */
export function isValidPureSequence(cardsList: CardType[]): boolean {
  if (cardsList.length < 3) return false;

  // Filter out actual jokers to verify purity. 
  // Paper wildcards are allowed if they are played in their natural consecutive slot of the same suit.
  const hasJokers = cardsList.some(c => c.suit === 'joker' || c.rank === 'joker');
  if (hasJokers) return false;

  // Must all have the same suit
  const suit = cardsList[0].suit;
  if (cardsList.some(c => c.suit !== suit)) return false;

  // Get raw rank values
  const values = cardsList.map(c => RANK_VALUES[c.rank]).sort((a, b) => a - b);

  // Check simple straight
  let isConsecutive = true;
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i + 1] !== values[i] + 1) {
      isConsecutive = false;
      break;
    }
  }

  if (isConsecutive) return true;

  // Check Ace-high sequence (e.g., Q-K-A which is 12, 13, 1)
  if (values.includes(1)) {
    const highValues = values.map(v => v === 1 ? 14 : v).sort((a, b) => a - b);
    let isHighConsecutive = true;
    for (let i = 0; i < highValues.length - 1; i++) {
      if (highValues[i + 1] !== highValues[i] + 1) {
        isHighConsecutive = false;
        break;
      }
    }
    if (isHighConsecutive) return true;
  }

  return false;
}

/**
 * Checks if a group of cards forms a valid Impure Sequence.
 * Must contain 3 or more cards of the same suit, incorporating at least one
 * joker/wildcard substituting intermediate missing items.
 */
export function isValidImpureSequence(cardsList: CardType[], allowWildcards: boolean = true): boolean {
  if (cardsList.length < 3) return false;
  if (!allowWildcards) return false; // Impure sequence fundamentally requires wildcards

  // Separate normal cards and wild/jokers
  const normals = cardsList.filter(c => c.suit !== 'joker' && c.rank !== 'joker' && !c.isWild && !c.isHiddenWild);
  const wildCount = cardsList.length - normals.length;

  if (normals.length === 0) return true; // All wildcards is theoretically valid

  // Normals must all be of the same suit
  const suit = normals[0].suit;
  if (normals.some(n => n.suit !== suit)) return false;

  // Get values of normal cards and sort them
  const values = normals.map(n => RANK_VALUES[n.rank]).sort((a, b) => a - b);

  // Check for duplicate normal cards (cannot have duplicates in a single sequence)
  const uniqueValues = new Set(values);
  if (uniqueValues.size !== values.length) return false;

  // Check if wild cards can bridge gaps
  // Gap calculation: items needed = (max - min + 1) - actual normal cards count
  const minVal = values[0];
  const maxVal = values[values.length - 1];
  const span = maxVal - minVal + 1;
  const gapsNum = span - normals.length;

  if (gapsNum <= wildCount) {
    return true;
  }

  // Check Ace-high sequence gap checking (Q, K, A, ... with gap bridge)
  if (values.includes(1)) {
    const highValues = values.map(v => v === 1 ? 14 : v).sort((a, b) => a - b);
    const minHighVal = highValues[0];
    const maxHighVal = highValues[highValues.length - 1];
    const highSpan = maxHighVal - minHighVal + 1;
    const highGapsNum = highSpan - normals.length;

    if (highGapsNum <= wildCount) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a group of cards forms a valid Melded Set.
 * Must contain 3 or 4 cards of the same rank but with different suits.
 * Jokers/Wildcards can substitute any missing card.
 */
export function isValidSet(cardsList: CardType[], allowWildcards: boolean = true): boolean {
  if (cardsList.length < 3) return false;

  const normals = cardsList.filter(c => c.suit !== 'joker' && c.rank !== 'joker' && !c.isWild && !c.isHiddenWild);
  
  if (!allowWildcards && normals.length !== cardsList.length) {
    return false; // If wildcards are not allowed, all cards must be normal
  }

  if (normals.length === 0) return true; // All wild cards form a set

  // All normal cards must have the same rank
  const rank = normals[0].rank;
  if (normals.some(n => n.rank !== rank)) return false;

  // In a multi-deck game (e.g., using two decks like this one),
  // repeating suits is fully allowed in a set. Therefore, we do not restrict suit uniqueness.

  return true;
}

/**
 * Validates a complete hand declare.
 * Indian Rummy/Dummy Set requires:
 * 1. At least two sequences
 * 2. At least one of these sequences must be a PURE sequence.
 * 3. The other groups can be pure sequences, impure sequences, or sets of same rank/different suits.
 * 4. All cards in hand must be arranged into valid melds (none left unmatched).
 */
export function validateDeclareGroups(groups: CardType[][], isClaimant: boolean = true, gameType: string = 'dummy_set'): { isValid: boolean; error?: string } {
  if (groups.length === 0) {
    return { isValid: false, error: "Please group your cards into valid sets and sequences." };
  }

  let pureSeqCount = 0;
  let impureSeqCount = 0;

  for (let idx = 0; idx < groups.length; idx++) {
    const group = groups[idx];
    
    const isPure = isValidPureSequence(group);
    const isImpure = isValidImpureSequence(group, isClaimant);
    const isMeldSet = isValidSet(group, isClaimant);

    if (isPure) pureSeqCount++;
    else if (isImpure) impureSeqCount++;

    if (!isPure && !isImpure && !isMeldSet) {
      const cardStrings = group.map(c => `${c.rank} of ${c.suit}${c.isWild ? ' (Wild)' : ''}${c.isHiddenWild ? ' (HiddenWild)' : ''}`);
      return { 
        isValid: false, 
        error: `Group ${idx + 1} is invalid. It does not form a valid Sequence or Set. (Cards checking: ${cardStrings.join(', ')})` 
      };
    }
  }

  if (gameType === 'rummy') {
    if (pureSeqCount < 1) {
      return { isValid: false, error: "Invalid Declare: You must have at least one Pure Sequence (without jokers)." };
    }
    if ((pureSeqCount + impureSeqCount) < 2) {
      return { isValid: false, error: "Invalid Declare: You must have at least two sequences (e.g. 1 Pure + 1 Impure)." };
    }
    
    const totalCards = groups.reduce((sum, g) => sum + g.length, 0);
    if (totalCards !== 13) {
       return { isValid: false, error: `Invalid Declare: You must meld exactly 13 cards, but you grouped ${totalCards}.` };
    }
  }

  return { isValid: true };
}

export interface MeldScoreBreakdown {
  type: 'pure_sequence' | 'impure_sequence' | 'set' | 'unmelded';
  cards: CardType[];
  isPure: boolean;
  isImpure: boolean;
  isSet: boolean;
  basePoints: number;
  cardValuesSum: number;
  pointsEarned: number;
  description: string;
}

export interface GameScoreBreakdown {
  melds: MeldScoreBreakdown[];
  totalPointsEarned: number;
  penaltyPoints: number;
  netScore: number;
}

/**
 * Calculates a highly transparent scoring breakdown for any player's card groups.
 * Incorporates custom rules:
 * - 3 Same rank or value as 0
 * - 2 same rank or value and joker as 0
 * - 2 same rank or value and wild card makes zero if player has 4 same rank or value cards
 * - 4 same rank or value makes 0
 * - Ignore if player have wild card without 4 same rank or value doesn’t have. (Wild cards are worth 0 points)
 * - Remaining cards should sum up
 * - All letters as 10
 */
export function calculateDetailedScoreBreakdown(
  groups: CardType[][],
  wildCardRank: string | null,
  wildCardSuit: string | null,
  isClaimant: boolean = true,
  gameType: string = 'dummy_set'
): GameScoreBreakdown {
  const melds: MeldScoreBreakdown[] = [];
  let totalPointsEarned = 0;
  let penaltyPoints = 0;

  // Determine ranks that appear 4 or more times in total across all groups (4 of a kind in hand)
  const rankCount: Record<string, number> = {};
  for (const group of groups) {
    for (const card of group) {
      if (card.rank !== 'joker' && card.suit !== 'joker') {
        rankCount[card.rank] = (rankCount[card.rank] || 0) + 1;
      }
    }
  }
  const fourOfAKindRanks = Object.keys(rankCount).filter(rank => rankCount[rank] >= 4);

  // Helper to check if a card is a wild card (paper wild card, joker card, marked isWild, or part of a 4-of-a-kind)
  const isWildCard = (c: CardType) => {
    if (gameType === 'rummy') {
      return c.rank === 'joker' || c.suit === 'joker' || (wildCardRank !== null && c.rank === wildCardRank);
    }
    return c.rank === 'joker' || 
           c.suit === 'joker' || 
           c.isWild || 
           c.isHiddenWild || 
           (wildCardRank !== null && c.rank === wildCardRank);
  };

  // Check if player has at least one group of "4 same rank or value cards"
  const hasFourOfAKind = groups.some(group => {
    // Needs exactly 4 same rank cards
    if (group.length !== 4) return false;
    const normals = group.filter(c => !isWildCard(c));
    if (normals.length === 0) return true; // All wildcards
    const firstRank = normals[0].rank;
    return normals.every(c => c.rank === firstRank);
  });

  // Check Rummy requirements for scoring
  let rummyPureCount = 0;
  let rummyImpureCount = 0;
  if (gameType === 'rummy') {
    groups.forEach(g => {
      if (isValidPureSequence(g)) rummyPureCount++;
      else if (isValidImpureSequence(g, isClaimant)) rummyImpureCount++;
    });
  }

  for (let idx = 0; idx < groups.length; idx++) {
    const group = groups[idx];
    if (group.length === 0) continue;

    const normals = group.filter(c => !isWildCard(c));
    const wilds = group.filter(c => isWildCard(c));

    const isPure = isValidPureSequence(group);
    // Non-claimants cannot use wildcards to form sets/sequences in Dummy Set!
    // In Rummy, everyone can use wildcards (so pass true for rummy)
    const canUseWilds = gameType === 'rummy' ? true : isClaimant;
    const isImpure = isValidImpureSequence(group, canUseWilds);

    let isZeroPenaltySet = false;
    let customRuleMatched = '';

    if (gameType === 'dummy_set') {
      // Custom Rules Verification:
      // 1. "4 same rank or value makes 0"
      if (group.length === 4 && normals.length === 4 && normals.every(c => c.rank === normals[0].rank)) {
        isZeroPenaltySet = true;
        customRuleMatched = "4 Same Rank/Value Set";
      }
      // 2. "3 Same rank or value as 0"
      else if (group.length === 3 && normals.length === 3 && normals.every(c => c.rank === normals[0].rank)) {
        isZeroPenaltySet = true;
        customRuleMatched = "3 Same Rank/Value Set";
      }
      // 3. "2 same rank or value and joker as 0"
      else if (group.length === 3 && normals.length === 2 && normals[0].rank === normals[1].rank && wilds.some(c => c.rank === 'joker' || c.suit === 'joker')) {
        isZeroPenaltySet = true;
        customRuleMatched = "2 Same Rank + Joker Set";
      }
      // 4. "2 same rank or value and wild card makes zero if player has 4 same rank or value cards"
      else if (group.length === 3 && normals.length === 2 && normals[0].rank === normals[1].rank && wilds.some(c => c.rank === wildCardRank || c.isWild || c.isHiddenWild)) {
        if (hasFourOfAKind) {
          isZeroPenaltySet = true;
          customRuleMatched = "2 Same Rank + Wild Card (4-of-a-Kind Bonus)";
        } else {
          isZeroPenaltySet = false;
          customRuleMatched = "2 Same Rank + Wild Card (Needs 4-of-a-Kind Set)";
        }
      }
    }

    // Default valid check fallbacks if not matched by custom rule but valid general meld
    const isValidGeneralSet = isValidSet(group.map(c => ({ ...c, isWild: isWildCard(c) })), canUseWilds);
    let isMeldValid = isPure || isImpure || isZeroPenaltySet || isValidGeneralSet;

    // Rummy strict validity penalty checks
    if (gameType === 'rummy') {
      if (rummyPureCount === 0) {
        // No pure sequence = EVERYTHING is unmelded (penalized)
        isMeldValid = false;
      } else if (rummyPureCount > 0 && (rummyPureCount + rummyImpureCount) < 2) {
        // Only pure sequences are valid, sets and impure sequences are penalized
        if (!isPure) isMeldValid = false;
      }
    }

    // Calculate sum of card points (ignoring wildcards which are worth 0 points!)
    let cardValuesSum = 0;
    for (const card of group) {
      if (isWildCard(card)) {
        // "Ignore wildcard" - wildcard points contribution is strictly 0
        continue;
      }
      if (['10', 'J', 'Q', 'K', 'A'].includes(card.rank)) {
        // All letters A, J, Q, K + number 10 are worth 10 points
        cardValuesSum += 10;
      } else {
        cardValuesSum += parseInt(card.rank, 10) || 5;
      }
    }

    if (isMeldValid) {
      const basePoints = gameType === 'rummy' ? 0 : (isPure ? 100 : (isImpure ? 50 : 40));
      const pointsEarned = basePoints + cardValuesSum;
      totalPointsEarned += pointsEarned;
      
      let finalDesc = `Valid Set`;
      if (gameType === 'dummy_set') {
         finalDesc = `Valid Set (+${basePoints} Base + ${cardValuesSum} face values)`;
         if (isPure) finalDesc = `Pure Sequence (+${basePoints} Base + ${cardValuesSum} face values)`;
         else if (isImpure) finalDesc = `Impure Sequence (+${basePoints} Base + ${cardValuesSum} face values)`;
         else if (customRuleMatched) finalDesc = `${customRuleMatched} (+${basePoints} Base + ${cardValuesSum} face values)`;
      } else {
         if (isPure) finalDesc = `Pure Sequence`;
         else if (isImpure) finalDesc = `Impure Sequence`;
      }

      melds.push({
        type: isPure ? 'pure_sequence' : (isImpure ? 'impure_sequence' : 'set'),
        cards: group,
        isPure,
        isImpure,
        isSet: !isPure && !isImpure,
        basePoints,
        cardValuesSum,
        pointsEarned,
        description: finalDesc
      });
    } else {
      // Unmelded group. Remaining cards should sum up penalty!
      penaltyPoints += cardValuesSum;
      melds.push({
        type: 'unmelded',
        cards: group,
        isPure: false,
        isImpure: false,
        isSet: false,
        basePoints: 0,
        cardValuesSum,
        pointsEarned: 0,
        description: customRuleMatched === "2 Same Rank + Wild Card (Needs 4-of-a-Kind Set)"
          ? `Unmelded Set (Needs 4-of-a-Kind to unlock Wild Card, Penalty: -${cardValuesSum} pts)`
          : `Unmelded/Mismatch (Penalty: -${cardValuesSum} pts)`
      });
    }
  }

  // Cap penalty points in typical Indian Rummy to 80
  const finalPenalty = Math.min(penaltyPoints, 80);
  const netScore = totalPointsEarned - finalPenalty;

  return {
    melds,
    totalPointsEarned,
    penaltyPoints: finalPenalty,
    netScore
  };
}
