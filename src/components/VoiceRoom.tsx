import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, Volume2, VolumeX, Users, Radio, AlertCircle } from 'lucide-react';
import { PlayerType } from '../types.ts';
import { DraggableMuteButton } from './DraggableMuteButton.tsx';

interface VoiceRoomProps {
  socket: any;
  gameId: number;
  viewerPlayerId: number | null;
  players: PlayerType[];
  onToggleLobby?: () => void;
}

interface PeerState {
  socketId: string;
  username: string;
  speaking: boolean;
  muted: boolean;
}

export const VoiceRoom: React.FC<VoiceRoomProps> = ({
  socket,
  gameId,
  viewerPlayerId,
  players,
  onToggleLobby,
}) => {
  const [localMuted, setLocalMuted] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [peers, setPeers] = useState<Record<string, PeerState>>({});
  const [localSpeaking, setLocalSpeaking] = useState(false);

  // Refs for WebRTC resources
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const audioElements = useRef<Record<string, HTMLAudioElement>>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const javascriptNodeRef = useRef<ScriptProcessorNode | null>(null);

  // Map to pair player userId/username with remote WebRTC connection socket IDs
  const socketToUserMapRef = useRef<Record<string, string>>({});

  const currentUser = players.find(p => p.id === viewerPlayerId);

  // Configure WebRTC peer connection configuration (Google STUN is public and free)
  const rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
  };

  useEffect(() => {
    if (!socket) return;

    // Handle incoming WebRTC audio offers
    const handleVoiceOffer = async (data: { senderSocketId: string; offer: RTCSessionDescriptionInit; senderUsername: string; muted?: boolean }) => {
      try {
        console.log("Received voice offer from:", data.senderUsername, data.senderSocketId);
        
        // Update peer list with current muted state
        setPeers(prev => ({
          ...prev,
          [data.senderSocketId]: {
            socketId: data.senderSocketId,
            username: data.senderUsername,
            speaking: false,
            muted: data.muted !== undefined ? data.muted : false
          }
        }));

        let pc = peerConnections.current[data.senderSocketId];
        if (!pc) {
          pc = createPeerConnection(data.senderSocketId, data.senderUsername);
        }

        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Send local muted state back with answer
        socket.emit("voiceAnswer", {
          targetSocketId: data.senderSocketId,
          answer,
          muted: localMuted
        });
      } catch (e: any) {
        console.error("Error setting up remote audio description:", e);
      }
    };

    // Handle incoming answers
    const handleVoiceAnswer = async (data: { senderSocketId: string; answer: RTCSessionDescriptionInit; muted?: boolean }) => {
      try {
        console.log("Received remote voice answer from socket:", data.senderSocketId);
        const pc = peerConnections.current[data.senderSocketId];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
        if (data.muted !== undefined) {
          setPeers(prev => {
            if (!prev[data.senderSocketId]) return prev;
            return {
              ...prev,
              [data.senderSocketId]: {
                ...prev[data.senderSocketId],
                muted: data.muted
              }
            };
          });
        }
      } catch (e) {
        console.error("Error answering incoming connection stream:", e);
      }
    };

    // Handle ICE candidates
    const handleVoiceIceCandidate = async (data: { senderSocketId: string; candidate: RTCIceCandidateInit }) => {
      try {
        const pc = peerConnections.current[data.senderSocketId];
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (e) {
        console.error("Error inserting ICE candidates:", e);
      }
    };

    // Triggered when a new player joins the lobby voice channel
    const handleNewPeer = async (data: { socketId: string; username: string }) => {
      try {
        console.log("A new player joined voice channel:", data.username, data.socketId);
        
        setPeers(prev => ({
          ...prev,
          [data.socketId]: {
            socketId: data.socketId,
            username: data.username,
            speaking: false,
            muted: true // Safe default until handshake replies
          }
        }));

        const pc = createPeerConnection(data.socketId, data.username);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Send current local muted state inside offer
        socket.emit("voiceOffer", {
          targetSocketId: data.socketId,
          offer,
          muted: localMuted
        });
      } catch (e) {
        console.error("Failed creating WebRTC offer for new player connection:", e);
      }
    };

    // Handle peer speaking status
    const handleVoiceSpeaking = (data: { senderSocketId: string; speaking: boolean }) => {
      setPeers(prev => {
        if (!prev[data.senderSocketId]) return prev;
        return {
          ...prev,
          [data.senderSocketId]: {
            ...prev[data.senderSocketId],
            speaking: data.speaking
          }
        };
      });
    };

    // Handle peer mute/unmute status
    const handleVoiceMuted = (data: { senderSocketId: string; muted: boolean }) => {
      setPeers(prev => {
        if (!prev[data.senderSocketId]) return prev;
        return {
          ...prev,
          [data.senderSocketId]: {
            ...prev[data.senderSocketId],
            muted: data.muted
          }
        };
      });
    };

    // Handle server-authoritative voice pool states (handles missing handshakes or WebRTC constraints in sandbox)
    const handleVoiceRoomState = (data: Record<number, { muted: boolean; speaking: boolean; socketId: string; username: string }>) => {
      setPeers(prev => {
        const nextPeers = { ...prev };
        Object.values(data).forEach(srvPeer => {
          if (srvPeer.socketId === socket.id) return;
          
          nextPeers[srvPeer.socketId] = {
            socketId: srvPeer.socketId,
            username: srvPeer.username,
            speaking: srvPeer.speaking,
            muted: srvPeer.muted
          };
        });

        // Clean stale peers which have gone offline
        const serverSocketIds = Object.values(data).map(p => p.socketId);
        Object.keys(nextPeers).forEach(sid => {
          if (!serverSocketIds.includes(sid)) {
            delete nextPeers[sid];
          }
        });

        return nextPeers;
      });
    };

    // Hook listeners
    socket.on("voiceOffer", handleVoiceOffer);
    socket.on("voiceAnswer", handleVoiceAnswer);
    socket.on("voiceIceCandidate", handleVoiceIceCandidate);
    socket.on("newPeerConnected", handleNewPeer);
    socket.on("voiceSpeakingState", handleVoiceSpeaking);
    socket.on("voiceMuteState", handleVoiceMuted);
    socket.on("voiceRoomState", handleVoiceRoomState);

    // Join voice channel immediately
    initializeVoiceStream();

    return () => {
      socket.off("voiceOffer", handleVoiceOffer);
      socket.off("voiceAnswer", handleVoiceAnswer);
      socket.off("voiceIceCandidate", handleVoiceIceCandidate);
      socket.off("newPeerConnected", handleNewPeer);
      socket.off("voiceSpeakingState", handleVoiceSpeaking);
      socket.off("voiceMuteState", handleVoiceMuted);
      socket.off("voiceRoomState", handleVoiceRoomState);
      cleanupVoiceResources();
    };
  }, [socket, gameId]);

  // Synchronize dynamic local speaking status to socket
  useEffect(() => {
    if (socket && isJoined) {
      socket.emit("voiceSpeakingState", { speaking: localSpeaking });
    }
  }, [localSpeaking, isJoined]);

  // Synchronize local mute status to socket
  useEffect(() => {
    if (socket && isJoined) {
      socket.emit("voiceMuteState", { muted: localMuted });
    }
  }, [localMuted, isJoined]);

  // Sets up RTCPeerConnection for a remote peer socket
  const createPeerConnection = (socketId: string, username: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.current[socketId] = pc;

    // Direct local audio track sending
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Exchange connection candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit("voiceIceCandidate", {
          targetSocketId: socketId,
          candidate: event.candidate,
        });
      }
    };

    // Play incoming audio streams in dynamic audio nodes
    pc.ontrack = (event) => {
      console.log("Receiving audio track from:", username);
      const remoteStream = event.streams[0];

      let audio = audioElements.current[socketId];
      if (!audio) {
        audio = document.createElement("audio") as HTMLAudioElement;
        audio.id = `audio-peer-${socketId}`;
        audio.autoplay = true;
        audio.style.display = "none";
        document.body.appendChild(audio);
        audioElements.current[socketId] = audio;
      }
      audio.srcObject = remoteStream;
      audio.play().catch(e => console.error("Auto play sound stream was blocked by browser policies:", e));
    };

    pc.onconnectionstatechange = () => {
      console.log(`WebRTC state change with ${username}:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        removePeerConnection(socketId);
      }
    };

    return pc;
  };

  const removePeerConnection = (socketId: string) => {
    if (peerConnections.current[socketId]) {
      peerConnections.current[socketId].close();
      delete peerConnections.current[socketId];
    }
    if (audioElements.current[socketId]) {
      audioElements.current[socketId].remove();
      delete audioElements.current[socketId];
    }
    setPeers(prev => {
      const copy = { ...prev };
      delete copy[socketId];
      return copy;
    });
  };

  // Setup local microphone stream
  const initializeVoiceStream = async () => {
    try {
      setErrorMessage(null);
      // Request device microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      localStreamRef.current = stream;

      // By default start with MIC MUTED for etiquette
      stream.getAudioTracks().forEach(t => {
        t.enabled = false;
      });

      // Setup audio analyzer to identify local voice patterns
      setupVoiceVolumeAnalyzer(stream);

      setIsJoined(true);
      console.log("Microphone stream successfully linked!");

      // Request handshakes from all current players in room
      if (socket) {
        socket.emit("requestPeerConnections");
      }
    } catch (e: any) {
      console.error("Failed to capture user mic input streams:", e);
      setErrorMessage("Microphone access blocked. Click on site details to allow microphone permissions.");
    }
  };

  // Audio analyzer to monitor voice speaking levels
  const setupVoiceVolumeAnalyzer = (stream: MediaStream) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Auto-unlock AudioContext if suspended due to browser policies
      if (audioContext.state === 'suspended') {
        const resumeCtx = () => {
          audioContext.resume().then(() => {
            console.log("AudioContext resumed on user click interaction.");
          });
          window.removeEventListener('click', resumeCtx);
        };
        window.addEventListener('click', resumeCtx);
      }

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      source.connect(analyser);

      const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);
      analyser.connect(javascriptNode);
      javascriptNode.connect(audioContext.destination);

      javascriptNode.onaudioprocess = () => {
        analyser.getByteFrequencyData(dataArray);
        let values = 0;
        for (let i = 0; i < dataArray.length; i++) {
          values += dataArray[i];
        }
        const average = values / dataArray.length;

        // Speaking threshold (Only triggers when mic is unmuted and audio energy > 18)
        const micTrack = stream.getAudioTracks()[0];
        const isEnabled = micTrack && micTrack.enabled;
        
        if (isEnabled && average > 18) {
          setLocalSpeaking(true);
        } else {
          setLocalSpeaking(false);
        }
      };

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      javascriptNodeRef.current = javascriptNode;
    } catch (e) {
      console.error("Audio analyser failed to trigger:", e);
    }
  };

  // Handle Mute / Unmute triggers
  const toggleMute = () => {
    if (!localStreamRef.current) return;

    const currentMuted = !localMuted;
    setLocalMuted(currentMuted);

    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = !currentMuted;
    });
  };

  // Clean elements and references
  const cleanupVoiceResources = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    // Clear peer connections
    Object.keys(peerConnections.current).forEach(sid => {
      peerConnections.current[sid].close();
    });
    peerConnections.current = {};

    // Clear audio players
    Object.keys(audioElements.current).forEach(sid => {
      audioElements.current[sid].remove();
    });
    audioElements.current = {};

    // Clear Analyzer
    if (javascriptNodeRef.current) javascriptNodeRef.current.disconnect();
    if (analyserRef.current) analyserRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
  };

  return (
    <div className="bg-slate-900/90 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col gap-4">
      {/* Voice header bar */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </div>
          <div>
            <h4 className="text-xs font-sans font-extrabold uppercase tracking-widest text-slate-100 flex items-center gap-1.5">
              Live Voice Lobby
            </h4>
            <p className="text-[9px] font-mono text-slate-400 uppercase">Interactive teams-style audio</p>
          </div>
        </div>

        <button
          onClick={toggleMute}
          disabled={!isJoined}
          id="voice-mute-toggle-btn"
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md duration-200 cursor-pointer ${
            localMuted
              ? 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow shadow-emerald-600/20'
          }`}
        >
          {localMuted ? (
            <>
              <MicOff className="w-3.5 h-3.5 text-rose-400 animate-pulse" /> Unmute Mic
            </>
          ) : (
            <>
              <Mic className="w-3.5 h-3.5 text-white animate-bounce" /> Mute Microphone
            </>
          )}
        </button>
      </div>

      {typeof document !== 'undefined' && document.body && (
        createPortal(
          <DraggableMuteButton 
            isMuted={localMuted} 
            disabled={!isJoined} 
            onClick={() => {
              toggleMute();
            }} 
          />,
          document.body
        )
      )}

      {errorMessage && (
        <div className="flex gap-2 items-start p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl font-sans">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>{errorMessage}</p>
        </div>
      )}

      {/* Voice grid list (Microsoft Teams stylized cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {/* Local user */}
        <div
          className={`p-3 rounded-xl border flex flex-col justify-between h-20 relative transition-all duration-300 ${
            localSpeaking && !localMuted
              ? 'bg-emerald-950/20 border-emerald-500 shadow-lg shadow-emerald-500/10 scale-102 ring-2 ring-emerald-500/20'
              : 'bg-slate-950/40 border-slate-800'
          }`}
        >
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-tight truncate">
              You
            </span>
            {localMuted ? (
              <MicOff className="w-3.5 h-3.5 text-slate-500" />
            ) : localSpeaking ? (
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Mic className="w-3.5 h-3.5 text-slate-400" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${localMuted ? 'bg-slate-700' : localSpeaking ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
            <span className="text-xs font-sans font-black text-slate-200 truncate">{currentUser?.username || "You"}</span>
          </div>
        </div>

        {/* Remote Peers connected */}
        {(Object.values(peers) as PeerState[]).map(peer => (
          <div
            key={peer.socketId}
            className={`p-3 rounded-xl border flex flex-col justify-between h-20 relative transition-all duration-300 ${
              peer.speaking && !peer.muted
                ? 'bg-emerald-950/20 border-emerald-500 shadow-lg shadow-emerald-500/10 scale-102 ring-2 ring-emerald-500/20'
                : 'bg-slate-950/40 border-slate-800'
            }`}
          >
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-tight truncate">
                Remote Player
              </span>
              {peer.muted ? (
                <MicOff className="w-3.5 h-3.5 text-rose-500" />
              ) : peer.speaking ? (
                <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              ) : (
                <Mic className="w-3.5 h-3.5 text-slate-400" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${peer.muted ? 'bg-rose-500' : peer.speaking ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
              <span className="text-xs font-sans font-black text-slate-200 truncate">{peer.username}</span>
            </div>
          </div>
        ))}

        {Object.keys(peers).length === 0 && (
          <div className="col-span-full py-4 text-center leading-relaxed">
            <p className="text-[10px] font-mono uppercase text-slate-500">
              Waiting for other players to unmute or join live audio
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
