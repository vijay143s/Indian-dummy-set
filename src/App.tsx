import { useState, useEffect } from 'react';
import { AuthUser, GameStateResponse } from './types.ts';
import { io, Socket } from 'socket.io-client';
import { LobbyPortal } from './components/LobbyPortal.tsx';
import { GameBoard } from './components/GameBoard.tsx';
import { LogOut, Wifi, WifiOff, RefreshCw } from 'lucide-react';

let socketInstance: Socket | null = null;

export default function App() {
  const [connected, setConnected] = useState(false);

  // Active game states
  const [gameId, setGameId] = useState<number | null>(() => {
    const cached = localStorage.getItem("ds_last_game_id");
    return cached ? parseInt(cached, 10) : null;
  });
  const [gameState, setGameState] = useState<GameStateResponse | null>(null);

  // Notification states
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Whenever socket connects or gameId is available, trigger safe reconnection/room synchronization
  useEffect(() => {
    if (connected && gameId) {
      const mobile = localStorage.getItem('ds_mobile');
      if (mobile) {
        console.log("Triggering auto-reconnection/sync for game ID:", gameId);
        handleReconnection(mobile, gameId);
      }
    }
  }, [connected, gameId]);

  // Manage Socket.IO instance and connection status with server
  useEffect(() => {
    // Establish connection to the current origin (Express + Socket.IO server)
    const socket = io({
      autoConnect: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 20
    });

    socketInstance = socket;

    socket.on("connect", () => {
      setConnected(true);
      console.log("Real-time Socket.IO channel opened:", socket.id);
    });

    socket.on("disconnect", () => {
      setConnected(false);
      console.log("Real-time Socket.IO channel disconnected.");
    });

    socket.on("gameState", (syncedState: GameStateResponse) => {
      setGameState(syncedState);
    });

    return () => {
      socket.disconnect();
      socketInstance = null;
    };
  }, []);

  // Securely emit socket message events carrying callbacks
  const handleEmit = (event: string, data: any = {}, callback?: (resp: any) => void) => {
    if (!socketInstance || !connected) {
      setErrorMsg("Socket is currently disconnected. Retrying...");
      return;
    }
    socketInstance.emit(event, data, callback);
  };

  // Passive auto-reconnection trigger
  const handleReconnection = async (mobile: string, cachedGameId: number) => {
    if (!socketInstance) return;
    try {
      // NOTE: We used to send token here, but now backend expects `mobile`.
      // We will need to update server.ts to expect mobile instead of token for reconnecting.
      socketInstance.emit("reconnectPlayer", { mobile, gameId: cachedGameId }, (resp: any) => {
        if (resp && resp.success) {
          setGameId(cachedGameId);
        } else {
          // Stale cache
          localStorage.removeItem("ds_last_game_id");
          setGameId(null);
          setGameState(null);
        }
      });
    } catch (e) {
      console.error("Reconnection authentication failed:", e);
    }
  };

  // Join existing lobby action
  const handleJoinGame = async (code: string, mobile: string, name: string) => {
    if (!socketInstance) {
      setErrorMsg("Unable to join: Connection currently inactive.");
      return;
    }

    try {
      socketInstance.emit("joinLobby", { mobile, gameCode: code, username: name }, (resp: any) => {
        if (resp && resp.error) {
          setErrorMsg(resp.error);
        } else if (resp && resp.success) {
          setErrorMsg(null);
          setGameId(resp.gameId);
          localStorage.setItem("ds_last_game_id", resp.gameId.toString());
        }
      });
    } catch (e) {
      setErrorMsg("Failed to verify credentials during match join.");
    }
  };

  // Create new lobby action (Host)
  const handleCreateGame = async (mobile: string, name: string, maxScore: number, gameAmount: number, gameType: string = 'dummy_set') => {
    if (!socketInstance) {
      setErrorMsg("Unable to create game: Connection currently inactive.");
      return;
    }

    try {
      socketInstance.emit("createLobby", { mobile, username: name, maxScore, gameAmount, gameType }, (resp: any) => {
        if (resp && resp.error) {
          setErrorMsg(resp.error);
        } else if (resp && resp.success) {
          setErrorMsg(null);
          // Lobby successfully created on backend, join it next using the generated unique code
          handleJoinGame(resp.gameCode, mobile, name);
        }
      });
    } catch (e) {
      setErrorMsg("Failed to verify credentials during lobby host setup.");
    }
  };

  // Exit game and clear cached sessions
  const handleExitGame = () => {
    localStorage.removeItem("ds_last_game_id");
    setGameId(null);
    setGameState(null);
    setErrorMsg(null);
    if (socketInstance) {
      // Direct hard socket recycle to clear server registration
      socketInstance.disconnect();
      socketInstance.connect();
    }
  };

  const handleLogout = () => {
    handleExitGame();
    localStorage.removeItem("ds_mobile");
    localStorage.removeItem("ds_name");
  };

  return (
    <div id="main-view" className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col justify-between selection:bg-indigo-600 selection:text-white pb-6">
      
      {/* Universal Top Branding & Auth Navigation */}
      {!gameState && (
        <nav id="navbar" className="w-full bg-slate-900 border-b border-slate-800/80 p-4 sticky top-0 z-50 shadow-md">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center font-bold text-white shadow-md">
              <span className="text-sm font-black tracking-lighter font-mono">DS</span>
            </div>
            <span className="font-sans font-black text-sm tracking-widest text-white uppercase select-none">
              DUMMY SET
            </span>
            <div className="flex items-center gap-1">
              {connected ? (
                <div className="flex items-center gap-1.5 text-[9px] bg-emerald-500/10 text-emerald-400 font-mono px-2 py-0.5 rounded border border-emerald-500/20 font-bold uppercase tracking-wider leading-none">
                  <Wifi className="w-3 h-3" strokeWidth={3} /> LIVE
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[9px] bg-rose-500/10 text-rose-400 font-mono px-2 py-0.5 rounded border border-rose-500/20 font-bold uppercase tracking-wider leading-none">
                  <WifiOff className="w-3 h-3" strokeWidth={3} /> OFFLINE
                </div>
              )}
            </div>
          </div>

          {localStorage.getItem('ds_mobile') && (
            <div className="flex items-center gap-4">
              <span className="text-xs font-mono text-slate-500 select-none hidden sm:block">
                Player: <strong className="text-slate-300 font-bold">{localStorage.getItem('ds_name') || 'Guest'}</strong>
              </span>
              <button
                onClick={handleLogout}
                id="logout-btn"
                className="flex items-center gap-1.5 py-1.5 px-3 bg-slate-800 hover:bg-slate-705 text-xs text-slate-300 font-sans font-bold rounded-lg border border-slate-700 transition"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>
            </div>
          )}
        </div>
      </nav>
      )}

      {/* Primary Container View */}
      <main className={`flex-1 flex items-center justify-center ${!gameState ? 'p-4 py-8' : 'p-0'}`}>
        {!gameState ? (
          <LobbyPortal
            onJoinGame={handleJoinGame}
            onCreateGame={handleCreateGame}
            errorMsg={errorMsg}
          />
        ) : (
          <GameBoard
            gameState={gameState}
            myPlayerId={gameState.viewerPlayerId}
            onEmit={handleEmit}
            onExit={handleExitGame}
            socket={socketInstance}
          />
        )}
      </main>

      {/* Footer copyright */}
      {!gameState && (
        <footer className="w-full text-center text-[10px] text-slate-600 font-mono mt-8 select-none">
          &copy; {new Date().getFullYear()} INDIAN DUMMY SET. DEPLOYED WITH SECURE TRANSFERS AND MULTIPLAYER SYNC.
        </footer>
      )}
    </div>
  );
}
