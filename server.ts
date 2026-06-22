import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import path from "path";
import { createServer as createViteServer } from "vite";
import * as dotenv from "dotenv";

// Import DB and configurations
dotenv.config();
import { db } from "./src/db/index.ts";
import { eq, and, desc } from "drizzle-orm";
import { wildCardClaims, playerHands, players, cards, users, roundScores, wildCardApprovals, gameEvents } from "./src/db/schema.ts";

import { getOrCreateUser } from "./src/db/users.ts";
import {
  createGame,
  getGameByCode,
  getGameById,
  addPlayer,
  getGamePlayers,
  setupGameDeck,
  getGameCards,
  drawCardFromDeck,
  drawCardFromDiscard,
  discardCard,
  createWildCardClaim,
  getActiveClaim,
  processWildCardClaim,
  saveGameEvent,
  getRecentGameEvents,
  updateGame,
  markGameWildCards
} from "./src/db/game-queries.ts";
import { validateDeclareGroups, getCardScoreValue, calculateDetailedScoreBreakdown } from "./src/utils/game-rules.ts";
import { CardType, PlayerType, GameType } from "./src/types.ts";

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json());

  // Direct backend REST API Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", time: new Date().toISOString() });
  });



  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Helper to package the current game state safely according to player visibility rules
  async function computeAndBroadcastGameState(gameId: number, targetPlayerSocketId?: string) {
    try {
      const gameRaw = await getGameById(gameId);
      if (!gameRaw) return;

      const players = await getGamePlayers(gameId);
      const allCards = await getGameCards(gameId);
      const activeClaim = await getActiveClaim(gameId);
      const recentEvents = await getRecentGameEvents(gameId, 15);
      
      const rScores = await db.select().from(roundScores).where(eq(roundScores.gameId, gameId));

      // We broadcast to individual connected players or all in the room
      const roomName = `game_${gameId}`;
      // Support room membership OR gameId context tag on socket for absolute broadcast delivery
      const allSockets = Array.from(io.sockets.sockets.values());
      const socketsInRoom = allSockets.filter(s => {
        return (s as any).gameId === gameId || s.rooms.has(roomName);
      });

      for (const s of socketsInRoom) {
        // If target was set, skip others
        if (targetPlayerSocketId && s.id !== targetPlayerSocketId) {
          continue;
        }

        const socketUserId = (s as any).userId;
        const viewerPlayer = players.find(p => p.userId === socketUserId);
        const viewerId = viewerPlayer ? viewerPlayer.id : null;

        // Find the wildcard slot card to determine who the claimant was (the owner)
        const wcCard = allCards.find(c => c.location === 'wildcard_slot');
        const isWildcardClaimant = wcCard ? wcCard.ownerPlayerId === viewerId : false;

        // Apply Card Visibility Safeguards:
        // 1. Normal hand cards are visible ONLY to their owner.
        // 2. Secret Wild Cards (isHiddenWild) are visible ONLY to their owner.
        // 3. Deck cards are completely hidden.
        // 4. Exposed/discard/declared groups are public.
        // 5. Four-card verification during live claim is public ONLY to claimant & designated next verifier.
        const scrubbedCards = allCards.map(c => {
          const cardCopy = { ...c };

          // Strip `isWild` flag if viewer is NOT the claimant (and round isn't finished)
          if (gameRaw.status !== 'finished' && gameRaw.status !== 'round_finished') {
            if (!isWildcardClaimant) {
              cardCopy.isWild = false;
            }
          }

          // Discard or declared are fully visible to everyone
          if (cardCopy.location === 'discard' || cardCopy.location === 'declared') {
            return cardCopy;
          }

          // Wildcard slot card is completely hidden from everyone except its owner (the claimant),
          // until the round is over.
          if (cardCopy.location === 'wildcard_slot') {
            if (gameRaw.status === 'finished' || gameRaw.status === 'round_finished') {
              return cardCopy; // fully revealed
            }
            if (cardCopy.ownerPlayerId === viewerId) {
              return cardCopy; // revealed to claimant
            }
            return {
              ...cardCopy,
              suit: 'hidden',
              rank: 'hidden'
            };
          }

          // If the game or round is ended, fully reveal EVERYTHING!
          if (gameRaw.status === 'finished' || gameRaw.status === 'round_finished') {
            return cardCopy;
          }

          // Deck cards are completely masked (never leak rank/suit)
          if (cardCopy.location === 'deck') {
            return {
              ...cardCopy,
              suit: 'hidden',
              rank: 'hidden'
            };
          }

          // Hand cards
          if (cardCopy.location === 'hand') {
            // Visible to the card owner
            if (viewerId === cardCopy.ownerPlayerId) {
              return cardCopy;
            }

            // Verify if this card is currently being verified as part of an active claim
            // 4 hand cards are visible to claimant and verifier for verification
            if (activeClaim && activeClaim.status === 'pending') {
              const parsedIds = typeof activeClaim.cardIds === 'string' ? JSON.parse(activeClaim.cardIds) : activeClaim.cardIds;
              const handIds = Array.isArray(parsedIds) ? parsedIds : (parsedIds?.hand || []);
              const belongsToClaim = handIds.includes(cardCopy.id);
              const isClaimant = viewerId === activeClaim.claimantPlayerId;
              const isVerifier = viewerId === activeClaim.verifierPlayerId;

              if (belongsToClaim && (isClaimant || isVerifier)) {
                return cardCopy;
              }
            }

            // Otherwise, mask the card
            return {
              ...cardCopy,
              suit: cardCopy.isHiddenWild ? 'wildcard_placeholder' : 'hidden',
              rank: cardCopy.isHiddenWild ? 'Hidden Wild Card' : 'hidden'
            };
          }

          return cardCopy;
        });

        const gameCopy = { ...gameRaw };
        
        // Mask the global wildcard rank from non-claimants until the round ends
        if (gameRaw.status !== 'finished' && gameRaw.status !== 'round_finished') {
          if (!isWildcardClaimant) {
            gameCopy.wildCardRank = null;
            gameCopy.wildCardSuit = null;
          }
        }

        if (activeClaim && activeClaim.status === 'pending') {
          const isClaimant = viewerId === activeClaim.claimantPlayerId;
          if (isClaimant) {
            const parts = activeClaim.cardRank ? activeClaim.cardRank.split(':') : [];
            if (parts.length === 2) {
              gameCopy.wildCardRank = parts[0];
              gameCopy.wildCardSuit = parts[1];
            }
          }
        }

        // Scrub activeClaim: verifier gets cardIds (to see 4 cards) but NOT the wild card rank
        // Other players get nothing
        let scrubbedClaim = activeClaim;
        if (activeClaim && activeClaim.status === 'pending') {
          const isClaimant = viewerId === activeClaim.claimantPlayerId;
          const isVerifier = viewerId === activeClaim.verifierPlayerId;
          if (isVerifier) {
            // Verifier can see the 4 hand cards but NOT the wild card rank
            scrubbedClaim = { ...activeClaim, cardRank: 'hidden' };
          } else if (!isClaimant) {
            // Everyone else sees nothing
            scrubbedClaim = { ...activeClaim, cardIds: null, cardRank: 'hidden' };
          }
        }

        s.emit("gameState", {
          game: gameCopy,
          players,
          cards: scrubbedCards,
          activeClaim: scrubbedClaim,
          recentEvents,
          roundScores: rScores,
          viewerPlayerId: viewerId
        });
      }
    } catch (e) {
      console.error("Error broadcasting state for game:", gameId, e);
    }
  }

  // Active claim timers map to automatically expire pending validations in 30s
  const claimTimers: Record<number, NodeJS.Timeout> = {};

  // Store in-memory rooms' voice states
  const roomVoiceStates: Record<number, Record<number, { muted: boolean; speaking: boolean; socketId: string; username: string }>> = {};

  // Socket.IO Connection Handler
  io.on("connection", (socket: Socket) => {
    console.log("A user connected:", socket.id);

    // Join Lobbys & Verify credentials
    socket.on("joinLobby", async (data: { mobile: string; gameCode: string; username: string }, callback) => {
      try {
        const { mobile, gameCode, username } = data;
        if (!mobile || !username) {
          return callback({ error: "Mobile number and Name are required to join." });
        }

        const uid = mobile;

        // Attach authentication details to socket object for reconnection security
        (socket as any).userId = uid;
        (socket as any).username = username;

        // 2. Upsert user in database
        const user = await getOrCreateUser(uid, mobile, username);

        // 3. Search and allocate game
        const game = await getGameByCode(gameCode);
        if (!game) {
          return callback({ error: "Game code not found. Please review the characters or create a new lobby." });
        }

        if (game.status === 'finished') {
          return callback({ error: "This card game lobby has already concluded." });
        }

        // 4. Add player
        const player = await addPlayer(game.id, uid, username);

        // 5. Join socket room
        const roomName = `game_${game.id}`;
        socket.join(roomName);

        // Track gameId on socket
        (socket as any).gameId = game.id;
        (socket as any).playerId = player.id;

        await saveGameEvent(game.id, player.id, 'join', { username });

        // Acknowledge connection
        callback({ success: true, playerId: player.id, gameId: game.id });

        // Synchronize updated state to all connected players
        await computeAndBroadcastGameState(game.id);

      } catch (e: any) {
        console.error("Error joining lobby:", e);
        callback({ error: e.message || "Failed to join lobby." });
      }
    });

    // Create a new lobby (Host action)
    socket.on("createLobby", async (data: { mobile: string; username: string }, callback) => {
      try {
        const { mobile, username } = data;
        if (!mobile || !username) {
          return callback({ error: "Mobile number and Name are required to create a lobby." });
        }

        const uid = mobile;

        await getOrCreateUser(uid, mobile, username);

        // Create game
        const game = await createGame();
        callback({ success: true, gameCode: game.code });
      } catch (e: any) {
        console.error("Error creating lobby:", e);
        callback({ error: e.message || "Failed to create lobby." });
      }
    });

    // Start Game (Goes to Toss State)
    socket.on("startGame", async (data: any, callback: Function) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      if (!gId || !pId) return callback({ error: "Game session context missing." });

      try {
        const game = await getGameById(gId);
        if (!game) return callback({ error: "Game not found." });

        if (game.status !== 'waiting') {
          return callback({ error: "Game is already in progress or completed." });
        }

        const players = await getGamePlayers(gId);
        if (players.length < 2) {
          return callback({ error: "Indian Dummy Set requires at least 2 players to start." });
        }

        const host = players.find(p => p.turnOrder === 0);
        if (!host || host.id !== pId) {
          return callback({ error: "Only the lobby host can start the game." });
        }

        // Shuffles 2-decks for the toss selection
        await setupGameDeck(gId);

        await updateGame(gId, {
          status: 'toss', // enter toss phase
          wildCardSuit: null,
          wildCardRank: null,
          roundNumber: 1
        });

        await saveGameEvent(gId, pId, 'game_start', {
          playersCount: players.length,
          toss: true
        });

        callback({ success: true });
        await computeAndBroadcastGameState(gId);

      } catch (e: any) {
        console.error("Error starting game:", e);
        callback({ error: e.message || "Failed to start server-authoritative game." });
      }
    });

    // Toss Phase: Pick a Card
    socket.on("tossPickCard", async (data: { cardId: number }, callback) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      if (!gId || !pId) return callback({ error: "Game session context missing." });

      try {
        const game = await getGameById(gId);
        if (!game || game.status !== 'toss') {
          return callback({ error: "Game is not in toss phase." });
        }

        // Check if player already picked
        const myTossCard = await db.select().from(cards).where(and(eq(cards.gameId, gId), eq(cards.ownerPlayerId, pId), eq(cards.location, 'toss')));
        if (myTossCard.length > 0) {
          return callback({ error: "You already picked a toss card." });
        }

        // Verify card exists in deck
        const [selectedCard] = await db.select()
          .from(cards)
          .where(and(eq(cards.id, data.cardId), eq(cards.gameId, gId), eq(cards.location, 'deck')));

        if (!selectedCard) {
          return callback({ error: "Selected card is not available." });
        }

        // Assign to player as toss
        await db.update(cards)
          .set({ location: 'toss', ownerPlayerId: pId })
          .where(eq(cards.id, selectedCard.id));

        const players = await getGamePlayers(gId);
        const activePlayers = players.filter(p => p.isOnline && !p.isEliminated);
        
        // Count toss cards
        const allTossCards = await db.select().from(cards).where(and(eq(cards.gameId, gId), eq(cards.location, 'toss')));
        
        if (allTossCards.length === activePlayers.length) {
          // All have picked. Evaluate lowest card. Rank weights: A=1, 2=2... K=13. Joker=14.
          const rankWeight = (r: string) => {
            if (r === 'A') return 1;
            if (r === 'J') return 11;
            if (r === 'Q') return 12;
            if (r === 'K') return 13;
            if (r === 'joker') return 14;
            return parseInt(r) || 15;
          };

          let lowestCard = allTossCards[0];
          let lowestWeight = rankWeight(lowestCard.rank);

          for (let i = 1; i < allTossCards.length; i++) {
            const w = rankWeight(allTossCards[i].rank);
            if (w < lowestWeight) {
              lowestWeight = w;
              lowestCard = allTossCards[i];
            }
          }

          const dealerId = lowestCard.ownerPlayerId!;

          // Wait a brief moment to broadcast the picks before transitioning, but server is authoritative so just transition
          await updateGame(gId, {
            status: 'playing',
            dealerPlayerId: dealerId,
            currentTurnPlayerId: dealerId
          });

          // Reshuffle and deal exactly 13 cards to everyone
          await setupGameDeck(gId);
          for (const p of activePlayers) {
            for (let i = 0; i < 13; i++) {
              await drawCardFromDeck(gId, p.id);
            }
          }

          // Open discard
          const openCard = await drawCardFromDeck(gId, dealerId);
          await discardCard(gId, dealerId, openCard.id);

          await saveGameEvent(gId, dealerId, 'toss_completed', { dealerId, lowestRank: lowestCard.rank });
        }

        callback({ success: true });
        await computeAndBroadcastGameState(gId);

      } catch (e: any) {
        console.error("Error in tossPickCard:", e);
        callback({ error: e.message || "Failed to pick toss card." });
      }
    });

    // Deal Next Round
    socket.on("dealNextRound", async (data: any, callback) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      if (!gId || !pId) return callback({ error: "Game session context missing." });

      try {
        const game = await getGameById(gId);
        if (!game || game.status !== 'round_finished') {
          return callback({ error: "Game is not waiting for next round." });
        }

        // Must be the dealer (we move dealer upon round end)
        if (game.dealerPlayerId !== pId) {
          return callback({ error: "You are not the designated dealer for the next round." });
        }

        const players = await getGamePlayers(gId);
        const activePlayers = players.filter(p => !p.isEliminated);

        if (activePlayers.length < 2) {
          return callback({ error: "Not enough active players to deal next round." });
        }

        // Shuffles 2-decks
        await setupGameDeck(gId);

        // Reset player hand stats
        for (const p of activePlayers) {
           await db.update(playerHands).set({ 
             score: 0, 
             hasDeclared: false, 
             hasDropped: false,
             updatedAt: new Date().toISOString()
           }).where(eq(playerHands.playerId, p.id));
        }

        // The next turn should go to the player AFTER the dealer
        let nextTurnPlayerId = pId;
        const dealerIdx = players.findIndex(p => p.id === pId);
        for (let offset = 1; offset <= players.length; offset++) {
          const candidate = players[(dealerIdx + offset) % players.length];
          if (candidate.isOnline && !candidate.isEliminated) {
             nextTurnPlayerId = candidate.id;
             break;
          }
        }

        await updateGame(gId, {
          status: 'playing',
          wildCardSuit: null,
          wildCardRank: null,
          currentTurnPlayerId: nextTurnPlayerId,
          roundNumber: game.roundNumber + 1,
          winnerPlayerId: null
        });

        for (const p of activePlayers) {
          for (let i = 0; i < 13; i++) {
            await drawCardFromDeck(gId, p.id);
          }
        }

        const openCard = await drawCardFromDeck(gId, pId);
        await discardCard(gId, pId, openCard.id);

        callback({ success: true });
        await computeAndBroadcastGameState(gId);
      } catch (e: any) {
        console.error("Error dealing next round:", e);
        callback({ error: e.message || "Failed to deal." });
      }
    });

    // Draw card event
    socket.on("drawCard", async (data: { source: 'deck' | 'discard' }, callback) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      if (!gId || !pId) return callback({ error: "Game session context missing." });

      try {
        const game = await getGameById(gId);
        if (!game || game.status !== 'playing') {
          return callback({ error: "Game is not active." });
        }

        if (game.currentTurnPlayerId !== pId) {
          return callback({ error: "It is not your turn to draw cards." });
        }

        // Verify player hasn't already drawn this turn and is waiting to discard
        // (A player hand has 13 cards usually; if they have 14 cards, they have already drawn!)
        const hand = await getGameCards(gId);
        const myHand = hand.filter(c => c.ownerPlayerId === pId && c.location === 'hand');
        if (myHand.length > 13) {
          return callback({ error: "You have already drawn a card. You must discard a card before drawing again." });
        }

        let drawn: CardType;
        if (data.source === 'deck') {
          drawn = await drawCardFromDeck(gId, pId);
        } else {
          drawn = await drawCardFromDiscard(gId, pId);
        }

        await saveGameEvent(gId, pId, 'draw', { source: data.source, cardId: drawn.id });

        callback({ success: true, card: drawn });
        await computeAndBroadcastGameState(gId);

      } catch (e: any) {
        console.error("Error drawing card:", e);
        callback({ error: e.message || "Failed to draw card." });
      }
    });

    // Discard card event
    socket.on("discardCard", async (data: { cardId: number }, callback) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      if (!gId || !pId) return callback({ error: "Game session context missing." });

      try {
        const game = await getGameById(gId);
        if (!game || game.status !== 'playing') {
          return callback({ error: "Game is not active." });
        }

        if (game.currentTurnPlayerId !== pId) {
          return callback({ error: "It is not your turn to discard cards." });
        }

        // Verify player has drawn (needs to compile 14 cards in hand to discard down to 13)
        const hand = await getGameCards(gId);
        const myHand = hand.filter(c => c.ownerPlayerId === pId && c.location === 'hand');
        if (myHand.length < 14) {
          return callback({ error: "You must draw a card from the deck or discard piles before discarding." });
        }

        // Perform discard
        await discardCard(gId, pId, data.cardId);

        // Switch turn to the next player
        const players = await getGamePlayers(gId);
        const activePlayers = players.filter(p => p.isOnline);
        const meIdx = players.findIndex(p => p.id === pId);
        
        // Find next player index
        let nextIdx = (meIdx + 1) % players.length;
        // In case next player is offline, normally we skip or keep turn. Let's pass turn to the next in order.
        const nextPlayer = players[nextIdx];

        await updateGame(gId, {
          currentTurnPlayerId: nextPlayer.id
        });

        await saveGameEvent(gId, pId, 'discard', { cardId: data.cardId });

        callback({ success: true });
        await computeAndBroadcastGameState(gId);

      } catch (e: any) {
        console.error("Error discarding card:", e);
        callback({ error: e.message || "Failed to discard card." });
      }
    });

    // Drop Round Mechanic (20 pts before draw, 40 pts after)
    socket.on("dropRound", async (data: any, callback: any) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      if (!gId || !pId) return callback({ error: "Game session context missing." });

      try {
        const game = await getGameById(gId);
        if (!game || game.status !== 'playing') {
          return callback({ error: "Game is not active." });
        }

        if (game.currentTurnPlayerId !== pId) {
          return callback({ error: "You can only drop on your turn." });
        }

        // Determine penalty type
        const allCards = await getGameCards(gId);
        const myHand = allCards.filter(c => c.ownerPlayerId === pId && c.location === 'hand');
        
        const gameEventsList = await db.select().from(gameEvents).where(and(eq(gameEvents.gameId, gId), eq(gameEvents.playerId, pId)));
        const hasDiscarded = gameEventsList.some(e => e.eventType === 'discard');

        let penalty = 20;
        let dropType = 'initial_drop';
        
        // If they have drawn (hand > 13) or have ever discarded this round
        if (myHand.length > 13 || hasDiscarded) {
          penalty = 40;
          dropType = 'middle_drop';
        }

        // Apply drop status to PlayerHand
        await db.update(playerHands)
          .set({ score: penalty, hasDropped: true, updatedAt: new Date().toISOString() })
          .where(eq(playerHands.playerId, pId));

        await saveGameEvent(gId, pId, dropType, { penalty });

        // Calculate next turn player
        const playersList = await getGamePlayers(gId);
        const droppedIds = new Set(playersList.filter(p => p.hasDropped).map(p => p.id));
        
        const activeNonDropped = playersList.filter(p => !p.isEliminated && !droppedIds.has(p.id));

        if (activeNonDropped.length === 1) {
          // Only one player left! They win automatically.
          const winner = activeNonDropped[0];
          
          await db.update(playerHands)
            .set({ score: 0, hasDeclared: true, updatedAt: new Date().toISOString() })
            .where(eq(playerHands.playerId, winner.id));
          
          await updateGame(gId, { winnerPlayerId: winner.id });

          // Finalize Round
          const updatedPlayersList = await getGamePlayers(gId);
          for (const p of updatedPlayersList) {
            if (p.isEliminated) continue;

            const finalScore = p.hasDropped ? p.score : p.score;
            const newNetScore = p.netScore + finalScore;
            const isEliminated = newNetScore >= game.maxScore;

            await db.update(players).set({ netScore: newNetScore, isEliminated }).where(eq(players.id, p.id));
            
            await db.insert(roundScores).values({
              gameId: gId,
              roundNumber: game.roundNumber,
              playerId: p.id,
              currentPoints: finalScore,
              netScoreAfter: newNetScore,
              isWinner: p.id === winner.id
            });
          }

          // Determine next dealer
          const latestPlayers = await getGamePlayers(gId);
          const activeList = latestPlayers.filter(pl => pl.isOnline && !pl.isEliminated);
          
          let nextDealerId = winner.id;
          if (activeList.length > 0) {
             let currentIndex = latestPlayers.findIndex(pl => pl.id === game.dealerPlayerId);
             for(let offset = 1; offset <= latestPlayers.length; offset++) {
                const candidate = latestPlayers[(currentIndex + offset) % latestPlayers.length];
                if (candidate.isOnline && !candidate.isEliminated) {
                  nextDealerId = candidate.id;
                  break;
                }
             }
          }

          if (activeList.length <= 1) {
            await updateGame(gId, { status: 'finished', winnerPlayerId: activeList[0]?.id || winner.id });
          } else {
            await updateGame(gId, { status: 'round_finished', dealerPlayerId: nextDealerId });
          }

          callback({ success: true, penalty, type: dropType });
        } else {
          // Find next player
          const currentActiveIdx = playersList.findIndex(p => p.id === game.currentTurnPlayerId);
          let nextTurnPlayerId = game.currentTurnPlayerId;
          
          for (let offset = 1; offset <= playersList.length; offset++) {
            const candidate = playersList[(currentActiveIdx + offset) % playersList.length];
            if (candidate.isOnline && !candidate.isEliminated && !droppedIds.has(candidate.id)) {
               nextTurnPlayerId = candidate.id;
               break;
            }
          }

          await updateGame(gId, { currentTurnPlayerId: nextTurnPlayerId });
          callback({ success: true, penalty, type: dropType });
        }

        await computeAndBroadcastGameState(gId);

      } catch (e: any) {
        console.error("Error dropping round:", e);
        callback({ error: e.message || "Failed to drop." });
      }
    });

    // Step 1: Request Wild Card Claim (Must have 4-of-a-kind, AND select a deck card)
    socket.on("requestWildCardClaim", async (data: { cardIds: number[], deckCardId: number }, callback) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      if (!gId || !pId) return callback({ error: "Game session context missing." });

      try {
        const game = await getGameById(gId);
        if (!game || game.status !== 'playing') {
          return callback({ error: "Game is not active." });
        }

        if (game.wildCardRank) {
          return callback({ error: "The game already has a wild card selected." });
        }

        // Active claim?
        const existingClaim = await getActiveClaim(gId);
        if (existingClaim) {
          return callback({ error: "Another wild card claim is currently being processed." });
        }

        // Validate cards
        if (!data.cardIds || data.cardIds.length !== 4) {
          return callback({ error: "Must submit exactly 4 cards." });
        }
        if (!data.deckCardId) {
          return callback({ error: "Must select a deck card." });
        }

        const cardsList = await db.select().from(cards).where(
          and(
            eq(cards.gameId, gId),
            eq(cards.ownerPlayerId, pId),
            eq(cards.location, 'hand')
          )
        );

        // Player must have exactly 13 cards (can't claim when having 14)
        if (cardsList.length !== 13) {
          return callback({ error: "You must have exactly 13 cards in your hand to claim a wild card." });
        }

        const claimCards = cardsList.filter(c => data.cardIds.includes(c.id));
        if (claimCards.length !== 4) {
          return callback({ error: "Invalid cards submitted." });
        }

        const firstRank = claimCards[0].rank;
        if (!claimCards.every(c => c.rank === firstRank)) {
          return callback({ error: "All 4 cards must have the exact same rank." });
        }

        // Determine next player (verifier)
        const playersList = await getGamePlayers(gId);
        const meIdx = playersList.findIndex(p => p.id === pId);
        let nextIdx = (meIdx + 1) % playersList.length;
        const nextPlayer = playersList[nextIdx];

        // Create the wild card selection claim with the JSON payload
        const activeClaim = await createWildCardClaim(
          gId,
          pId,
          nextPlayer.id,
          firstRank, 
          { hand: data.cardIds, deck: data.deckCardId }
        );

        await saveGameEvent(gId, pId, 'request_wild_card', {
          rank: firstRank,
          cardIds: data.cardIds,
          username: (socket as any).username || "A player"
        });

        callback({ success: true, activeClaim });
        await computeAndBroadcastGameState(gId);

      } catch (e: any) {
        console.error("Error requesting wildcard claim:", e);
        callback({ error: e.message || "Failed to submit wildcard claim." });
      }
    });

    // Approve the pending wildcard request
    socket.on("approveWildCard", async (data: { claimId: number }, callback) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      if (!gId || !pId) return callback({ error: "Game session context missing." });

      try {
        const approved = await processWildCardClaim(data.claimId, pId, true);
        if (approved) {
          callback({ success: true });
          await computeAndBroadcastGameState(gId);
        } else {
          callback({ error: "Failed to approve wildcard claim." });
        }
      } catch (e: any) {
        console.error("Error approving claim:", e);
        callback({ error: e.message || "Failed to approve claim." });
      }
    });

    // Reject the pending wildcard request
    socket.on("rejectWildCard", async (data: { claimId: number }, callback) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      if (!gId || !pId) return callback({ error: "Game session context missing." });

      try {
        await processWildCardClaim(data.claimId, pId, false);
        callback({ success: true });
        await computeAndBroadcastGameState(gId);
      } catch (e: any) {
        console.error("Error rejecting claim:", e);
        callback({ error: e.message || "Failed to reject claim." });
      }
    });

    // Declare Hand (End Game or Submit Penalty)
    socket.on("declareGame", async (data: { mels: number[][]; finishCardId?: number }, callback) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      if (!gId || !pId) return callback({ error: "Game session context missing." });

      try {
        const game = await getGameById(gId);
        if (!game || game.status !== 'playing') {
          return callback({ error: "Game is not active." });
        }

        const { mels, finishCardId } = data; // Array of arrays of card IDs
        if (!mels || mels.length === 0) {
          return callback({ error: "Please group your cards before declaring." });
        }

        const allCards = await getGameCards(gId);
        const myHand = allCards.filter(c => c.ownerPlayerId === pId && c.location === 'hand');
        const gamePlayersList = await getGamePlayers(gId);

        // 1. IS THIS THE WINNING DECLARE? (i.e. No winner declared yet)
        if (game.winnerPlayerId === null) {
          // Identify the finish card if there are 14 cards
          let actualFinishCardId = finishCardId;
          if (!actualFinishCardId && myHand.length >= 14) {
            const groupOfOne = mels.find(grp => grp.length === 1);
            if (groupOfOne) actualFinishCardId = groupOfOne[0];
            else {
              const lastGroup = mels[mels.length - 1];
              if (lastGroup && lastGroup.length > 0) actualFinishCardId = lastGroup[lastGroup.length - 1];
            }
          }

          let handToValidate = myHand;
          let melsToValidate = mels;

          if (actualFinishCardId) {
            handToValidate = myHand.filter(c => c.id !== actualFinishCardId);
            melsToValidate = mels.map(grp => grp.filter(id => id !== actualFinishCardId)).filter(grp => grp.length > 0);
          }

          const melsFlat = melsToValidate.flat();
          if (melsFlat.length !== handToValidate.length) {
            return callback({ error: "The cards declared do not match your hand." });
          }

          // Compute joker substitutions
          const rankCounts: Record<string, number> = {};
          for (const card of handToValidate) {
            if (card.rank !== 'joker' && card.suit !== 'joker') rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
          }
          const fourOfAKindRanks = Object.keys(rankCounts).filter(r => rankCounts[r] >= 4);

          const groupedCards: CardType[][] = melsToValidate.map(grp => grp.map(id => {
            const cardObj = handToValidate.find(c => c.id === id);
            if (!cardObj) throw new Error("Invalid card");
            const isPaperJoker = cardObj.isWild || cardObj.isHiddenWild || cardObj.rank === game.wildCardRank || cardObj.suit === 'joker' || cardObj.rank === 'joker' || fourOfAKindRanks.includes(cardObj.rank);
            return { ...cardObj, isWild: isPaperJoker };
          }));

          const validation = validateDeclareGroups(groupedCards);

          if (!validation.isValid) {
            // Wrong declare! Apply 80 points penalty, but game continues!
            await saveGameEvent(gId, pId, 'invalid_declare', { error: validation.error || "Wrong declare" });
            await db.update(playerHands).set({ score: 80, hasDeclared: true, updatedAt: new Date().toISOString() }).where(eq(playerHands.playerId, pId));
            
            // Advance turn to next player
            const droppedIds = new Set(gamePlayersList.filter(p => p.hasDropped).map(p => p.id));
            const currentActiveIdx = gamePlayersList.findIndex(p => p.id === game.currentTurnPlayerId);
            let nextTurnPlayerId = game.currentTurnPlayerId;
            for (let offset = 1; offset <= gamePlayersList.length; offset++) {
              const candidate = gamePlayersList[(currentActiveIdx + offset) % gamePlayersList.length];
              if (candidate.isOnline && !candidate.isEliminated && !droppedIds.has(candidate.id) && candidate.id !== pId) {
                 nextTurnPlayerId = candidate.id;
                 break;
              }
            }
            await updateGame(gId, { currentTurnPlayerId: nextTurnPlayerId });
            
            callback({ isValid: false, penalty: true, error: validation.error || "Incorrect declare! An 80 point penalty has been applied." });
            await computeAndBroadcastGameState(gId);
            return;
          }

          // Valid Declare! Mark them as winner, but DO NOT end round yet!
          if (actualFinishCardId) {
            const discardPile = await db.select().from(cards).where(and(eq(cards.gameId, gId), eq(cards.location, 'discard'))).orderBy(desc(cards.position));
            const nextPos = discardPile.length > 0 ? discardPile[0].position + 1 : 0;
            await db.update(cards).set({ location: 'discard', position: nextPos, ownerPlayerId: null }).where(eq(cards.id, actualFinishCardId));
          }

          await db.update(playerHands).set({ score: 0, hasDeclared: true, updatedAt: new Date().toISOString() }).where(eq(playerHands.playerId, pId));
          await updateGame(gId, { winnerPlayerId: pId });
          await saveGameEvent(gId, pId, 'finish_round', { winnerPlayerId: pId, score: 0 });
          
          callback({ isValid: true });
          // Fall through to check if everyone is done (if it's a 2 player game and other dropped, etc)
        } else {
          // 2. SUBSEQUENT DECLARE (Minimizing Penalty Points)
          // We don't validate groups for a win, we just calculate the penalty score!
          const rankCounts: Record<string, number> = {};
          for (const card of myHand) {
            if (card.rank !== 'joker' && card.suit !== 'joker') rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
          }
          const fourOfAKindRanks = Object.keys(rankCounts).filter(r => rankCounts[r] >= 4);

          const groupedCards: CardType[][] = mels.map(grp => grp.map(id => {
            const cardObj = myHand.find(c => c.id === id);
            if (!cardObj) throw new Error("Invalid card");
            const isPaperJoker = cardObj.isWild || cardObj.isHiddenWild || cardObj.rank === game.wildCardRank || cardObj.suit === 'joker' || cardObj.rank === 'joker' || fourOfAKindRanks.includes(cardObj.rank);
            return { ...cardObj, isWild: isPaperJoker };
          }));

          const breakdown = calculateDetailedScoreBreakdown(groupedCards, game.wildCardRank, game.wildCardSuit);
          const penalty = Math.min(breakdown.penaltyPoints, 80);

          // Update their penalty and status
          await db.update(playerHands).set({ score: penalty, hasDeclared: true, updatedAt: new Date().toISOString() }).where(eq(playerHands.playerId, pId));
          
          callback({ isValid: true });
        }

        // 3. Check if ALL active players have declared. If so, execute round ending logic!
        const updatedPlayersList = await getGamePlayers(gId);
        const allActiveDeclared = updatedPlayersList.every(p => p.isEliminated || p.hasDropped || p.hasDeclared);

        if (allActiveDeclared) {
          // Finalize the round! Update net scores, round_scores table, and check eliminations
          let activePlayersRemainingCount = 0;
          let lastStandingId = updatedPlayersList[0].id;
          const winnerId = game.winnerPlayerId || pId;

          for (const p of updatedPlayersList) {
            if (p.isEliminated) continue;

            const finalScore = p.hasDropped ? p.score : p.score;
            const newNetScore = p.netScore + finalScore;
            const isEliminated = newNetScore >= game.maxScore;

            await db.update(players).set({ netScore: newNetScore, isEliminated }).where(eq(players.id, p.id));
            
            await db.insert(roundScores).values({
              gameId: gId,
              roundNumber: game.roundNumber,
              playerId: p.id,
              currentPoints: finalScore,
              netScoreAfter: newNetScore,
              isWinner: p.id === winnerId
            });

            if (!isEliminated) {
              activePlayersRemainingCount++;
              lastStandingId = p.id;
            }
          }

          // Determine next dealer
          const latestPlayers = await getGamePlayers(gId);
          const activeList = latestPlayers.filter(pl => pl.isOnline && !pl.isEliminated);
          
          let nextDealerId = winnerId;
          if (activeList.length > 0) {
             let currentIndex = latestPlayers.findIndex(pl => pl.id === game.dealerPlayerId);
             for(let offset = 1; offset <= latestPlayers.length; offset++) {
                const candidate = latestPlayers[(currentIndex + offset) % latestPlayers.length];
                if (candidate.isOnline && !candidate.isEliminated) {
                  nextDealerId = candidate.id;
                  break;
                }
             }
          }

          if (activeList.length <= 1) {
            await updateGame(gId, { status: 'finished', winnerPlayerId: activeList[0]?.id || winnerId });
          } else {
            await updateGame(gId, { status: 'round_finished', dealerPlayerId: nextDealerId });
          }
        }

        await computeAndBroadcastGameState(gId);

      } catch (e: any) {
        console.error("Error declaring game:", e);
        callback({ error: e.message || "Failed to declare." });
      }
    });

    // Reconnection listener
    socket.on("reconnectPlayer", async (data: { mobile: string; gameId: number }, callback) => {
      try {
        const uid = data.mobile;

        const gamePlayers = await getGamePlayers(data.gameId);
        const me = gamePlayers.find(p => p.userId === uid);

        if (!me) {
          return callback({ error: "No matching player identity in this game." });
        }

        // Set player online
        await db.update(players)
          .set({ isOnline: true })
          .where(eq(players.id, me.id));

        // Join room
        const roomName = `game_${data.gameId}`;
        socket.join(roomName);

        (socket as any).gameId = data.gameId;
        (socket as any).playerId = me.id;
        (socket as any).userId = uid;
        (socket as any).username = me.username;

        await saveGameEvent(data.gameId, me.id, 'reconnect', { username: me.username });

        callback({ success: true, playerId: me.id });
        await computeAndBroadcastGameState(data.gameId);
      } catch (e: any) {
        console.error("Error re-connecting:", e);
        callback({ error: e.message || "Failed to re-authenticate." });
      }
    });

    // Sync card groupings during gameplay for hand auditing
    socket.on("syncGroups", async (data: { groups: number[][] }) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      if (!gId || !pId) return;

      try {
        const { groups } = data;
        if (!groups || !Array.isArray(groups)) return;

        // Reset previous groupings for this player hand
        await db.update(cards)
          .set({ declaredGroupId: null })
          .where(and(eq(cards.gameId, gId), eq(cards.ownerPlayerId, pId)));

        // Write new groupings
        for (let idx = 0; idx < groups.length; idx++) {
          const group = groups[idx];
          if (!group || !Array.isArray(group) || group.length === 0) continue;

          for (const cid of group) {
            await db.update(cards)
              .set({ declaredGroupId: `g_${idx}` })
              .where(and(eq(cards.id, cid), eq(cards.ownerPlayerId, pId)));
          }
        }
      } catch (e) {
        console.error("Error syncing groups:", e);
      }
    });

    // --- WebRTC Voice Streaming & Signaling ---
    socket.on("voiceOffer", (data: { targetSocketId: string; offer: any; muted?: boolean }) => {
      io.to(data.targetSocketId).emit("voiceOffer", {
        senderSocketId: socket.id,
        offer: data.offer,
        senderUsername: (socket as any).username || "Unknown",
        muted: data.muted
      });
    });

    socket.on("voiceAnswer", (data: { targetSocketId: string; answer: any; muted?: boolean }) => {
      io.to(data.targetSocketId).emit("voiceAnswer", {
        senderSocketId: socket.id,
        answer: data.answer,
        muted: data.muted
      });
    });

    socket.on("voiceIceCandidate", (data: { targetSocketId: string; candidate: any }) => {
      io.to(data.targetSocketId).emit("voiceIceCandidate", {
        senderSocketId: socket.id,
        candidate: data.candidate
      });
    });

    socket.on("requestPeerConnections", () => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      const username = (socket as any).username || "Unknown";
      if (!gId) return;
      
      if (pId) {
        if (!roomVoiceStates[gId]) roomVoiceStates[gId] = {};
        roomVoiceStates[gId][pId] = {
          muted: true, // Safe default on enter
          speaking: false,
          socketId: socket.id,
          username
        };
      }

      const roomName = `game_${gId}`;
      socket.to(roomName).emit("newPeerConnected", {
        socketId: socket.id,
        username: (socket as any).username || "Unknown player"
      });

      // Distribute authority state to the joining peer, and refresh state for other rooms
      io.to(socket.id).emit("voiceRoomState", roomVoiceStates[gId] || {});
      socket.to(roomName).emit("voiceRoomState", roomVoiceStates[gId] || {});
    });

    socket.on("voiceSpeakingState", (data: { speaking: boolean }) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      const username = (socket as any).username || "Unknown";
      if (gId && pId) {
        if (!roomVoiceStates[gId]) roomVoiceStates[gId] = {};
        roomVoiceStates[gId][pId] = {
          muted: roomVoiceStates[gId][pId]?.muted ?? true,
          speaking: data.speaking,
          socketId: socket.id,
          username
        };
        io.to(`game_${gId}`).emit("voiceRoomState", roomVoiceStates[gId]);
      }
    });

    socket.on("voiceMuteState", (data: { muted: boolean }) => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      const username = (socket as any).username || "Unknown";
      if (gId && pId) {
        if (!roomVoiceStates[gId]) roomVoiceStates[gId] = {};
        roomVoiceStates[gId][pId] = {
          muted: data.muted,
          speaking: roomVoiceStates[gId][pId]?.speaking ?? false,
          socketId: socket.id,
          username
        };
        io.to(`game_${gId}`).emit("voiceRoomState", roomVoiceStates[gId]);
      }
    });

    // Disconnect handler
    socket.on("disconnect", async () => {
      const gId = (socket as any).gameId;
      const pId = (socket as any).playerId;
      
      if (gId && pId) {
        try {
          // Remove from voice room registry on disconnect
          if (roomVoiceStates[gId]) {
            delete roomVoiceStates[gId][pId];
            if (Object.keys(roomVoiceStates[gId]).length === 0) {
              delete roomVoiceStates[gId];
            } else {
              io.to(`game_${gId}`).emit("voiceRoomState", roomVoiceStates[gId]);
            }
          }

          // Mark offline ONLY if there are no other active socket connections for this playerId
          const activeSockets = Array.from(io.sockets.sockets.values());
          const hasOtherSocket = activeSockets.some(s => (s as any).playerId === pId && s.id !== socket.id);

          if (!hasOtherSocket) {
            await db.update(players)
              .set({ isOnline: false })
              .where(eq(players.id, pId));

            const userObj = (socket as any).username || "A player";
            await saveGameEvent(gId, pId, 'disconnect', { username: userObj });
          }

          await computeAndBroadcastGameState(gId);
        } catch (e) {
          console.error("Error marking player offline during disconnect:", e);
        }
      }
      console.log("Socket disconnected:", socket.id);
    });
  });

  // Setup Express + Vite Dev middleware or Static delivery
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Bind server exclusively to port 3000
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Indian Dummy Set backend online on port ${PORT}`);
  });
}

startServer();
