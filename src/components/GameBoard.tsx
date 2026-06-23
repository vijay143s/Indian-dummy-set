import React, { useState, useEffect, useRef } from 'react';
import { GameStateResponse, CardType, PlayerType } from '../types.ts';
import { CardVisual } from './CardVisual.tsx';
import { VoiceRoom, VideoPlayer } from './VoiceRoom.tsx';
import { 
  calculateDetailedScoreBreakdown,
  isValidPureSequence,
  isValidImpureSequence,
  isValidSet
} from '../utils/game-rules.ts';
import { 
  Timer, Crown, LogOut, CheckCircle2, UserCircle2, Swords, History, Clock, AlertCircle, Play, ArrowRight, Check, X, ShieldAlert,
  FolderLock, Archive, ListCollapse, Sparkles, Award, Menu, Trophy, Volume2, VolumeX
} from 'lucide-react';

interface GameBoardProps {
  gameState: GameStateResponse;
  myPlayerId: number | null;
  onEmit: (event: string, data?: any, callback?: (resp: any) => void) => void;
  onExit: () => void;
  socket?: any;
}

export const GameBoard: React.FC<GameBoardProps> = ({
  gameState,
  myPlayerId,
  onEmit,
  onExit,
  socket,
}) => {
  const { game, players, cards, activeClaim, recentEvents, viewerPlayerId, roundScores = [] } = gameState;

  // Local state for selecting cards in our hand
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([]);
  const [pendingWildcardClaimCards, setPendingWildcardClaimCards] = useState<number[]>([]);
  const [isLobbyOpen, setIsLobbyOpen] = useState(false);
  
  // Local card groupings (matrix of card IDs to let players arrange hands)
  const [localGroups, setLocalGroups] = useState<number[][]>([]);

  // Action messages/notifications feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);

  // Auto rotate screen attempt for mobile
  useEffect(() => {
    if (game.status === 'playing') {
      try {
        if (typeof screen !== 'undefined' && screen.orientation && (screen.orientation as any).lock) {
          (screen.orientation as any).lock('landscape').catch((e: any) => {
            console.log("Orientation lock not supported or blocked without fullscreen", e);
          });
        }
      } catch (e) {}
    }
  }, [game.status]);

  // Timer countdown for active claims
  const [claimTimeLeft, setClaimTimeLeft] = useState(30);

  // Blind wildcard selection interaction state
  const [isExpandingPile, setIsExpandingPile] = useState(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [hideRoundSummary, setHideRoundSummary] = useState(false);
  
  // Declaration confirmation state
  const [showDeclareConfirm, setShowDeclareConfirm] = useState(false);
  const [showDropConfirm, setShowDropConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [playerStreams, setPlayerStreams] = useState<Record<number, { stream: MediaStream | null; videoEnabled: boolean; speaking: boolean }>>({});
  const [isNotificationsMuted, setIsNotificationsMuted] = useState(false);

  // Load and reconcile player hand cards into groupings
  const myHandCards = cards.filter(c => c.ownerPlayerId === viewerPlayerId && c.location === 'hand');
  const discardHistoryCards = cards.filter(c => c.location === 'discard').sort((a, b) => a.position - b.position);
  const wildCardSlotCard = cards.find(c => c.location === 'wildcard_slot');

  const claimantPlayer = activeClaim ? players.find(p => p.id === activeClaim.claimantPlayerId) : null;
  const verifierPlayer = activeClaim ? players.find(p => p.id === activeClaim.verifierPlayerId) : null;

  // Play a simple beep
  const playTurnSound = () => {
    if (isNotificationsMuted) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioCtx = new AudioContextClass();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1); // A5
      
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
      console.log('Audio not supported or blocked', e);
    }
  };

  const prevTurnPlayerId = useRef<number | null>(null);

  useEffect(() => {
    if (game.status === 'playing' && game.currentTurnPlayerId !== prevTurnPlayerId.current) {
      if (game.currentTurnPlayerId === viewerPlayerId) {
        playTurnSound();
        
        // Trigger browser notification
        if (typeof Notification !== 'undefined') {
          if (Notification.permission === 'granted') {
            new Notification("Your Turn! 🃏", { body: "It's your turn to play in Indian Dummy Set!", icon: "/vite.svg" });
          } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
              if (permission === 'granted') {
                new Notification("Your Turn! 🃏", { body: "It's your turn to play in Indian Dummy Set!", icon: "/vite.svg" });
              }
            });
          }
        }
      }
      prevTurnPlayerId.current = game.currentTurnPlayerId;
    }
  }, [game.currentTurnPlayerId, game.status, viewerPlayerId]);

  useEffect(() => {
    let intervalId: number | undefined;
    const isMyTurnRightNow = game.currentTurnPlayerId === viewerPlayerId && game.winnerPlayerId === null;

    if (game.status === 'playing' && isMyTurnRightNow) {
      // Trigger initial vibration (if supported)
      if (typeof navigator !== 'undefined' && "vibrate" in navigator) {
        navigator.vibrate([100]);
      }
      
      // Set up recurring audio ping every 3 seconds
      intervalId = window.setInterval(() => {
        if (!isNotificationsMuted) {
          playTurnSound();
        }
        if (typeof navigator !== 'undefined' && "vibrate" in navigator) {
          navigator.vibrate([100]);
        }
      }, 3000);
    }

    return () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [game.currentTurnPlayerId, game.status, viewerPlayerId, game.winnerPlayerId, isNotificationsMuted]);

  useEffect(() => {
    // Graceously reconcile local groups with the current card list from the server
    const currentHandIds = myHandCards.map(c => c.id);

    // Reconstruct groups from server if localGroups is empty (e.g., initial load or refresh)
    let baseGroups = localGroups;
    if (baseGroups.length === 0 && currentHandIds.length > 0) {
      const serverGroupsMap: Record<string, number[]> = {};
      const actualNullGroup: number[] = [];

      myHandCards.forEach(c => {
        if (c.declaredGroupId) {
          if (!serverGroupsMap[c.declaredGroupId]) {
            serverGroupsMap[c.declaredGroupId] = [];
          }
          serverGroupsMap[c.declaredGroupId].push(c.id);
        } else {
          actualNullGroup.push(c.id);
        }
      });

      // Extract grouped arrays and sort them by group ID (e.g., g_0, g_1) to preserve order
      const sortedGroupKeys = Object.keys(serverGroupsMap).sort((a, b) => {
        const idA = parseInt(a.replace('g_', ''), 10) || 0;
        const idB = parseInt(b.replace('g_', ''), 10) || 0;
        return idA - idB;
      });

      const extractedGroups = sortedGroupKeys.map(key => serverGroupsMap[key]);
      
      if (extractedGroups.length > 0) {
        if (actualNullGroup.length > 0) {
          baseGroups = [...extractedGroups, actualNullGroup];
        } else {
          baseGroups = extractedGroups;
        }
      } else {
        baseGroups = [currentHandIds];
      }
    }

    // Filter out cards that are no longer in our hand
    const filteredExistingGroups = baseGroups
      .map(grp => grp.filter(id => currentHandIds.includes(id)))
      .filter(grp => grp.length > 0);

    // Identify cards we haven't grouped yet
    const groupedCardIds = filteredExistingGroups.flat();
    const ungroupedCardIds = currentHandIds.filter(id => !groupedCardIds.includes(id));

    if (ungroupedCardIds.length > 0) {
      // Put any newly drawn or ungrouped cards in a final or first group
      if (filteredExistingGroups.length === 0) {
        setLocalGroups([ungroupedCardIds]);
      } else {
        setLocalGroups([...filteredExistingGroups, ungroupedCardIds]);
      }
    } else {
      setLocalGroups(filteredExistingGroups);
    }
  }, [cards, viewerPlayerId]);

  // Handle active claim countdown timer
  useEffect(() => {
    if (activeClaim && activeClaim.status === 'pending') {
      const expires = new Date(activeClaim.expiresAt).getTime();
      const updateTimer = () => {
        const remaining = Math.max(0, Math.round((expires - Date.now()) / 1000));
        setClaimTimeLeft(remaining);
      };

      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    }
  }, [activeClaim]);

  // Error/Success cleanup timers
  useEffect(() => {
    if (actionError) {
      const timer = setTimeout(() => setActionError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionError]);

  useEffect(() => {
    if (successInfo) {
      const timer = setTimeout(() => setSuccessInfo(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successInfo]);

  // Synchronize hand card groups to server on change (supports audit score calculation!)
  useEffect(() => {
    if (localGroups.length > 0 && game.status === 'playing') {
      onEmit("syncGroups", { groups: localGroups });
    }
  }, [localGroups, game.status]);


  // Host triggers Game Start logic
  const handleStartGame = () => {
    onEmit("startGame", {}, (resp: any) => {
      if (resp && resp.error) {
        setActionError(resp.error);
      } else {
        setSuccessInfo("Deck shuffled and 13 cards dealt to each player!");
      }
    });
  };

  // Card Selection inside Hand
  const handleCardClick = (cardId: number) => {
    if (selectedCardIds.includes(cardId)) {
      setSelectedCardIds(selectedCardIds.filter(id => id !== cardId));
    } else {
      setSelectedCardIds([...selectedCardIds, cardId]);
    }
  };

  // Draw card from sources
  const handleDraw = (source: 'deck' | 'discard') => {
    onEmit("drawCard", { source }, (resp: any) => {
      if (resp && resp.error) {
        setActionError(resp.error);
      } else {
        setSelectedCardIds([]);
        setSuccessInfo(`Drew card from ${source} successfully.`);
      }
    });
  };

  // Discard card from hand
  const handleDiscard = () => {
    if (selectedCardIds.length !== 1) {
      setActionError("Please select exactly ONE card from your hand to discard.");
      return;
    }

    const targetId = selectedCardIds[0];
    onEmit("discardCard", { cardId: targetId }, (resp: any) => {
      if (resp && resp.error) {
        setActionError(resp.error);
      } else {
        setSelectedCardIds([]);
        setSuccessInfo("Card discarded. Handing turn to the next player.");
      }
    });
  };

  // Submit 4 same rank cards group for next player approval
  const handleClaimWildCard = () => {
    if (game.wildCardRank) {
      setActionError("The wild card for this game has already been selected.");
      return;
    }
    if (myHandCards.length !== 13) {
      setActionError("To claim a wild card, you must have exactly 13 cards in your hand (before drawing or after discarding).");
      return;
    }
    
    let groupOfFourIds = localGroups.find(grp => grp.length === 4);
    
    // Support using simply 4 selected cards if no 4-card group is found
    if (!groupOfFourIds && selectedCardIds.length === 4) {
      groupOfFourIds = selectedCardIds;
    }

    if (!groupOfFourIds || groupOfFourIds.length !== 4) {
      setActionError("To claim a wild card, please select exactly 4 matching cards or arrange them together in a group of 4.");
      return;
    }

    const groupOfFourCards = groupOfFourIds.map(id => myHandCards.find(c => c.id === id)).filter(Boolean) as CardType[];
    
    if (groupOfFourCards.length !== 4) {
      setActionError("Invalid cards selected.");
      return;
    }

    const firstRank = groupOfFourCards[0].rank;
    const allSameRank = groupOfFourCards.every(c => c.rank === firstRank);
    
    if (!allSameRank) {
      setActionError("To claim a wild card, your 4 cards must all have the exact same rank (e.g. four 3s).");
      return;
    }
    
    setPendingWildcardClaimCards(groupOfFourIds);
    setIsExpandingPile(true);
    setSuccessInfo(`Please select a card from the deck blindly to be the target wild card!`);
  };

  const handleConfirmWildcardClaim = (deckCardId: number) => {
    onEmit("requestWildCardClaim", { cardIds: pendingWildcardClaimCards, deckCardId }, (resp: any) => {
      if (resp && resp.error) {
        setActionError(resp.error);
      } else {
        setSelectedCardIds([]); // Clear selection after successful claim
        setPendingWildcardClaimCards([]);
        setIsExpandingPile(false);
        setSuccessInfo(`Wildcard request submitted. Awaiting verification approval from the next player.`);
      }
    });
  };

  // Pick Toss Card
  const handleTossPickCard = (cardId: number) => {
    onEmit("tossPickCard", { cardId }, (resp: any) => {
      if (resp && resp.error) {
        setActionError(resp.error);
      } else {
        setSuccessInfo("Card selected. Waiting for other players to pick.");
      }
    });
  };

  // Deal Next Round
  const handleDealNextRound = () => {
    onEmit("dealNextRound", {}, (resp: any) => {
      if (resp && resp.error) {
        setActionError(resp.error);
      } else {
        setSuccessInfo("Dealing next round...");
      }
    });
  };

  // Verifier approvals for wildcard selection claims
  const handleApproveClaim = (claimId: number) => {
    onEmit("approveWildCard", { claimId }, (resp: any) => {
      if (resp && resp.error) {
        setActionError(resp.error);
      } else {
        setSuccessInfo("Wild card selection APPROVED. It is now designated as the active Game Wild Card!");
      }
    });
  };

  const handleRejectClaim = (claimId: number) => {
    onEmit("rejectWildCard", { claimId }, (resp: any) => {
      if (resp && resp.error) {
        setActionError(resp.error);
      } else {
        setActionError("Claim REJECTED. The card has been shuffled back into the deck; please draw again.");
      }
    });
  };

  // Declare arranged hand
  const handleDeclare = (finishCardId?: number) => {
    if (localGroups.length === 0) {
      setActionError("Cards must be organized into groups to declare.");
      return;
    }

    // Prepare structured meld array of arrays of IDs
    onEmit("declareGame", { mels: localGroups, finishCardId }, (resp: any) => {
      if (resp && resp.error) {
        setActionError(resp.error);
      } else if (resp && resp.penalty) {
        setActionError(resp.error || "Wrong declare penalty applied.");
      } else {
        setSuccessInfo("DECLARATION VALID! Concluding game as winner!");
      }
    });
  };

  // Group Selected Cards Locally
  const handleGroupSelected = () => {
    if (selectedCardIds.length === 0) {
      setActionError("Select one or more cards to form a group.");
      return;
    }

    // Remove selected card IDs from all current groups
    const remainingGroups = localGroups
      .map(grp => grp.filter(id => !selectedCardIds.includes(id)))
      .filter(grp => grp.length > 0);

    // Create a new separate group with them
    setLocalGroups([...remainingGroups, selectedCardIds]);
    setSelectedCardIds([]);
  };

  // Dissolve All Card Groups Locally
  const handleResetGroups = () => {
    const flatIds = myHandCards.map(c => c.id);
    setLocalGroups([flatIds]);
    setSelectedCardIds([]);
  };

  // Auto Group based on Card Values / Ranks
  const handleAutoGroup = () => {
    const rankGroupsMap: Record<string, CardType[]> = {};
    const wildsAndJokers: CardType[] = [];

    myHandCards.forEach(c => {
      const isWild = c.rank === game.wildCardRank || c.suit === 'joker' || c.rank === 'joker' || c.isWild || c.isHiddenWild;
      if (isWild) {
        wildsAndJokers.push(c);
      } else {
        if (!rankGroupsMap[c.rank]) {
          rankGroupsMap[c.rank] = [];
        }
        rankGroupsMap[c.rank].push(c);
      }
    });

    const finishedSets: number[][] = [];
    const singletons: CardType[] = [];

    Object.keys(rankGroupsMap).forEach(rank => {
      const grp = rankGroupsMap[rank];
      if (grp.length >= 2) {
        finishedSets.push(grp.map(c => c.id));
      } else {
        singletons.push(...grp);
      }
    });

    if (singletons.length > 0) {
      finishedSets.push(singletons.map(c => c.id));
    }

    if (wildsAndJokers.length > 0) {
      finishedSets.push(wildsAndJokers.map(c => c.id));
    }

    setLocalGroups(finishedSets);
    setSelectedCardIds([]);
    setSuccessInfo("Hand automatically organized by matching card value Ranks!");
  };

  // Move card to target group
  const handleMoveCardToGroup = (cardId: number, targetGroupIdx: number) => {
    let newGroups = localGroups.map(grp => grp.filter(id => id !== cardId));
    
    // Append to target group
    if (newGroups[targetGroupIdx]) {
      newGroups[targetGroupIdx] = [...newGroups[targetGroupIdx], cardId];
    } else {
      newGroups.push([cardId]);
    }
    
    newGroups = newGroups.filter(grp => grp.length > 0);
    setLocalGroups(newGroups);
    setSelectedCardIds([]); // Clear selection
  };

  // Drag-and-drop / Touch-and-drop card into card position
  const handleCardDropOnCard = (draggedId: number, targetId: number, targetGroupIdx: number) => {
    if (draggedId === targetId) return;

    // 1. Remove draggedId from all current groups
    let newGroups = localGroups.map(grp => grp.filter(id => id !== draggedId));

    // 2. Find target group and insert draggedId right before targetId
    const grp = newGroups[targetGroupIdx];
    if (grp) {
      const idx = grp.indexOf(targetId);
      if (idx !== -1) {
        grp.splice(idx, 0, draggedId);
      } else {
        grp.push(draggedId);
      }
    } else {
      newGroups.push([draggedId]);
    }

    newGroups = newGroups.filter(g => g.length > 0);
    setLocalGroups(newGroups);
    setSelectedCardIds([]);
  };

  // Mobile Touch End: Find element at point and drop
  const handleTouchEnd = (e: React.TouchEvent, cardId: number, sourceGroupIdx: number) => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    
    // Find the element at release coordinates
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!targetEl) return;
    
    // Traverse element hierarchy
    let current: HTMLElement | null = targetEl as HTMLElement;
    let targetGroupIdxStr: string | null = null;
    let targetCardIdStr: string | null = null;
    
    while (current) {
      if (current.dataset && current.dataset.groupIdx) {
        targetGroupIdxStr = current.dataset.groupIdx;
      }
      if (current.dataset && current.dataset.cardId) {
        targetCardIdStr = current.dataset.cardId;
      }
      current = current.parentElement;
    }
    
    if (targetCardIdStr !== null && targetGroupIdxStr !== null) {
      const targetCardId = parseInt(targetCardIdStr, 10);
      const targetGroupIdx = parseInt(targetGroupIdxStr, 10);
      if (targetCardId !== cardId) {
        handleCardDropOnCard(cardId, targetCardId, targetGroupIdx);
      }
    } else if (targetGroupIdxStr !== null) {
      const targetGroupIdx = parseInt(targetGroupIdxStr, 10);
      handleMoveCardToGroup(cardId, targetGroupIdx);
    }
  };

  // Find player details by ID
  const getPlayerDetails = (pId: number | null): PlayerType | undefined => {
    return players.find(p => p.id === pId);
  };

  const me = players.find(p => p.id === viewerPlayerId);
  const hasViewerDeclared = me?.hasDeclared || false;
  const isWinnerDeclared = game.winnerPlayerId !== null;
  const winnerPlayer = players.find(p => p.id === game.winnerPlayerId);

  // You can only take turn actions if no one has won yet
  const isMyTurn = game.currentTurnPlayerId === viewerPlayerId && !isWinnerDeclared;
  const currentTurnPlayer = getPlayerDetails(game.currentTurnPlayerId);
  const dealerPlayer = getPlayerDetails(game.dealerPlayerId);

  // List of players in turn order
  const sortedPlayers = [...players].sort((a, b) => a.turnOrder - b.turnOrder);

  // Find top discard card
  const discards = cards.filter(c => c.location === 'discard');
  const topDiscardCard = discards.length > 0 
    ? discards.sort((a, b) => b.position - a.position)[0] 
    : null;

  // LOBBY DISPLAY STATE (WAITING STATUS)
  if (game.status === 'waiting') {
    const isHost = sortedPlayers[0]?.id === viewerPlayerId;

    return (
      <div id="lobby-waiting-container" className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8 text-white">
        {/* Lobby Details Header */}
        <div className="flex justify-between items-start border-b border-rose-500/10 pb-6 mb-6">
          <div className="flex flex-col">
            <h2 className="text-xl font-sans font-bold text-white mb-1">Game Match Lobby</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-emerald-400 font-bold uppercase tracking-wider">Lobby Code:</span>
              <span className="text-sm font-mono tracking-widest bg-slate-800 text-white font-bold px-2 py-0.5 rounded border border-slate-700 select-all">
                {game.code}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsNotificationsMuted(prev => !prev)}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700/80 text-xs font-sans font-bold rounded-lg border border-slate-700 transition"
            >
              {isNotificationsMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
            </button>
            <button 
              onClick={() => setShowLeaveConfirm(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700/80 hover:text-red-400 text-xs font-sans font-bold rounded-lg border border-slate-700 transition"
            >
              <LogOut className="w-3.5 h-3.5" /> Leave
            </button>
          </div>
        </div>

        {/* Player Slot Grid */}
        <div className="flex flex-col gap-3 py-2 mb-8">
          <span className="text-xs font-mono text-slate-400 uppercase tracking-widest font-bold">Lobby Players ({players.length} / 6)</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[...Array(6)].map((_, idx) => {
              const joined = sortedPlayers[idx];
              if (joined) {
                const isHostSelf = idx === 0;
                const isViewerSelf = joined.id === viewerPlayerId;
                return (
                  <div 
                    key={joined.id}
                    className={`flex items-center justify-between p-4 rounded-xl border ${
                      isViewerSelf 
                        ? 'bg-slate-800 border-rose-500/30 shadow-md shadow-rose-500/5' 
                        : 'bg-slate-800/40 border-slate-850'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                        isHostSelf ? 'bg-amber-500/10 text-amber-400 border border-amber-550' : 'bg-slate-700 text-slate-200'
                      }`}>
                        {isHostSelf ? <Crown className="w-4 h-4" /> : joined.turnOrder + 1}
                      </div>
                      <span className="font-sans font-bold text-sm text-slate-100 flex items-center gap-1.5">
                        {joined.username} {isViewerSelf && <span className="text-[10px] font-mono font-bold bg-slate-700 text-slate-400 px-1 rounded">You</span>}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${joined.isOnline ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                        {joined.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>
                );
              } else {
                return (
                  <div 
                    key={`slot-${idx}`}
                    className="flex items-center justify-center p-4 rounded-xl border border-dashed border-slate-800 bg-slate-900/40 text-slate-600 text-xs font-mono select-none"
                  >
                    Waiting for Player...
                  </div>
                );
              }
            })}
          </div>
        </div>

        {/* Warning Logs */}
        {actionError && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono">
            {actionError}
          </div>
        )}

        {/* Action Button */}
        <div className="flex flex-col items-center">
          {isHost ? (
            <button
              onClick={handleStartGame}
              disabled={players.length < 2}
              id="start-match-btn"
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-sans font-extrabold text-sm rounded-xl transition duration-200 shadow-lg flex items-center justify-center gap-2 active:scale-95 disabled:active:scale-100"
            >
              <Play className="w-5 h-5 fill-current" />
              Start Multiplayer Match
            </button>
          ) : (
            <div className="flex items-center justify-center gap-3 p-4 bg-slate-850 rounded-xl border border-slate-800 text-xs text-slate-400 font-mono w-full animate-pulse">
              <span className="w-3 h-3 bg-emerald-500 rounded-full animate-ping" />
              Waiting for match host to initiate deal...
            </div>
          )}
          {isHost && players.length < 2 && (
            <p className="text-xs text-rose-400 font-mono mt-3 leading-relaxed">
              At least 2 players are required to start the game. Share the Lobby code to invite friend players.
            </p>
          )}
        </div>
      </div>
    );
  }

  // GAMEPLAY DISPLAY STATE (PLAYING AND FINISHED STATUS)
  return (
    <div id="gameplay-canvas" className="w-full flex flex-col gap-0 md:gap-6 text-slate-200 mx-auto relative overflow-x-hidden overflow-y-auto min-h-[100dvh] md:min-h-0 md:h-auto">
      
      {/* Mobile background overlay for lobby drawer */}
      {isLobbyOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-[90] lg:hidden animate-fade-in"
          onClick={() => setIsLobbyOpen(false)}
        />
      )}
      
      {/* Declaration Confirmation Overlay */}
      {showDeclareConfirm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-indigo-500/50 rounded-2xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-6">
            <div className="text-center">
              <Trophy className="w-12 h-12 text-yellow-400 mx-auto mb-3" />
              <h2 className="text-xl font-black font-sans text-white uppercase tracking-wider mb-2">Confirm Declaration</h2>
              <p className="text-slate-300 text-sm leading-relaxed">
                Are you sure you want to declare the game with your current card groups? 
              </p>
              <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                <p className="text-rose-400 text-xs font-bold leading-relaxed">
                  <span className="uppercase block mb-1 font-black">⚠️ Warning</span>
                  If your declaration is invalid, you will receive an immediate 80 point penalty and the round will conclude!
                </p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeclareConfirm(false)}
                className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl transition border border-slate-700/50 text-sm"
              >
                Regroup
              </button>
              <button
                onClick={() => {
                  setShowDeclareConfirm(false);
                  handleDeclare(selectedCardIds.length === 1 ? selectedCardIds[0] : undefined);
                }}
                className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition border border-indigo-500 shadow-lg shadow-indigo-600/20 text-sm"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Confirmation Overlay */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 max-w-sm w-full flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-rose-500/20 text-rose-500 rounded-full flex items-center justify-center mb-4">
              <LogOut className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-black font-sans text-white uppercase tracking-wider mb-2">Leave Game?</h2>
            <p className="text-slate-400 text-xs mb-6 leading-relaxed">
              Are you sure you want to leave the game? This will disconnect you from the current session.
            </p>
            <div className="flex gap-3 w-full">
              <button 
                onClick={() => setShowLeaveConfirm(false)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider rounded-xl transition"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  setShowLeaveConfirm(false);
                  onExit();
                }}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-lg shadow-rose-600/20"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Top Meta info panel */}
      <div className="flex flex-wrap justify-between items-center bg-slate-900 border-b md:border border-slate-800 p-2 md:p-4 md:rounded-xl shadow-lg gap-2 md:gap-4 shrink-0 z-[60]">
        <div className="flex items-center gap-3">
          <button 
            className="lg:hidden p-1.5 -ml-2 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition"
            onClick={() => setIsLobbyOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center font-bold text-white shadow-md">
            <span className="text-sm font-black tracking-lighter font-mono">DS</span>
          </div>
          <h1 className="text-lg font-bold tracking-tight uppercase text-white">
            Indian Dummy Set <span className="text-slate-500 font-medium text-xs font-mono ml-2 hidden sm:inline">| Code: {game.code} | Max: {game.maxScore || 200} | Amt: ₹{game.gameAmount || 0} | Score: {players.find(p => p.id === viewerPlayerId)?.score || 0}</span>
          </h1>
        </div>

        {/* Game status indicator */}
        <div className="flex items-center gap-6">
          <div className="flex gap-2">
            <div className="px-3 py-1 bg-slate-950 rounded-full text-[11px] font-mono border border-slate-800 flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-300">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" /> SERVER CONNECTED
            </div>
            {game.status === 'playing' ? (
              <div className={`px-3 py-1 bg-slate-950 rounded-full text-[11px] font-mono border border-slate-800 ${
                isMyTurn ? 'text-indigo-400 font-extrabold border-indigo-500/20' : 'text-slate-400'
              }`}>
                {isMyTurn ? "● YOUR TURN" : `● TURN: ${currentTurnPlayer?.username?.toUpperCase()}`}
              </div>
            ) : (
              <div className="px-3 py-1 bg-emerald-950 text-emerald-300 rounded-full text-[11px] font-mono border border-emerald-800 font-extrabold">
                ● CONCLUDED
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsNotificationsMuted(prev => !prev)}
              className="flex items-center justify-center w-8 h-8 bg-slate-800 hover:bg-slate-700/80 text-xs font-sans font-bold border border-slate-700 rounded-lg transition"
            >
              {isNotificationsMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
            </button>
            <button 
              onClick={() => setShowLeaveConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700/80 hover:text-red-400 text-xs font-sans font-bold border border-slate-700 rounded-lg transition"
            >
              <LogOut className="w-3.5 h-3.5" /> Leave
            </button>
          </div>
        </div>
      </div>

      {/* Replaced inline actionError/successInfo with global modals */}

      {/* Notifications / Claims (Exclude the modal banner here) */}
      {activeClaim && activeClaim.status === 'pending' && viewerPlayerId === activeClaim.claimantPlayerId && (
        <div className="mb-4 bg-slate-900 border border-slate-700 p-3 rounded-lg flex items-start gap-3 shadow-md">
          <div className="bg-amber-500/20 p-1.5 rounded text-amber-500">
            <Clock className="w-5 h-5 animate-spin-slow" />
          </div>
          <div className="flex-1">
            <h4 className="text-xs font-black text-amber-500 tracking-wider">AWAITING 4-OF-A-KIND VERIFICATION...</h4>
            <p className="text-[10px] font-mono text-slate-300 mt-0.5">
              Your 4-of-a-kind claim is currently being vetted by <span className="font-bold text-indigo-400">{players.find(p => p.id === activeClaim.verifierPlayerId)?.username || 'Next player'}</span> on the next seat.
            </p>
          </div>
        </div>
      )}

      {/* Wildcard approved, awaiting claimant selection */}
      {activeClaim && activeClaim.status === 'approved_to_select' && (
        <div id="wildcard-selection-select-box" className="p-1">
          {viewerPlayerId === activeClaim.claimantPlayerId ? (
            <div className="bg-slate-900 border border-amber-500/45 p-5 rounded-2xl flex items-center justify-between gap-4 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-xl animate-bounce">
                  <Swords className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <h3 className="text-xs font-sans font-black text-amber-400 uppercase tracking-tight">Your Wildcard Claim is APPROVED!</h3>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                    Your 4-of-a-kind was approved! Click the <span className="text-amber-400 font-bold">"Fanned Deck"</span> inside the arena to select your secret wildcard blindly!
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-805 p-5 rounded-xl flex items-center justify-between gap-4 shadow-lg opacity-85 font-mono">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-800 rounded-xl">
                  <Timer className="w-5 h-5 text-slate-400 animate-spin" />
                </div>
                <div>
                  <h3 className="text-xs font-sans font-bold text-slate-300 uppercase tracking-tight">Approved! Awaiting Selection...</h3>
                  <p className="text-[11px] text-slate-505 mt-0.5">
                    <span className="text-slate-350 font-bold">{claimantPlayer?.username}</span>'s 4-of-a-kind was approved. They are now selecting their private wildcard blindly from the deck.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Grid: Arena & Audit Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* LOBBY PLAYERS PANEL (LEFT SIDE) */}
        {/* Mobile: fixed off-canvas drawer. Desktop: Grid column */}
        <div 
          className={`
            fixed inset-y-0 left-0 w-80 z-[100] transform transition-transform duration-300 ease-in-out
            lg:relative lg:inset-auto lg:w-auto lg:transform-none lg:z-auto
            ${isLobbyOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
            lg:col-span-1 bg-slate-900 border-r lg:border border-slate-805 lg:rounded-xl flex flex-col divide-y divide-slate-800/60 overflow-hidden lg:shadow-2xl
          `}
        >
          <div className="p-4 bg-slate-950/40 flex justify-between items-center">
            <div>
              <h3 className="text-[10px] font-mono text-slate-500 uppercase tracking-widest font-extrabold flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" /> Lobby Seats
              </h3>
              <p className="text-[11px] text-slate-400 font-medium">Turn schedule & penalty scoring</p>
            </div>
            <button 
              className="lg:hidden p-2 -mr-2 text-slate-400 hover:text-white transition"
              onClick={() => setIsLobbyOpen(false)}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="p-4 flex flex-col gap-2.5 max-h-[380px] overflow-y-auto">
            {sortedPlayers.map(p => {
              const isTurn = game.currentTurnPlayerId === p.id && game.status === 'playing';
              const isSelf = p.id === viewerPlayerId;
              
              // Count remaining cards of other players
              const handCardsCount = cards.filter(c => c.ownerPlayerId === p.id && c.location === 'hand').length;

              return (
                <div 
                  key={p.id}
                  className={`p-3.5 rounded-xl border transition duration-200 flex flex-col gap-2 relative overflow-hidden ${
                    isTurn 
                      ? 'bg-indigo-600/10 border-indigo-500/50 shadow-md shadow-indigo-600/5' 
                      : isSelf 
                        ? 'bg-slate-950/80 border-slate-800' 
                        : 'bg-slate-950/30 border-slate-850'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-sans font-bold text-xs flex items-center gap-1.5 truncate text-slate-100">
                      {p.username} 
                      {isSelf && <span className="text-[9px] font-mono bg-indigo-600/20 text-indigo-400 px-1 py-0.2 rounded font-bold">YOU</span>}
                    </span>
                    <span className={`w-1.5 h-1.5 rounded-full ${p.isOnline ? 'bg-emerald-500 shadow-sm shadow-emerald-500/40' : 'bg-rose-500'}`} />
                  </div>

                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Remaining Hand</span>
                    <span className="text-slate-200 font-bold font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800/80 leading-none">
                      {handCardsCount} cards
                    </span>
                  </div>

                  {game.status === 'finished' && (
                    <div className="flex justify-between items-center text-xs pt-1 border-t border-slate-850 font-mono text-amber-400">
                      <span>Matches Penalty:</span>
                      <strong className="font-bold font-mono">{p.score} pts</strong>
                    </div>
                  )}

                  {isTurn && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Teams-like Voice Communication Lobby */}
          {socket && (
            <div className="p-1">
              <VoiceRoom
                socket={socket}
                gameId={game.id}
                viewerPlayerId={viewerPlayerId}
                players={players}
                onToggleLobby={() => setIsLobbyOpen(prev => !prev)}
                onStreamsChange={setPlayerStreams}
              />
            </div>
          )}
        </div>

        {/* PRIMARY ARENA (MIDDLE RESPONCE COORD FOR MOBILE) */}
        <div className="lg:col-span-3 flex flex-col gap-2 md:gap-6 flex-1 min-h-0 shrink-0 relative">
          
          {/* Floating View Summary Button if hidden */}
          {hideRoundSummary && (game.status === 'round_finished' || game.status === 'finished') && (
            <button 
              onClick={() => setHideRoundSummary(false)}
              className="absolute top-2 left-1/2 -translate-x-1/2 z-[60] bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2 rounded-full shadow-2xl border border-indigo-400/50 uppercase tracking-widest text-[10px] animate-bounce"
            >
              View Round Summary
            </button>
          )}

          {/* CLASSIC GREEN FELT TABLE */}
          <div className="relative border-y-[10px] md:border-[16px] border-[#4a2e15] bg-[#0e5c2f] md:rounded-[64px] shadow-2xl flex-1 flex flex-col justify-between p-2 md:p-6 select-none bg-gradient-to-b from-[#147a3f] to-[#08381c]">
            {/* Turn Glow Indicator - separated so the opacity pulse doesn't hide the cards */}
            {isMyTurn && (
              <div className="absolute inset-0 pointer-events-none rounded-[48px] md:rounded-[64px] shadow-[inset_0_0_80px_20px_rgba(251,191,36,0.5)] ring-4 md:ring-[12px] ring-amber-400/80 animate-pulse z-0" />
            )}

            {/* Glossy inner table felt glow shadow */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.08)_0%,_transparent_80%)] pointer-events-none -z-10 rounded-[48px]" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.05)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none -z-10 opacity-40 rounded-[48px]" />

            {/* Blind Selection Fanned Deck Drawer Overlay for Toss and Wildcard */}
            {(isExpandingPile || game.status === 'toss') && (
              <div className="absolute inset-0 bg-slate-950/95 z-50 p-6 flex flex-col justify-between rounded-3xl border border-amber-500/30 overflow-y-auto">
                <div className="flex justify-between items-center border-b border-slate-850 pb-3">
                  <div>
                    <h3 className="text-sm font-sans font-black text-amber-400 uppercase tracking-wider flex items-center gap-2">
                      <Swords className="w-5 h-5 text-amber-500 animate-pulse" /> 
                      {game.status === 'toss' ? "Toss: Pick starting card" : "Blind Wild Card Selection"}
                    </h3>
                    <p className="text-[10px] font-mono text-slate-450 uppercase mt-0.5">
                      {game.status === 'toss' ? "Select a card to determine the dealer. Lowest rank wins!" : "Select any card below blindly to designate it as the wild card"}
                    </p>
                  </div>
                  {game.status !== 'toss' && (
                    <button 
                      onClick={() => setIsExpandingPile(false)}
                      id="cancel-expand-wild-btn"
                      className="p-1 px-3 bg-slate-805 hover:bg-slate-705 text-slate-300 rounded-lg text-xs font-bold transition cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                </div>

                {/* Overlapping fanned deck list */}
                <div className="flex flex-wrap justify-center items-center gap-2 py-6 max-h-[260px] overflow-y-auto pr-1">
                  {cards.filter(c => c.location === 'deck').map((deckCard, idx) => (
                    <div
                      key={deckCard.id}
                      onClick={() => game.status === 'toss' ? handleTossPickCard(deckCard.id) : handleConfirmWildcardClaim(deckCard.id)}
                      className="w-10 h-16 bg-gradient-to-br from-indigo-700 to-indigo-900 border border-indigo-400/40 rounded shadow-md hover:-translate-y-2 hover:indigo-505 hover:border-amber-405 hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer flex flex-col justify-between p-1 select-none"
                    >
                      <span className="text-[7px] font-mono font-bold text-white/50">{idx + 1}</span>
                      <span className="text-[8px] font-sans font-black text-white text-center leading-none">?</span>
                      <span className="text-[7px] font-mono text-right text-white/50">DS</span>
                    </div>
                  ))}
                  {cards.filter(c => c.location === 'deck').length === 0 && (
                    <p className="text-xs font-mono text-slate-400 py-12">No cards currently remaining in deck pile.</p>
                  )}
                </div>

                <div className="text-center text-[10px] font-mono text-amber-500/70 uppercase">
                  {game.status === 'toss' ? "The player who picks the lowest rank becomes the first dealer!" : "Once clicked, this chosen card's rank will become the active wild card rank!"}
                </div>
              </div>
            )}

            {/* Designated Wildcard Panel */}
            <div className="absolute top-4 right-4 bg-slate-900 border border-slate-800 p-2.5 rounded-xl flex items-center gap-3 shadow-2xl z-10 transition-transform hover:scale-102 duration-300">
              <div className="flex flex-col">
                <span className="text-[9px] font-mono uppercase tracking-widest text-slate-500 font-bold">Game Wild Card</span>
                <span className="text-xs font-sans font-black text-amber-400 tracking-tight uppercase">
                  {game.wildCardRank ? `${game.wildCardRank} of ${game.wildCardSuit}s` : ""}
                </span>
              </div>
              {game.wildCardRank ? (
                <div className="w-8 h-12 bg-white rounded border-2 border-slate-300 text-slate-900 flex flex-col items-center justify-center p-0.5 leading-none select-none shadow">
                  <span className="text-xs font-sans font-black leading-none">{game.wildCardRank}</span>
                  <span className="text-[9px] uppercase font-mono tracking-tighter scale-90 mt-0.5 font-bold">{game.wildCardSuit?.substring(0, 3)}</span>
                </div>
              ) : (
                <div className="w-8 h-12 bg-slate-955 text-slate-500 rounded border-2 border-dashed border-slate-805 flex items-center justify-center text-xs font-sans font-black leading-none shadow select-none">
                  ?
                </div>
              )}
            </div>

            {/* Rummy Table Top Row: All Players */}
            {game.status === 'toss' || game.status === 'toss_reveal' || game.status === 'playing' || ((game.status === 'round_finished' || game.status === 'finished') && hideRoundSummary) ? (
              <div className="flex flex-row justify-center items-center gap-4 sm:gap-6 flex-wrap w-full z-10 pt-10">
                {sortedPlayers.map(p => {
                const isTurn = game.currentTurnPlayerId === p.id && game.status === 'playing';
                const remainingHandCount = cards.filter(c => c.ownerPlayerId === p.id && c.location === 'hand').length;
                
                // Simple colored fallback background for avatar
                const colors = ["bg-red-500", "bg-sky-500", "bg-amber-500", "bg-emerald-500", "bg-indigo-500", "bg-pink-500"];
                const avatarColor = colors[p.id % colors.length];

                return (
                  <div 
                    key={p.id}
                    className="flex flex-col items-center relative transition-transform duration-300 hover:scale-105 mt-2"
                  >
                    {/* Toss Card Rendering */}
                    {(game.status === 'toss' || game.status === 'toss_reveal') && (
                      <div className="absolute -top-16 left-1/2 -translate-x-1/2 scale-75 origin-bottom z-20">
                        {(() => {
                          const tCard = cards.find(c => c.ownerPlayerId === p.id && c.location === 'toss');
                          if (!tCard) return <div className="w-10 h-14 border-2 border-dashed border-slate-700/50 rounded-lg bg-slate-900/30" />;
                          if (game.status === 'toss') return (
                            <div className="w-10 h-14 rounded-lg bg-gradient-to-br from-indigo-700 to-indigo-900 border border-indigo-400/40 shadow-xl flex items-center justify-center animate-in fade-in zoom-in duration-300">
                              <span className="text-white/50 text-[10px] font-mono font-bold">DS</span>
                            </div>
                          );
                          return (
                            <div className="animate-in flip-in-y duration-500 shadow-2xl">
                              <CardVisual card={tCard} size="sm" />
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    <div className="relative">
                      {/* Avatar frame */}
                      <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full ${avatarColor} flex items-center justify-center border-2 border-slate-900 shadow-md ${
                        isTurn ? 'ring-4 ring-emerald-500 animate-pulse' : 'ring-2 ring-purple-900/60'
                      }`}>
                        <span className="font-sans font-black text-white text-sm sm:text-base tracking-wider select-none">
                          {p.username.substring(0, 2).toUpperCase()}
                        </span>
                      </div>
                      
                      {/* Remaining Card badge / score (only in playing) */}
                      {game.status === 'playing' && (
                        <div className="absolute -top-1 -right-1 bg-slate-950 border border-slate-800 text-[9px] sm:text-[10px] font-black text-amber-405 font-mono w-5 h-5 rounded-full flex items-center justify-center shadow-md">
                          {remainingHandCount}
                        </div>
                      )}

                      <span className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full ${p.isOnline ? 'bg-emerald-500 shadow-sm shadow-emerald-400' : 'bg-rose-500'}`} />
                    </div>

                    {/* Username pill */}
                    <span className={`mt-1.5 px-2 py-0.5 rounded-full text-[8.5px] sm:text-[9.5px] font-mono font-bold border flex items-center gap-1 ${
                      isTurn 
                        ? 'bg-emerald-500/15 border-emerald-505 text-emerald-400' 
                        : 'bg-slate-950/80 border-slate-800 text-slate-350'
                    }`}>
                      {p.username} {p.id === viewerPlayerId && <span className="text-[8px] text-slate-500 font-bold">(YOU)</span>}
                    </span>
                  </div>
                );
              })}
                {sortedPlayers.length === 0 && (
                  <p className="text-xs font-mono text-purple-300/60 uppercase">Waiting for players to sit down...</p>
                )}
              </div>
            ) : null}

            {/* Optional: Winner Declared Warning Banner */}
            {isWinnerDeclared && !hasViewerDeclared && game.status === 'playing' && (
              <div className="bg-rose-500 text-white font-sans font-bold text-center py-2 px-4 text-xs tracking-wider animate-pulse border-b border-rose-600 shadow-lg relative z-20">
                🚨 PLAYER {sortedPlayers.find(p => p.id === game.winnerPlayerId)?.username.toUpperCase()} HAS DECLARED! 🚨<br/>
                <span className="font-medium text-[10px]">Arrange your cards into valid groups and declare your hand below to minimize penalty points!</span>
              </div>
            )}

            {/* Piles Deck Row in Center of Felt */}
            <div className="flex flex-row items-center justify-center flex-1 py-2 lg:py-6 gap-2 sm:gap-4 lg:gap-8 z-10 w-full px-1 sm:px-2">
              
              {/* LEFT ACTION: Auto Group */}
              {game.status === 'playing' && (
                <button
                  onClick={handleAutoGroup}
                  id="auto-group-btn"
                  disabled={hasViewerDeclared}
                  className="shrink-0 px-2 sm:px-3 py-2 sm:py-3 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-400 hover:text-white font-sans text-[9px] sm:text-[10px] lg:text-xs font-bold rounded-xl transition border border-indigo-500/30 flex items-center gap-1 sm:gap-1.5 active:scale-95 cursor-pointer shadow whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex flex-col items-start leading-tight">
                    <span>Auto</span>
                    <span>Group</span>
                  </div>
                </button>
              )}

              {/* CENTER: The Three Piles */}
              <div className="flex gap-2 sm:gap-4 lg:gap-14 items-start flex-nowrap justify-center shrink-0">
                
                {/* Discard Log History (Left side) */}
                <div className="flex flex-col items-center gap-1.5 relative shrink-0">
                  <span 
                    className="text-[9px] font-mono text-purple-200/50 font-black uppercase tracking-widest cursor-pointer hover:text-purple-100 flex items-center gap-1"
                    onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
                  >
                    <History className="w-3 h-3" /> History
                  </span>
                  
                  {/* Collapsed view / Interactive trigger */}
                  <div 
                    onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
                    className="relative cursor-pointer"
                  >
                    {discardHistoryCards.length > 0 ? (
                      <div className="w-16 h-24 lg:w-24 lg:h-36 relative hover:scale-105 transition-transform duration-200">
                        <div className="absolute top-0 left-0 flex items-center gap-2 transform scale-[0.66] origin-top-left lg:scale-100 lg:origin-center">
                          <div className="relative">
                            <CardVisual card={discardHistoryCards[discardHistoryCards.length - 1]} />
                            <div className="absolute inset-0 bg-slate-950/60 rounded-lg flex items-center justify-center">
                               <span className="text-white font-black text-2xl">+{discardHistoryCards.length}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="w-16 h-24 lg:w-24 lg:h-36 rounded-lg border-2 border-dashed border-slate-700/50 bg-slate-900/40 flex items-center justify-center hover:bg-slate-800/60 transition shadow-inner">
                        <span className="text-[8px] lg:text-xs text-slate-500 font-mono text-center leading-tight">Empty<br/>Log</span>
                      </div>
                    )}
                  </div>

                  {/* Expanded Dropdown */}
                  {isHistoryExpanded && discardHistoryCards.length > 0 && (
                    <div className="absolute top-[calc(100%+8px)] left-0 bg-slate-900/95 border border-slate-700 p-2 rounded-xl shadow-2xl z-[60] flex flex-col gap-1 max-h-48 overflow-y-auto animate-fade-in w-28 md:w-40 custom-scrollbar">
                      <div className="absolute -top-1.5 left-6 w-3 h-3 bg-slate-900 border-t border-l border-slate-700 rotate-45" />
                      {discardHistoryCards.slice().reverse().map((c, i) => (
                        <div key={`hist-${c.id}`} className="flex justify-between items-center px-2 py-1.5 bg-slate-800/50 rounded text-xs font-bold border border-slate-700/50 relative z-10">
                          <span className="text-slate-200">{c.rank}</span>
                          <span className={`${c.suit === 'hearts' || c.suit === 'diamonds' ? 'text-rose-500' : 'text-slate-400'}`}>
                            {c.suit === 'hearts' ? '♥' : c.suit === 'diamonds' ? '♦' : c.suit === 'clubs' ? '♣' : c.suit === 'spades' ? '♠' : 'Jok'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 1. Draw Pile (Face Down Deck) */}
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  <span className="text-[9px] font-mono text-purple-200/50 font-black uppercase tracking-widest">Draw Pile</span>
                  <div 
                    onClick={() => isMyTurn && !isWinnerDeclared && handleDraw('deck')}
                    className={`relative w-16 h-24 lg:w-24 lg:h-36 border-2 rounded-lg transition-transform duration-300 ${
                      isMyTurn && !isWinnerDeclared
                        ? 'border-indigo-400 bg-slate-950 hover:scale-105 active:scale-95 cursor-pointer shadow-2xl shadow-indigo-500/10' 
                        : 'border-slate-800 bg-slate-950/40 select-none cursor-not-allowed'
                    }`}
                  >
                    {/* Visual cards back stack for depth */}
                    <div className="absolute inset-x-0 bottom-0 top-0 bg-[#4c0d6d] transform translate-x-1 translate-y-1 border border-purple-800 rounded-lg -z-20" />
                    <div className="absolute inset-x-0 bottom-0 top-0 bg-[#2b0244] transform translate-x-0.5 translate-y-0.5 border border-purple-900 rounded-lg -z-10" />
                    <div className="absolute inset-0 bg-gradient-to-br from-[#8a1eb0] to-[#1c012b] border border-fuchsia-500/30 rounded-lg flex flex-col items-center justify-center text-white font-mono font-black shadow-lg">
                      <span className="text-[11px] lg:text-lg tracking-tighter text-fuchsia-200">RUMMY</span>
                      <span className="text-[7px] lg:text-[7.5px] tracking-wider uppercase opacity-75 mt-0.5 text-fuchsia-300 font-extrabold text-center px-1">TAP DRAW</span>
                    </div>
                  </div>
                </div>

                {/* 2. Discard Pile (Face Up Top) */}
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  <span className="text-[9px] font-mono text-purple-200/50 font-black uppercase tracking-widest font-bold">Discard Pile</span>
                  {topDiscardCard ? (
                    <div className="w-16 h-24 lg:w-24 lg:h-36 relative hover:scale-105 transition-transform duration-200">
                      <div className="absolute top-0 left-0 flex items-center gap-2 transform scale-[0.66] origin-top-left lg:scale-100 lg:origin-center">
                        <CardVisual 
                          card={topDiscardCard} 
                          onClick={() => isMyTurn && !isWinnerDeclared && handleDraw('discard')} 
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="w-16 h-24 lg:w-24 lg:h-36 rounded-lg border-2 border-dashed border-purple-550 bg-purple-950/20 flex items-center justify-center text-purple-300/40 font-mono text-center text-[9px] lg:text-xs p-1 lg:p-2 select-none uppercase font-bold tracking-tight leading-tight">
                      Empty Discard
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT ACTION: Claim Wild Card */}
              {game.status === 'playing' && (
                <button
                  onClick={handleClaimWildCard}
                  id="claim-wildcards-btn"
                  disabled={isWinnerDeclared}
                  className="shrink-0 px-2 sm:px-3 py-2 sm:py-3 bg-amber-600/15 hover:bg-amber-600 text-amber-450 hover:text-slate-950 border border-amber-500/20 font-sans text-[9px] sm:text-[10px] lg:text-xs font-bold rounded-xl transition flex items-center gap-1 sm:gap-1.5 active:scale-95 cursor-pointer shadow whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex flex-col items-start leading-tight">
                    <span>Claim</span>
                    <span>Wild</span>
                  </div>
                </button>
              )}


            </div>

        {/* ACTIVE HAND PLAYER ROWS */}
        {game.status === 'playing' || ((game.status === 'round_finished' || game.status === 'finished') && hideRoundSummary) ? (
          <div className="flex flex-col gap-2 shrink-0 z-20">
            {(() => {
              const currentHandGroupsCards = localGroups.map(grp => myHandCards.filter(c => grp.includes(c.id)));
              const currentBreakdown = calculateDetailedScoreBreakdown(currentHandGroupsCards, game.wildCardRank, game.wildCardSuit);
              const currentPenalty = currentBreakdown.penaltyPoints;
              return (
                <span className="text-[10px] font-mono text-white/90 uppercase tracking-widest font-extrabold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-505 animate-pulse" /> Cards in Hand ({myHandCards.length}) - Current Points: {currentPenalty}
                </span>
              );
            })()}
            
            <div className="flex flex-col items-center justify-center gap-1 md:gap-4 shrink-0 pb-2 z-20">
              <div id="hand-groups-container" className="flex flex-row items-center justify-center flex-wrap gap-x-0.5 lg:gap-x-6 gap-y-2 lg:gap-y-12 pb-1 pt-1 px-0.5 lg:px-2 bg-transparent w-full">
                {localGroups.map((grp, grpIdx) => {
                  const grpCards = myHandCards.filter(c => grp.includes(c.id));
                  if (grpCards.length === 0) return null;

                  // Evaluate if pure sequence, impure sequence, or set
                  const isPure = isValidPureSequence(grpCards);
                  const isImpure = isValidImpureSequence(grpCards);
                  const isSetMeld = isValidSet(grpCards);
                  let label = "INVALID";
                  let isSuccess = false;
                  if (isPure) {
                    label = "Pure Sequence";
                    isSuccess = true;
                  } else if (isImpure) {
                    label = "Sequence";
                    isSuccess = true;
                  } else if (isSetMeld) {
                    label = "Set";
                    isSuccess = true;
                  }

                  return (
                    <React.Fragment key={`grp-${grpIdx}`}>
                      {grpIdx > 0 && (
                        <div className="w-[2px] h-[72px] bg-slate-800/80 rounded-full mx-1 shrink-0" />
                      )}
                      <div 
                        data-group-idx={grpIdx}
                      onDragOver={(e) => !isWinnerDeclared && e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (hasViewerDeclared) return;
                        const draggedId = parseInt(e.dataTransfer.getData("cardId"), 10);
                        if (!isNaN(draggedId)) {
                          handleMoveCardToGroup(draggedId, grpIdx);
                        }
                      }}
                      className="flex flex-col items-center gap-1 relative shrink-0"
                    >
                      <div className="flex flex-row items-center pb-1 pt-2">
                        {grpCards.map((c, idx) => {
                          const isSelected = selectedCardIds.includes(c.id);
                          const isLastSelected = selectedCardIds.length > 0 && selectedCardIds[selectedCardIds.length - 1] === c.id;
                          
                          return (
                            <div 
                              key={c.id} 
                              data-card-id={c.id}
                              data-group-idx={grpIdx}
                              draggable={!hasViewerDeclared}
                              onDragStart={(e) => {
                                e.dataTransfer.setData("cardId", String(c.id));
                                e.dataTransfer.setData("sourceGroupIdx", String(grpIdx));
                              }}
                              onDragOver={(e) => !hasViewerDeclared && e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (hasViewerDeclared) return;
                                const draggedId = parseInt(e.dataTransfer.getData("cardId"), 10);
                                if (!isNaN(draggedId)) {
                                  handleCardDropOnCard(draggedId, c.id, grpIdx);
                                }
                              }}
                              onTouchStart={(e) => {
                                (e.currentTarget as any)._touchStarted = true;
                              }}
                              onTouchEnd={(e) => {
                                if ((e.currentTarget as any)._touchStarted) {
                                  handleTouchEnd(e, c.id, grpIdx);
                                  (e.currentTarget as any)._touchStarted = false;
                                }
                              }}
                              className={`relative transition-all duration-200 ${!isWinnerDeclared ? 'cursor-grab active:cursor-grabbing hover:-translate-y-3 hover:z-50' : ''} ${isSelected ? '-translate-y-4 shadow-xl' : ''} ${idx === 0 ? '' : 'ml-[-32px] lg:ml-[-40px]'}`}
                              style={{ 
                                  zIndex: isSelected ? 999 : idx + 2
                                }}
                            >
                              <CardVisual
                                card={c}
                                size="sm"
                                isSelected={isSelected}
                                onClick={() => !isWinnerDeclared && handleCardClick(c.id)}
                              />
                              
                              {/* Overlay popup for actions on select */}
                              {isLastSelected && !isWinnerDeclared && (
                                <div className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 bg-slate-950/95 border border-slate-800 p-2 rounded-xl shadow-2xl flex flex-col gap-1.5 z-50 min-w-[140px] animate-fade-in text-center text-xs text-white">
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-slate-950 border-r border-b border-slate-800 rotate-45" />

                                  {selectedCardIds.length === 1 ? (
                                    <>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDiscard();
                                        }}
                                        disabled={!isMyTurn || myHandCards.length < 14}
                                        className="w-full px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-900 disabled:text-slate-600 rounded-lg text-[10px] font-black leading-none cursor-pointer flex items-center justify-center gap-1 active:scale-95 transition"
                                      >
                                        Discard
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleGroupSelected();
                                      }}
                                      className="w-full px-2.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-black leading-none cursor-pointer flex items-center justify-center gap-1 active:scale-95 transition"
                                    >
                                      Group Cards
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      
                      <div className="flex items-center justify-center gap-1 text-[10px] sm:text-xs font-sans font-bold tracking-wide select-none drop-shadow-md">
                        {isSuccess ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 drop-shadow shadow-black fill-emerald-950" />
                        ) : (
                          <X className="w-3 h-3 text-rose-500 drop-shadow shadow-black" />
                        )}
                        <span className={isSuccess ? "text-emerald-100 drop-shadow-sm" : "text-rose-400 drop-shadow-sm"}>
                          {label}
                        </span>
                      </div>
                    </div>
                    </React.Fragment>
                  );
                })}

              </div>

              {/* ACTION CALL-TO-ACTION AREA */}
              <div className="shrink-0 flex items-center justify-center md:self-center min-w-[140px] px-1">
                {isWinnerDeclared && !hasViewerDeclared ? (
                  <button
                    onClick={() => setShowDeclareConfirm(true)}
                    className="w-full md:w-auto px-6 py-5 font-sans font-black tracking-widest uppercase text-xs rounded-2xl shadow-lg transition-all border bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 active:scale-95 text-white hover:shadow-orange-500/20 cursor-pointer border-orange-400/20 animate-pulse"
                  >
                    DECLARE HAND
                  </button>
                ) : hasViewerDeclared ? (
                  <div className="text-center bg-slate-900/50 border border-slate-700/50 rounded-2xl px-6 py-4 flex flex-col items-center">
                    <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-widest mb-1 animate-pulse">Declared</span>
                    <span className="text-xs font-sans text-slate-400 font-medium">Waiting for others...</span>
                  </div>
                ) : isMyTurn && myHandCards.length >= 14 ? (
                  <button
                    disabled={selectedCardIds.length !== 1}
                    onClick={() => {
                      if (selectedCardIds.length === 1) {
                        setShowDeclareConfirm(true);
                      }
                    }}
                    className={`w-full md:w-auto px-6 py-5 font-sans font-black tracking-widest uppercase text-xs rounded-2xl shadow-lg transition-all border ${
                      selectedCardIds.length === 1
                        ? 'bg-gradient-to-r from-pink-500 to-rose-600 hover:from-pink-600 hover:to-rose-700 active:scale-95 text-white hover:shadow-pink-500/20 cursor-pointer border-pink-400/20'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed border-slate-700/50'
                    }`}
                  >
                    DECLARE GAME
                  </button>
                ) : (
                  <button
                    onClick={() => isMyTurn && setShowDropConfirm(true)}
                    disabled={!isMyTurn}
                    className={`w-full md:w-auto px-6 py-5 font-sans font-black tracking-widest uppercase text-xs rounded-2xl shadow-md transition border ${
                      isMyTurn 
                        ? 'bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 active:scale-95 text-rose-450 cursor-pointer border-slate-700/20' 
                        : 'bg-slate-900/50 text-slate-600 cursor-not-allowed border-slate-800/50'
                    }`}
                  >
                    DROP ROUND
                  </button>
                )}
              </div>
            </div>

            {/* Below Table Camera Boxes */}
            {game.status === 'playing' && Object.keys(playerStreams).length > 0 && (
              <div className="w-full max-w-4xl mx-auto flex flex-wrap justify-center gap-4 py-8">
                {players.map(p => {
                  const pStream = playerStreams[p.id];
                  // Only render if they are broadcasting video OR they are the local player
                  if (!pStream || !pStream.stream) return null;
                  if (!pStream.videoEnabled) return null;

                  const isLocal = p.id === viewerPlayerId;
                  
                  return (
                    <div key={p.id} className="relative w-40 h-52 sm:w-48 sm:h-64 rounded-2xl overflow-hidden shadow-2xl shadow-black/50 border border-slate-700/50 bg-slate-900 group">
                      <VideoPlayer stream={pStream.stream} isLocal={isLocal} />
                      
                      <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-slate-950/90 to-transparent">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shadow-sm ${pStream.speaking ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                          <span className="text-white font-sans font-black tracking-wider text-sm drop-shadow-md">
                            {p.username} {isLocal && <span className="text-slate-400 text-[10px] ml-1">YOU</span>}
                          </span>
                        </div>
                      </div>
                      
                      {pStream.speaking && (
                        <div className="absolute inset-0 rounded-2xl border-2 border-emerald-500/50 pointer-events-none" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        ) : (
            <div className="flex flex-col gap-6">
              
              {/* Modern Round Leaderboard */}
              <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 shadow-xl flex flex-col gap-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5">
                  <Award className="w-5 h-5 text-amber-500 animate-bounce" />
                  <div>
                    <h3 className="text-sm font-sans font-extrabold uppercase tracking-widest text-[#f59e0b]">Round Summary & Leaderboard</h3>
                    <p className="text-[10px] uppercase font-mono text-slate-400 font-bold">Winner is determined by highest Net Score</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-sans text-slate-300">
                    <thead>
                      <tr className="border-b border-slate-800 font-mono text-[10px] uppercase text-slate-550 tracking-wider">
                        <th className="py-2.5 px-3">Rank</th>
                        <th className="py-2.5 px-3">Player</th>
                        <th className="py-2.5 px-3 text-right">Net Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const leaderboardData = sortedPlayers.map(p => {
                          const playerHandCards = cards.filter(c => c.ownerPlayerId === p.id && c.location === 'hand');
                          const groupsMap: Record<string, CardType[]> = {};
                          const ungrouped: CardType[] = [];

                          for (const c of playerHandCards) {
                            if (c.declaredGroupId) {
                              if (!groupsMap[c.declaredGroupId]) {
                                groupsMap[c.declaredGroupId] = [];
                              }
                              groupsMap[c.declaredGroupId].push(c);
                            } else {
                              ungrouped.push(c);
                            }
                          }

                          const groups = Object.values(groupsMap);
                          if (ungrouped.length > 0) {
                            groups.push(ungrouped);
                          }

                          const breakdown = calculateDetailedScoreBreakdown(groups, game.wildCardRank, game.wildCardSuit);
                          const isDeclarantWinner = p.id === game.winnerPlayerId;
                          const currentPoints = isDeclarantWinner ? 0 : breakdown.penaltyPoints;

                          return {
                            player: p,
                            isWinner: isDeclarantWinner,
                            currentPoints,
                            netScore: p.netScore
                          };
                        });

                        leaderboardData.sort((a, b) => a.netScore - b.netScore);

                        return leaderboardData.map((entry, rIdx) => {
                          const isWinnerRow = rIdx === 0;
                          return (
                            <tr key={`rank-${entry.player.id}`} className={`border-b border-slate-900 transition hover:bg-slate-900/40 ${isWinnerRow ? 'text-emerald-400 font-bold bg-emerald-500/5' : ''}`}>
                              <td className="py-3 px-3 font-mono text-slate-300 font-bold">
                                {rIdx === 0 ? (
                                  <span className="flex items-center gap-1">🥇 1st</span>
                                ) : rIdx === 1 ? (
                                  "🥈 2nd"
                                ) : rIdx === 2 ? (
                                  "🥉 3rd"
                                ) : (
                                  `${rIdx + 1}th`
                                )}
                              </td>
                              <td className="py-3 px-3 flex items-center gap-2">
                                <span className="font-sans text-slate-100">{entry.player.username}</span>
                                {entry.isWinner && (
                                  <span className="text-[9px] font-mono font-black bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded uppercase">ROUND WINNER</span>
                                )}
                                {entry.player.hasDropped && (
                                  <span className="text-[9px] font-mono font-black bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded uppercase">DROPPED</span>
                                )}
                              </td>
                              <td className="py-3 px-3 font-mono text-right font-black">{entry.netScore} pts</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                  {game.status === 'round_finished' && (
                    <div className="flex justify-end items-center gap-3 p-4 border-t border-slate-800">
                      <button onClick={() => setHideRoundSummary(true)} className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold tracking-widest uppercase text-xs rounded-lg transition border border-slate-700">
                        Go To Table
                      </button>
                      {game.dealerPlayerId === viewerPlayerId && (
                        <button onClick={handleDealNextRound} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black tracking-widest uppercase text-xs rounded-lg transition shadow-lg shadow-emerald-600/20">
                          Deal Next Round
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Round History Table */}
              {roundScores && roundScores.length > 0 && (
                <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 shadow-xl flex flex-col gap-4">
                  <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5">
                    <History className="w-5 h-5 text-indigo-400" />
                    <div>
                      <h3 className="text-sm font-sans font-extrabold uppercase tracking-widest text-indigo-400">Round History</h3>
                      <p className="text-[10px] uppercase font-mono text-slate-400 font-bold">Past round scores breakdown</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-sans text-slate-300">
                      <thead>
                        <tr className="border-b border-slate-800 font-mono text-[10px] uppercase text-slate-550 tracking-wider">
                          <th className="py-2.5 px-3">Round</th>
                          <th className="py-2.5 px-3">Player</th>
                          <th className="py-2.5 px-3 text-right">Points Added</th>
                          <th className="py-2.5 px-3 text-right">Cumulative Net Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roundScores.slice().sort((a, b) => b.roundNumber - a.roundNumber || a.playerId - b.playerId).map((rs) => {
                          const player = players.find(p => p.id === rs.playerId);
                          const isDropped = !rs.isWinner && (rs.currentPoints === 20 || rs.currentPoints === 40);
                          return (
                            <tr key={`rs-${rs.id}`} className="border-b border-slate-900 transition hover:bg-slate-900/40">
                              <td className="py-2 px-3 font-mono text-slate-400">Round {rs.roundNumber}</td>
                              <td className="py-2 px-3">
                                <span className="font-sans text-slate-200">{player?.username || 'Unknown'}</span>
                                {rs.isWinner && <span className="ml-2 text-[8px] font-mono font-black bg-amber-500/20 text-amber-500 px-1 py-0.5 rounded uppercase">Winner</span>}
                                {isDropped && <span className="ml-2 text-[8px] font-mono font-black bg-orange-500/20 text-orange-400 px-1 py-0.5 rounded uppercase">Dropped</span>}
                              </td>
                              <td className="py-2 px-3 font-mono text-right text-rose-400">+{rs.currentPoints}</td>
                              <td className="py-2 px-3 font-mono text-right font-bold text-slate-200">{rs.netScoreAfter}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Individual Auditing Panels */}
              <h3 className="text-sm font-mono text-emerald-400 uppercase tracking-widest font-black border-b border-emerald-500/20 pb-2">Revealed Players Hands & Combos</h3>
              
              {sortedPlayers.map(p => {
                const playerHandCards = cards.filter(c => c.ownerPlayerId === p.id && c.location === 'hand');
                
                // Segment them to calculate melds
                const groupsMap: Record<string, CardType[]> = {};
                const ungrouped: CardType[] = [];

                for (const c of playerHandCards) {
                  if (c.declaredGroupId) {
                    if (!groupsMap[c.declaredGroupId]) {
                      groupsMap[c.declaredGroupId] = [];
                    }
                    groupsMap[c.declaredGroupId].push(c);
                  } else {
                    ungrouped.push(c);
                  }
                }

                const groups = Object.values(groupsMap);
                if (ungrouped.length > 0) {
                  groups.push(ungrouped);
                }

                const breakdown = calculateDetailedScoreBreakdown(groups, game.wildCardRank, game.wildCardSuit);
                const isDeclarantWinner = p.id === game.winnerPlayerId;
                const finalPenalty = isDeclarantWinner ? 0 : breakdown.penaltyPoints;
                const finalNetScore = isDeclarantWinner ? breakdown.totalPointsEarned : breakdown.netScore;

                return (
                  <div key={`revealed-${p.id}`} className="bg-slate-900 border border-slate-850 p-5 rounded-2xl flex flex-col gap-4 shadow-lg">
                    {/* Panel Header */}
                    <div className="flex justify-between items-center border-b border-slate-850 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-505" />
                        <h4 className="text-sm font-sans font-extrabold text-slate-100">{p.username}&apos;s Hand Report</h4>
                      </div>
                      <div className="flex gap-3 text-[11px] font-mono">
                        <span className="text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                          Penalty: {finalPenalty} pts
                        </span>
                      </div>
                    </div>

                    {/* Detailed melds calculated breakdown */}
                    <div className="flex flex-col gap-3">
                      {(() => {
                        const validMelds = breakdown.melds.filter(m => m.type !== 'unmelded');
                        const mismatchMelds = breakdown.melds.filter(m => m.type === 'unmelded');
                        const mismatchPenalty = mismatchMelds.reduce((sum, m) => sum + m.cardValuesSum, 0);

                        return (
                          <>
                            {validMelds.length > 0 && (
                              <div className="p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-sky-950/10 border-sky-500/30">
                                <div className="flex flex-col gap-2 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[9px] font-mono font-bold bg-sky-500/20 text-sky-400 px-1.5 py-0.5 rounded uppercase">Set</span>
                                    <span className="text-xs font-sans text-slate-300 font-medium">Valid Groups</span>
                                  </div>
                                  
                                  <div className="flex flex-wrap gap-4 pt-1">
                                    {validMelds.map((meld, mIdx) => (
                                      <div key={`valid-group-${mIdx}`} className="flex flex-wrap gap-1.5 bg-black/20 p-2 border border-slate-800 rounded-lg">
                                        {meld.cards.map(c => {
                                          const isWild = c.rank === game.wildCardRank || c.suit === 'joker' || c.rank === 'joker' || c.isWild || c.isHiddenWild;
                                          return (
                                            <div key={c.id} className="relative group">
                                              <CardVisual card={c} size="sm" />
                                              {isWild && (
                                                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-yellow-500/95 text-slate-950 font-black font-mono text-[7px] px-1 py-0.2 rounded-full shadow border border-slate-950 whitespace-nowrap">
                                                  WILD (0pts)
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="text-right font-mono self-end sm:self-center shrink-0">
                                  <span className="text-emerald-400 font-bold">0 pts</span>
                                </div>
                              </div>
                            )}

                            {mismatchMelds.length > 0 && (
                              <div className="p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-rose-950/5 border-rose-500/15">
                                <div className="flex flex-col gap-2 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[9px] font-mono font-bold bg-rose-500/15 text-rose-400 px-1.5 py-0.5 rounded uppercase">Mismatch</span>
                                    <span className="text-xs font-sans text-slate-300 font-medium">Ungrouped / Invalid Cards</span>
                                  </div>
                                  
                                  <div className="flex flex-wrap gap-4 pt-1">
                                    {mismatchMelds.map((meld, mIdx) => (
                                      <div key={`invalid-group-${mIdx}`} className="flex flex-wrap gap-1.5 bg-rose-950/20 p-2 border border-rose-900/30 rounded-lg">
                                        {meld.cards.map(c => {
                                          const isWild = c.rank === game.wildCardRank || c.suit === 'joker' || c.rank === 'joker' || c.isWild || c.isHiddenWild;
                                          return (
                                            <div key={c.id} className="relative group">
                                              <CardVisual card={c} size="sm" />
                                              {isWild && (
                                                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-yellow-500/95 text-slate-950 font-black font-mono text-[7px] px-1 py-0.2 rounded-full shadow border border-slate-950 whitespace-nowrap">
                                                  WILD (0pts)
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="text-right font-mono self-end sm:self-center shrink-0">
                                  <span className="text-rose-400 font-bold">-{mismatchPenalty} pts penalty</span>
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          </div> {/* CLOSE GREEN FELT TABLE */}

        </div>

      </div>
      {/* Verifier Modal Popup */}
      {activeClaim && activeClaim.status === 'pending' && activeClaim.verifierPlayerId === viewerPlayerId && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border-2 border-indigo-500 rounded-3xl shadow-2xl shadow-indigo-500/20 max-w-lg w-full flex flex-col overflow-hidden">
            <div className="bg-indigo-950 p-6 border-b border-indigo-500/30 flex items-center gap-4">
              <div className="bg-amber-500/20 p-3 rounded-full">
                <AlertCircle className="w-8 h-8 text-amber-400 animate-pulse" />
              </div>
              <div>
                <h2 className="text-xl font-sans font-black text-white uppercase tracking-wider">Verification Required</h2>
                <p className="text-xs font-mono text-indigo-300 mt-1">
                  <span className="font-bold text-amber-400">{players.find(p => p.id === activeClaim.claimantPlayerId)?.username || 'A player'}</span> claims to have 4 cards of the same rank. Do you approve this claim?
                </p>
              </div>
            </div>
            
            <div className="p-8 flex flex-col items-center gap-6">
              <div className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest">Submitted Cards</div>
              <div className="flex flex-row justify-center gap-2 md:gap-4 flex-wrap">
                {(() => {
                  const payload = activeClaim.cardIds as any;
                  const handIds = payload?.hand || [];
                  const verifierCards = cards.filter(c => handIds.includes(c.id));
                  return verifierCards.map((c, i) => (
                    <div key={i} className="animate-fade-in" style={{ animationDelay: `${i * 100}ms` }}>
                      <CardVisual card={c} size="md" />
                    </div>
                  ));
                })()}
              </div>
            </div>
            
            <div className="bg-slate-950 p-6 flex flex-col sm:flex-row items-center gap-4 border-t border-slate-800">
              <button 
                onClick={() => handleRejectClaim(activeClaim.id)} 
                className="w-full sm:w-auto flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-rose-400 font-bold tracking-widest text-sm uppercase rounded-xl transition-colors"
              >
                Reject Claim
              </button>
              <button 
                onClick={() => handleApproveClaim(activeClaim.id)} 
                className="w-full sm:w-auto flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold tracking-widest text-sm uppercase rounded-xl shadow-lg shadow-emerald-600/20 transition-transform active:scale-95"
              >
                Approve & Finalize
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Declare/Finish Confirmation Modal */}
      {showDeclareConfirm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl flex flex-col gap-4 animate-scale-up">
            <h3 className="text-xl font-sans font-black text-rose-500 uppercase tracking-wide">
              {isWinnerDeclared ? "Declare Hand" : "Confirm Declare"}
            </h3>
            <p className="text-sm font-sans text-slate-300">
              {isWinnerDeclared 
                ? "Are you sure you want to declare your hand with the current groups? Your penalty points will be finalized." 
                : "Are you sure you want to finish the game with the selected card as the finish card?"}
            </p>
            
            <div className="bg-slate-950 rounded-xl p-4 max-h-48 overflow-y-auto border border-slate-800">
              <h4 className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">Your Groups</h4>
              <div className="flex flex-col gap-3">
                {localGroups.map((grpIds, idx) => {
                  const grpCards = grpIds.map(id => cards.find(c => c.id === id)).filter(Boolean) as CardType[];
                  if (grpCards.length === 0) return null;
                  return (
                    <div key={idx} className="flex flex-row flex-wrap gap-1 items-center bg-slate-900/50 p-2 rounded-lg border border-slate-800/50">
                      {grpCards.map(c => (
                        <div key={c.id} className="transform scale-75 origin-left -mr-4">
                          <CardVisual card={c} size="sm" />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => setShowDeclareConfirm(false)}
                className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider rounded-xl transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDeclareConfirm(false);
                  onEmit("declareGame", { 
                    mels: localGroups,
                    finishCardId: isWinnerDeclared ? undefined : selectedCardIds[0] 
                  }, (resp: any) => {
                    if (resp && resp.error) {
                      setActionError(resp.error);
                    } else {
                      setSuccessInfo(isWinnerDeclared ? "Hand declared successfully." : "You have declared the game!");
                      setSelectedCardIds([]);
                    }
                  });
                }}
                className="flex-1 px-4 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-lg shadow-rose-600/20"
              >
                {isWinnerDeclared ? "Submit Hand" : "Confirm Declare"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drop Round Confirmation Modal */}
      {showDropConfirm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl flex flex-col gap-4 animate-scale-up">
            <h3 className="text-xl font-sans font-black text-rose-500 uppercase tracking-wide">Confirm Drop</h3>
            <p className="text-sm font-sans text-slate-300">
              Are you sure you want to drop out of this round?
            </p>
            <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl flex items-center justify-between">
              <span className="text-xs font-mono text-rose-300 uppercase tracking-widest font-bold">Penalty Score</span>
              <span className="text-2xl font-black text-rose-500">
                +{(() => {
                  const hasDiscardedThisRound = recentEvents.some(e => e.eventType === 'discard' && e.playerId === viewerPlayerId);
                  return (myHandCards.length > 13 || hasDiscardedThisRound) ? 40 : 20;
                })()}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-mono text-center">
              {(() => {
                const hasDiscardedThisRound = recentEvents.some(e => e.eventType === 'discard' && e.playerId === viewerPlayerId);
                return (myHandCards.length > 13 || hasDiscardedThisRound) ? "Middle Drop: You have already participated in this round." : "Initial Drop: You haven't drawn a card yet.";
              })()}
            </p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => setShowDropConfirm(false)}
                className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider rounded-xl transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDropConfirm(false);
                  onEmit("dropRound", {}, (resp: any) => {
                    if (resp && resp.error) {
                      setActionError(resp.error);
                    } else {
                      setSuccessInfo(`You have dropped the round. Waiting for others to finish.`);
                    }
                  });
                }}
                className="flex-1 px-4 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-lg shadow-rose-600/20"
              >
                Drop Round
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Error Popup Modal */}
      {actionError && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in zoom-in duration-200">
          <div className="bg-slate-900 border border-rose-500/50 rounded-2xl shadow-2xl shadow-rose-500/20 p-6 max-w-sm w-full flex flex-col items-center text-center">
            <div className="w-14 h-14 bg-rose-500/20 text-rose-500 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-black font-sans text-white uppercase tracking-wider mb-2">Action Error</h2>
            <p className="text-slate-300 text-sm mb-6 leading-relaxed">
              {actionError}
            </p>
            <button 
              onClick={() => setActionError(null)}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition border border-slate-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Global Success Popup Modal Removed per user request */}
    </div>
  );
};

// Generic small helper icons
const ConfirmIcon = (props: any) => (
  <Archive className={props.className} />
);
