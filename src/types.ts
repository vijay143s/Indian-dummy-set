export interface AuthUser {
  uid: string;
  displayName?: string;
  token: string;
}

export interface CardType {
  id: number;
  gameId: number;
  suit: string; // 'spades' | 'hearts' | 'diamonds' | 'clubs' | 'joker'
  rank: string; // 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'joker'
  isWild: boolean; // matches the face-up wildcard chosen at start
  isHiddenWild: boolean; // awarded through the 4-of-a-kind claim
  ownerPlayerId: number | null;
  location: 'deck' | 'discard' | 'hand' | 'declared' | 'wildcard_slot';
  position: number;
  declaredGroupId?: string | null;
}

export interface PlayerType {
  id: number;
  gameId: number;
  userId: string;
  username: string;
  turnOrder: number;
  isOnline: boolean;
  score: number;
  netScore: number;
  isEliminated: boolean;
  hasDeclared: boolean;
  hasDropped: boolean;
  joinedAt?: string | Date | null;
}

export interface GameType {
  id: number;
  code: string;
  status: 'waiting' | 'playing' | 'finished' | string;
  currentTurnPlayerId: number | null;
  dealerPlayerId: number | null;
  roundNumber: number;
  wildCardSuit: string | null;
  wildCardRank: string | null;
  winnerPlayerId: number | null;
  maxScore: number;
  gameAmount: number;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

export interface WildCardClaimType {
  id: number;
  gameId: number;
  claimantPlayerId: number;
  verifierPlayerId: number;
  cardRank: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | string;
  requestedAt: string | Date;
  expiresAt: string | Date;
  cardIds: any;
}

export interface WildCardApprovalType {
  id: number;
  claimId: number;
  verifierPlayerId: number;
  approved: boolean;
  loggedAt: string;
  comments?: string | null;
}

export interface GameEventType {
  id: number;
  gameId: number;
  playerId: number | null;
  eventType: string;
  payload: any;
  createdAt: string;
}

// Full hydrated game state returned securely depending on who is requesting
export interface GameStateResponse {
  game: GameType;
  players: PlayerType[];
  cards: CardType[]; // Filtered or scrubbed based on viewer permissions!
  activeClaim: WildCardClaimType | null; 
  recentEvents: GameEventType[];
  viewerPlayerId: number | null; // ID of the player viewing (to map hand controls)
  roundScores?: any[];
}
