import { db } from './index.ts';
import { games, players, cards, playerHands, wildCardClaims, wildCardApprovals, gameEvents } from './schema.ts';
import { eq, and, desc, asc, sql, or } from 'drizzle-orm';
import { CardType, PlayerType, GameType, WildCardClaimType } from '../types.ts';

function generateGameCode(): string {
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

// 1. Create a Game Lobby
export async function createGame(maxScore: number = 200, gameAmount: number = 0, gameType: string = 'dummy_set'): Promise<GameType> {
  try {
    const code = generateGameCode();
    const result = await db.insert(games)
      .values({
        code,
        status: 'waiting',
        maxScore,
        gameAmount,
        gameType,
        roundNumber: 1,
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error("Database error in createGame:", error);
    throw new Error("Failed to create a new game lobby.", { cause: error });
  }
}

// 2. Load Game by Code
export async function getGameByCode(code: string): Promise<GameType | null> {
  try {
    const uppercaseCode = code.toUpperCase().trim();
    const result = await db.select()
      .from(games)
      .where(eq(games.code, uppercaseCode))
      .limit(1);

    return result[0] || null;
  } catch (error) {
    console.error("Database error in getGameByCode:", error);
    throw new Error("Failed to search game by lobby code.", { cause: error });
  }
}

// 3. Load Game by ID
export async function getGameById(id: number): Promise<GameType | null> {
  try {
    const result = await db.select()
      .from(games)
      .where(eq(games.id, id))
      .limit(1);

    return result[0] || null;
  } catch (error) {
    console.error("Database error in getGameById:", error);
    throw new Error("Failed to search game by ID.", { cause: error });
  }
}

// 4. Update Game details
export async function updateGame(id: number, values: Partial<typeof games.$inferInsert>): Promise<GameType> {
  try {
    const result = await db.update(games)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(games.id, id))
      .returning();

    return result[0];
  } catch (error) {
    console.error("Database error in updateGame:", error);
    throw new Error("Failed to update game state.", { cause: error });
  }
}

// 5. Join Player to Game
export async function addPlayer(gameId: number, userId: string, username: string, isHost: boolean = false): Promise<PlayerType> {
  try {
    // Check if player already exists
    const existing = await db.select()
      .from(players)
      .where(and(eq(players.gameId, gameId), eq(players.userId, userId)))
      .limit(1);

    if (existing.length > 0) {
      // Return existing and mark online
      await db.update(players)
        .set({ isOnline: true })
        .where(eq(players.id, existing[0].id));
      
      const p = existing[0];
      const hand = await db.select().from(playerHands).where(eq(playerHands.playerId, p.id)).limit(1);
      return {
        ...p,
        score: hand[0]?.score || 0,
        hasDeclared: hand[0]?.hasDeclared || false,
        hasDropped: hand[0]?.hasDropped || false,
      };
    }

    // Determine current number of players to assign turn order
    const currentList = await db.select().from(players).where(eq(players.gameId, gameId));
    if (currentList.length >= 6) {
      throw new Error("Lobby is full. Max 6 players allowed.");
    }

    const order = currentList.length;

    // Create player record
    const result = await db.insert(players)
      .values({
        gameId,
        userId,
        username,
        turnOrder: order,
        isOnline: true,
      })
      .returning();

    const newPlayer = result[0];

    // Create associated player hand stats
    await db.insert(playerHands)
      .values({
        playerId: newPlayer.id,
        hasDeclared: false,
        hasDropped: false,
        score: 0,
      });

    return {
      ...newPlayer,
      score: 0,
      hasDeclared: false,
      hasDropped: false,
    };
  } catch (error: any) {
    console.error("Database error in addPlayer:", error);
    throw new Error(error.message || "Failed to join game lobby.", { cause: error });
  }
}

// 6. Get Hydrated Players List for a Game
export async function getGamePlayers(gameId: number): Promise<PlayerType[]> {
  try {
    const list = await db.select()
      .from(players)
      .where(eq(players.gameId, gameId))
      .orderBy(asc(players.turnOrder));

    const hydrated: PlayerType[] = [];
    for (const p of list) {
      const hand = await db.select()
        .from(playerHands)
        .where(eq(playerHands.playerId, p.id))
        .limit(1);

      hydrated.push({
        ...p,
        score: hand[0]?.score || 0,
        hasDeclared: hand[0]?.hasDeclared || false,
        hasDropped: hand[0]?.hasDropped || false,
      });
    }

    return hydrated;
  } catch (error) {
    console.error("Database error in getGamePlayers:", error);
    throw new Error("Failed to load lobby players.", { cause: error });
  }
}

// 7. Initialize Game cards (Standard 2 double decks for Dummy Set including Jokers)
export async function setupGameDeck(gameId: number): Promise<CardType[]> {
  try {
    // Delete existing cards just in case
    await db.delete(cards).where(eq(cards.gameId, gameId));

    const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    
    const deckCards: { suit: string; rank: string; position: number }[] = [];
    let pos = 0;

    // We use TWO complete decks (104 standard cards + 4 Jokers = 108 total cards)
    for (let deckNum = 1; deckNum <= 2; deckNum++) {
      for (const suit of suits) {
        for (const rank of ranks) {
          deckCards.push({ suit, rank, position: pos++ });
        }
      }
      // Add 2 Jokers per deck
      deckCards.push({ suit: 'joker', rank: 'joker', position: pos++ });
      deckCards.push({ suit: 'joker', rank: 'joker', position: pos++ });
    }

    // Shuffle the array of card skeletons
    for (let i = deckCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = deckCards[i];
      deckCards[i] = deckCards[j];
      deckCards[j] = temp;
    }

    // Insert to DB with correct positions
    const values = deckCards.map((c, idx) => ({
      gameId,
      suit: c.suit,
      rank: c.rank,
      location: 'deck' as const,
      position: idx,
      isWild: false,
      isHiddenWild: false,
    }));

    // Batch insertion (break down if very large, but 108 cards is perfectly fine for single SQL insert)
    const result = await db.insert(cards).values(values).returning();
    return result as CardType[];
  } catch (error) {
    console.error("Database error in setupGameDeck:", error);
    throw new Error("Failed to prepare or shuffle game deck.", { cause: error });
  }
}

// 8. Get Game Cards
export async function getGameCards(gameId: number): Promise<CardType[]> {
  try {
    const list = await db.select()
      .from(cards)
      .where(eq(cards.gameId, gameId))
      .orderBy(asc(cards.position));

    return list as CardType[];
  } catch (error) {
    console.error("Database error in getGameCards:", error);
    throw new Error("Failed to query cards for the game.", { cause: error });
  }
}

// 9. Draw Card (From Draw Pile top)
export async function drawCardFromDeck(gameId: number, playerId: number): Promise<CardType> {
  try {
    // Find the deck card with the lowest position (or highest, just consistent)
    const available = await db.select()
      .from(cards)
      .where(and(eq(cards.gameId, gameId), eq(cards.location, 'deck')))
      .orderBy(asc(cards.position))
      .limit(1);

    if (available.length === 0) {
      // Re-initialize deck from discard pile if empty
      const discardCount = await db.select()
        .from(cards)
        .where(and(eq(cards.gameId, gameId), eq(cards.location, 'discard')))
        .orderBy(desc(cards.position));

      if (discardCount.length <= 1) {
        throw new Error("No cards left to draw in the deck or discard piles.");
      }

      // Keep top discard, recycle the rest
      const topDiscardId = discardCount[0].id;
      const recyclePayloads = discardCount.slice(1);
      
      // Shuffle them and put back in deck
      for (let i = recyclePayloads.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = recyclePayloads[i];
        recyclePayloads[i] = recyclePayloads[j];
        recyclePayloads[j] = temp;
      }

      for (let i = 0; i < recyclePayloads.length; i++) {
        await db.update(cards)
          .set({
            location: 'deck',
            position: i,
            ownerPlayerId: null,
          })
          .where(eq(cards.id, recyclePayloads[i].id));
      }

      // Re-fetch
      return drawCardFromDeck(gameId, playerId);
    }

    const nextCard = available[0];

    // Get current hand size to assign hand ordering
    const handCountResponse = await db.select({ count: sql<number>`count(*)` })
      .from(cards)
      .where(and(eq(cards.gameId, gameId), eq(cards.ownerPlayerId, playerId), eq(cards.location, 'hand')));
    
    const handCount = Number(handCountResponse[0]?.count || 0);

    const result = await db.update(cards)
      .set({
        location: 'hand',
        ownerPlayerId: playerId,
        position: handCount,
      })
      .where(eq(cards.id, nextCard.id))
      .returning();

    return result[0] as CardType;
  } catch (error: any) {
    console.error("Database error in drawCardFromDeck:", error);
    throw new Error(error.message || "Failed to draw card from deck.", { cause: error });
  }
}

// 10. Draw Card (From Discard top)
export async function drawCardFromDiscard(gameId: number, playerId: number): Promise<CardType> {
  try {
    // Get top discard card (highest position in discard pile)
    const available = await db.select()
      .from(cards)
      .where(and(eq(cards.gameId, gameId), eq(cards.location, 'discard')))
      .orderBy(desc(cards.position))
      .limit(1);

    if (available.length === 0) {
      throw new Error("The discard pile is empty.");
    }

    const nextCard = available[0];

    // Find user's hand count
    const handCountResponse = await db.select({ count: sql<number>`count(*)` })
      .from(cards)
      .where(and(eq(cards.gameId, gameId), eq(cards.ownerPlayerId, playerId), eq(cards.location, 'hand')));
    
    const handCount = Number(handCountResponse[0]?.count || 0);

    const result = await db.update(cards)
      .set({
        location: 'hand',
        ownerPlayerId: playerId,
        position: handCount,
      })
      .where(eq(cards.id, nextCard.id))
      .returning();

    return result[0] as CardType;
  } catch (error: any) {
    console.error("Database error in drawCardFromDiscard:", error);
    throw new Error(error.message || "Failed to draw card from discard.", { cause: error });
  }
}

// 11. Discard Card
export async function discardCard(gameId: number, playerId: number, cardId: number): Promise<CardType> {
  try {
    // Verify player owns card
    const item = await db.select()
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.ownerPlayerId, playerId)))
      .limit(1);

    if (item.length === 0) {
      throw new Error("You do not own this card or it is not in your hand.");
    }

    // Find highest position in discard pile
    const discardPile = await db.select()
      .from(cards)
      .where(and(eq(cards.gameId, gameId), eq(cards.location, 'discard')))
      .orderBy(desc(cards.position))
      .limit(1);

    const nextPos = discardPile.length > 0 ? discardPile[0].position + 1 : 0;

    const result = await db.update(cards)
      .set({
        location: 'discard',
        ownerPlayerId: null,
        position: nextPos,
        declaredGroupId: null,
      })
      .where(eq(cards.id, cardId))
      .returning();

    // Reorder remaining player hand positions
    const remainingHand = await db.select()
      .from(cards)
      .where(and(eq(cards.gameId, gameId), eq(cards.ownerPlayerId, playerId), eq(cards.location, 'hand')))
      .orderBy(asc(cards.position));

    for (let i = 0; i < remainingHand.length; i++) {
      await db.update(cards)
        .set({ position: i })
        .where(eq(cards.id, remainingHand[i].id));
    }

    return result[0] as CardType;
  } catch (error: any) {
    console.error("Database error in discardCard:", error);
    throw new Error(error.message || "Failed to discard the card.", { cause: error });
  }
}

export async function createWildCardClaim(
  gameId: number, 
  claimantPlayerId: number, 
  verifierPlayerId: number, 
  cardRank: string, 
  cardPayload: { hand: number[], deck: number }
): Promise<WildCardClaimType> {
  try {
    // Check if active claim already exists
    const active = await db.select()
      .from(wildCardClaims)
      .where(and(eq(wildCardClaims.gameId, gameId), eq(wildCardClaims.status, 'pending')));

    if (active.length > 0) {
      throw new Error("There is already a pending wild card claim in progress.");
    }

    // Set expiry to 30 seconds from now
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 1000);

    const result = await db.insert(wildCardClaims)
      .values({
        gameId,
        claimantPlayerId,
        verifierPlayerId,
        cardRank,
        status: 'pending',
        requestedAt: now,
        expiresAt: expiresAt.toISOString(),
        cardIds: cardPayload,
      })
      .returning();

    const claim = result[0];

    return {
      ...claim,
      cardIds: claim.cardIds as any,
      requestedAt: claim.requestedAt,
      expiresAt: claim.expiresAt,
    };
  } catch (error: any) {
    console.error("Database error in createWildCardClaim:", error);
    throw new Error(error.message || "Failed to create wildcard claim.", { cause: error });
  }
}

// 13. Fetch Active Wild Card Claim
export async function getActiveClaim(gameId: number): Promise<WildCardClaimType | null> {
  try {
    // Fetch all pending claims for this game and filter expiration in safe JavaScript time space
    const pendingClaims = await db.select()
      .from(wildCardClaims)
      .where(and(
        eq(wildCardClaims.gameId, gameId),
        eq(wildCardClaims.status, 'pending')
      ));

    const nowMs = Date.now();
    for (const c of pendingClaims) {
      if (new Date(c.expiresAt).getTime() < nowMs) {
        // Mark as expired in DB
        await db.update(wildCardClaims)
          .set({ status: 'expired' })
          .where(eq(wildCardClaims.id, c.id));

        // Create a game event for expiration
        await saveGameEvent(gameId, c.claimantPlayerId, 'expire_wild', {
          claimId: c.id,
          verifierPlayerId: c.verifierPlayerId,
          cardRank: c.cardRank,
        });
      }
    }

    // Re-query current active claim (either pending verifier approval or approved and waiting for claimant selection)
    const result = await db.select()
      .from(wildCardClaims)
      .where(and(
        eq(wildCardClaims.gameId, gameId),
        or(
          eq(wildCardClaims.status, 'pending'),
          eq(wildCardClaims.status, 'approved_to_select')
        )
      ))
      .limit(1);

    if (result.length === 0) return null;

    const claim = result[0];
    return {
      ...claim,
      cardIds: claim.cardIds as any,
      requestedAt: claim.requestedAt,
      expiresAt: claim.expiresAt,
    };
  } catch (error) {
    console.error("Database error in getActiveClaim:", error);
    throw new Error("Failed to load active claim state.", { cause: error });
  }
}

// 14. Approve or Reject a Claim
export async function processWildCardClaim(claimId: number, verifierPlayerId: number, approve: boolean): Promise<boolean> {
  try {
    const claim = await db.select()
      .from(wildCardClaims)
      .where(eq(wildCardClaims.id, claimId))
      .limit(1);

    if (claim.length === 0) {
      throw new Error("Claim not found.");
    }

    const c = claim[0];
    if (c.status !== 'pending') {
      throw new Error(`This claim has already been resolved as ${c.status}.`);
    }

    if (c.verifierPlayerId !== verifierPlayerId) {
      throw new Error("You are not authorized to verify this claim.");
    }

    // Save approval/rejection details
    await db.insert(wildCardApprovals)
      .values({
        claimId,
        verifierPlayerId,
        approved: approve,
        comments: approve ? "Verified manually by next player" : "Rejected by next player",
      });

    // If approved, instantly complete and set wildcard
    if (approve) {
      const game = await getGameById(c.gameId);
      
      // If the wildcard is already established, just mark the claim as completed
      // and skip drawing a new card from the deck!
      if (game && game.wildCardRank) {
        await db.update(wildCardClaims)
          .set({ status: 'completed', cardRank: `${game.wildCardRank}:${game.wildCardSuit}` })
          .where(eq(wildCardClaims.id, claimId));

        await saveGameEvent(c.gameId, verifierPlayerId, 'wildcard_selected', {
          claimantPlayerId: c.claimantPlayerId,
          cardRank: game.wildCardRank,
          suit: game.wildCardSuit
        });
        return true;
      }

      const payload = c.cardIds as any;
      const targetDeckCardId = payload.deck;

      // Draw the pre-selected deck card and assign it as Wildcard
      const [deckCard] = await db.select().from(cards).where(eq(cards.id, targetDeckCardId));
      if (!deckCard || deckCard.location !== 'deck') {
        throw new Error("The chosen deck card is no longer available.");
      }

      await db.update(cards).set({ location: 'wildcard_slot', isWild: true, ownerPlayerId: c.claimantPlayerId }).where(eq(cards.id, targetDeckCardId));

      const wildSuit = deckCard.suit === 'joker' ? 'diamonds' : deckCard.suit;
      const wildRank = deckCard.suit === 'joker' ? '8' : deckCard.rank;

      await updateGame(c.gameId, {
        wildCardRank: wildRank,
        wildCardSuit: wildSuit
      });

      await markGameWildCards(c.gameId, wildRank);

      await db.update(wildCardClaims)
        .set({ status: 'completed', cardRank: `${wildRank}:${wildSuit}` })
        .where(eq(wildCardClaims.id, claimId));

      await saveGameEvent(c.gameId, verifierPlayerId, 'wildcard_selected', {
        claimantPlayerId: c.claimantPlayerId,
        cardRank: wildRank,
        suit: wildSuit
      });
      return true;
    } else {
      await db.update(wildCardClaims)
        .set({ status: 'rejected' })
        .where(eq(wildCardClaims.id, claimId));

      await saveGameEvent(c.gameId, verifierPlayerId, 'reject_wild', {
        claimId,
        claimantPlayerId: c.claimantPlayerId,
        cardRank: c.cardRank,
      });
      return true;
    }
  } catch (error: any) {
    console.error("Database error in processWildCardClaim:", error);
    throw new Error(error.message || "Failed to resolve wild card claim.", { cause: error });
  }
}

// 15. Save Game Event to Audit log
export async function saveGameEvent(gameId: number, playerId: number | null, eventType: string, payload: any): Promise<void> {
  try {
    await db.insert(gameEvents)
      .values({
        gameId,
        playerId,
        eventType,
        payload,
      });
  } catch (error) {
    console.error("Database error in saveGameEvent:", error);
  }
}

// 16. Load Recent events
export async function getRecentGameEvents(gameId: number, limitCount: number = 15): Promise<any[]> {
  try {
    const list = await db.select()
      .from(gameEvents)
      .where(eq(gameEvents.gameId, gameId))
      .orderBy(desc(gameEvents.createdAt))
      .limit(limitCount);

    return list.map(e => ({
      ...e,
      createdAt: e.createdAt ? e.createdAt : new Date()
    }));
  } catch (error) {
    console.error("Database error in getRecentGameEvents:", error);
    return [];
  }
}

// 17. Mark matching ranks and jokers as isWild: true inside DB
export async function markGameWildCards(gameId: number, wildRank: string): Promise<void> {
  try {
    await db.update(cards)
      .set({ isWild: true })
      .where(and(
        eq(cards.gameId, gameId),
        sql`rank = ${wildRank} OR rank = 'joker' OR suit = 'joker'`
      ));
  } catch (error) {
    console.error("Database error in markGameWildCards:", error);
  }
}
