import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

// 1. Users Table (using Mobile Auth UID as primary key)
export const users = sqliteTable("users", {
  uid: text("uid").primaryKey(), // Using mobile as uid
  mobile: text("mobile").notNull().unique(), // 10-digit mobile number
  displayName: text("display_name"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// 2. Games Table
export const games = sqliteTable("games", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(), // Access code (e.g., 'DS-1029')
  status: text("status").notNull().default("waiting"), // 'waiting', 'toss', 'playing', 'round_finished', 'finished'
  maxScore: integer("max_score").notNull().default(200), // Elimination threshold
  gameAmount: integer("game_amount").notNull().default(0), // Amount for the game
  currentTurnPlayerId: integer("current_turn_player_id"), // Reference to players.id
  dealerPlayerId: integer("dealer_player_id"), // Reference to players.id
  roundNumber: integer("round_number").notNull().default(1),
  wildCardSuit: text("wild_card_suit"), // Randomly designated joker rank/suit
  wildCardRank: text("wild_card_rank"),
  winnerPlayerId: integer("winner_player_id"), // Reference to players.id
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// 3. Players Table
export const players = sqliteTable("players", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gameId: integer("game_id")
    .references(() => games.id, { onDelete: "cascade" })
    .notNull(),
  userId: text("user_id")
    .references(() => users.uid)
    .notNull(),
  username: text("username").notNull(),
  turnOrder: integer("turn_order").notNull().default(0),
  isOnline: integer("is_online", { mode: "boolean" }).notNull().default(true),
  netScore: integer("net_score").notNull().default(0),
  isEliminated: integer("is_eliminated", { mode: "boolean" }).notNull().default(false),
  joinedAt: text("joined_at").default(sql`CURRENT_TIMESTAMP`),
});

// 4. Cards Table (Detailed individual card state for secrecy & role visibility)
export const cards = sqliteTable("cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gameId: integer("game_id")
    .references(() => games.id, { onDelete: "cascade" })
    .notNull(),
  suit: text("suit").notNull(), // 'spades', 'hearts', 'diamonds', 'clubs', 'joker'
  rank: text("rank").notNull(), // 'A', '2', '3', ..., '10', 'J', 'Q', 'K', 'joker'
  isWild: integer("is_wild", { mode: "boolean" }).notNull().default(false), // Is matching the designated paper joker rank
  isHiddenWild: integer("is_hidden_wild", { mode: "boolean" }).notNull().default(false), // Special rewarded wild card
  ownerPlayerId: integer("owner_player_id") // References players.id
    .references(() => players.id, { onDelete: "set null" }),
  location: text("location").notNull().default("deck"), // 'deck', 'discard', 'hand', 'declared'
  position: integer("position").notNull().default(0), // Ordering index
  declaredGroupId: text("declared_group_id"), // Group identifier when placing combinations
});

// 5. Player Hands Table
export const playerHands = sqliteTable("player_hands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playerId: integer("player_id")
    .references(() => players.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  hasDeclared: integer("has_declared", { mode: "boolean" }).notNull().default(false),
  hasDropped: integer("has_dropped", { mode: "boolean" }).notNull().default(false),
  score: integer("score").notNull().default(0),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// 6. Wild Card Claims Table (4 of a kind claim)
export const wildCardClaims = sqliteTable("wild_card_claims", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gameId: integer("game_id")
    .references(() => games.id, { onDelete: "cascade" })
    .notNull(),
  claimantPlayerId: integer("claimant_player_id")
    .references(() => players.id, { onDelete: "cascade" })
    .notNull(),
  verifierPlayerId: integer("verifier_player_id") // The immediate next player
    .references(() => players.id, { onDelete: "cascade" })
    .notNull(),
  cardRank: text("card_rank").notNull(), // e.g. 'K'
  status: text("status").notNull().default("pending"), // 'pending', 'approved', 'rejected', 'expired'
  requestedAt: text("requested_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  expiresAt: text("expires_at").notNull(),
  cardIds: text("card_ids", { mode: "json" }).notNull(), // JSON array of 4 card IDs being verified
});

// 7. Wild Card Approvals Table
export const wildCardApprovals = sqliteTable("wild_card_approvals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  claimId: integer("claim_id")
    .references(() => wildCardClaims.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  verifierPlayerId: integer("verifier_player_id")
    .references(() => players.id, { onDelete: "cascade" })
    .notNull(),
  approved: integer("approved", { mode: "boolean" }).notNull(),
  loggedAt: text("logged_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  comments: text("comments"),
});

// 8. Game Events Table (Audit logs & Event Sourcing)
export const gameEvents = sqliteTable("game_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gameId: integer("game_id")
    .references(() => games.id, { onDelete: "cascade" })
    .notNull(),
  playerId: integer("player_id")
    .references(() => players.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // e.g., 'draw', 'discard', 'claim_wild', 'approve_wild', 'reject_wild', 'expire_wild'
  payload: text("payload", { mode: "json" }),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 9. Round Scores Table
export const roundScores = sqliteTable("round_scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gameId: integer("game_id")
    .references(() => games.id, { onDelete: "cascade" })
    .notNull(),
  roundNumber: integer("round_number").notNull(),
  playerId: integer("player_id")
    .references(() => players.id, { onDelete: "cascade" })
    .notNull(),
  currentPoints: integer("current_points").notNull().default(0),
  netScoreAfter: integer("net_score_after").notNull().default(0),
  isWinner: integer("is_winner", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// --- Relations ---
export const usersRelations = relations(users, ({ many }) => ({
  players: many(players),
}));

export const gamesRelations = relations(games, ({ many }) => ({
  players: many(players),
  cards: many(cards),
  claims: many(wildCardClaims),
  events: many(gameEvents),
}));

export const playersRelations = relations(players, ({ one, many }) => ({
  game: one(games, { fields: [players.gameId], references: [games.id] }),
  user: one(users, { fields: [players.userId], references: [users.uid] }),
  hand: one(playerHands, { fields: [players.id], references: [playerHands.playerId] }),
  cards: many(cards),
  claims: many(wildCardClaims, { relationName: "claimant" }),
  verifications: many(wildCardClaims, { relationName: "verifier" }),
  approvals: many(wildCardApprovals),
  events: many(gameEvents),
  roundScores: many(roundScores),
}));

export const cardsRelations = relations(cards, ({ one }) => ({
  game: one(games, { fields: [cards.gameId], references: [games.id] }),
  owner: one(players, { fields: [cards.ownerPlayerId], references: [players.id] }),
}));

export const playerHandsRelations = relations(playerHands, ({ one }) => ({
  player: one(players, { fields: [playerHands.playerId], references: [players.id] }),
}));

export const wildCardClaimsRelations = relations(wildCardClaims, ({ one }) => ({
  game: one(games, { fields: [wildCardClaims.gameId], references: [games.id] }),
  claimant: one(players, { fields: [wildCardClaims.claimantPlayerId], references: [players.id] }),
  verifier: one(players, { fields: [wildCardClaims.verifierPlayerId], references: [players.id] }),
  approval: one(wildCardApprovals, { fields: [wildCardClaims.id], references: [wildCardApprovals.claimId] }),
}));

export const wildCardApprovalsRelations = relations(wildCardApprovals, ({ one }) => ({
  claim: one(wildCardClaims, { fields: [wildCardApprovals.claimId], references: [wildCardClaims.id] }),
  verifier: one(players, { fields: [wildCardApprovals.verifierPlayerId], references: [players.id] }),
}));

export const gameEventsRelations = relations(gameEvents, ({ one }) => ({
  game: one(games, { fields: [gameEvents.gameId], references: [games.id] }),
  player: one(players, { fields: [gameEvents.playerId], references: [players.id] }),
}));

export const roundScoresRelations = relations(roundScores, ({ one }) => ({
  game: one(games, { fields: [roundScores.gameId], references: [games.id] }),
  player: one(players, { fields: [roundScores.playerId], references: [players.id] }),
}));
