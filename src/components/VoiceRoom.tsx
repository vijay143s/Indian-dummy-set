import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, Video, VideoOff, Users, Radio, AlertCircle } from 'lucide-react';
import { PlayerType } from '../types.ts';
import { DraggableMuteButton } from './DraggableMuteButton.tsx';

interface VoiceRoomProps {
  socket: any;
  gameId: number;
  viewerPlayerId: number | null;
  players: PlayerType[];
  onToggleLobby?: () => void;
  onStreamsChange?: (streams: Record<number, { stream: MediaStream | null; videoEnabled: boolean; speaking: boolean }>) => void;
}

interface PeerState {
  socketId: string;
  username: string;
  speaking: boolean;
  muted: boolean;
  videoEnabled: boolean;
  stream?: MediaStream;
}

export const VideoPlayer = ({ stream, isLocal = false }: { stream: MediaStream | null, isLocal?: boolean }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!stream) return null;

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={isLocal}
      className={`absolute inset-0 w-full h-full object-cover rounded-xl ${isLocal ? 'scale-x-[-1]' : ''}`}
    />
  );
};

export const VoiceRoom: React.FC<VoiceRoomProps> = ({
  socket,
  gameId,
  viewerPlayerId,
  players,
  onToggleLobby,
  onStreamsChange,
}) => {
  const [localMuted, setLocalMuted] = useState(true);
  const [localVideoEnabled, setLocalVideoEnabled] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [peers, setPeers] = useState<Record<string, PeerState>>({});
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [socketToPlayerId, setSocketToPlayerId] = useState<Record<string, number>>({});

  // Refs for WebRTC resources
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const javascriptNodeRef = useRef<ScriptProcessorNode | null>(null);

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
        console.log("Received media offer from:", data.senderUsername, data.senderSocketId);
        
        // Update peer list with current muted state
        setPeers(prev => ({
          ...prev,
          [data.senderSocketId]: {
            socketId: data.senderSocketId,
            username: data.senderUsername,
            speaking: false,
            muted: data.muted !== undefined ? data.muted : false,
            videoEnabled: false,
            stream: prev[data.senderSocketId]?.stream
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
        console.error("Error setting up remote media description:", e);
      }
    };

    // Handle incoming answers
    const handleVoiceAnswer = async (data: { senderSocketId: string; answer: RTCSessionDescriptionInit; muted?: boolean }) => {
      try {
        console.log("Received remote media answer from socket:", data.senderSocketId);
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
        console.log("A new player joined media channel:", data.username, data.socketId);
        
        setPeers(prev => ({
          ...prev,
          [data.socketId]: {
            socketId: data.socketId,
            username: data.username,
            speaking: false,
            muted: true, // Safe default until handshake replies
            videoEnabled: false,
            stream: prev[data.socketId]?.stream
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

    // Handle peer video on/off status (This was not fully implemented in the frontend previously)
    // Wait, the backend emits it as part of room state, but let's add a listener just in case we add direct events later.
    const handleVoiceVideoState = (data: { senderSocketId: string; videoEnabled: boolean }) => {
      setPeers(prev => {
        if (!prev[data.senderSocketId]) return prev;
        return {
          ...prev,
          [data.senderSocketId]: {
            ...prev[data.senderSocketId],
            videoEnabled: data.videoEnabled
          }
        };
      });
    };

    // Handle server-authoritative voice pool states (handles missing handshakes or WebRTC constraints in sandbox)
    const handleVoiceRoomState = (data: Record<number, { muted: boolean; speaking: boolean; videoEnabled?: boolean; socketId: string; username: string }>) => {
      const mapping: Record<string, number> = {};
      
      // Populate mapping synchronously
      Object.entries(data).forEach(([pIdStr, srvPeer]) => {
        mapping[srvPeer.socketId] = parseInt(pIdStr, 10);
      });
      setSocketToPlayerId(mapping);

      setPeers(prev => {
        const nextPeers = { ...prev };
        Object.entries(data).forEach(([pIdStr, srvPeer]) => {
          if (srvPeer.socketId === socket.id) return;
          
          nextPeers[srvPeer.socketId] = {
            socketId: srvPeer.socketId,
            username: srvPeer.username,
            speaking: srvPeer.speaking,
            muted: srvPeer.muted,
            videoEnabled: srvPeer.videoEnabled || false,
            stream: prev[srvPeer.socketId]?.stream // preserve existing streams
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
    socket.on("voiceVideoState", handleVoiceVideoState);

    // Join media channel immediately
    initializeMediaStream();

    return () => {
      socket.off("voiceOffer", handleVoiceOffer);
      socket.off("voiceAnswer", handleVoiceAnswer);
      socket.off("voiceIceCandidate", handleVoiceIceCandidate);
      socket.off("newPeerConnected", handleNewPeer);
      socket.off("voiceSpeakingState", handleVoiceSpeaking);
      socket.off("voiceMuteState", handleVoiceMuted);
      socket.off("voiceRoomState", handleVoiceRoomState);
      socket.off("voiceVideoState", handleVoiceVideoState);
      cleanupMediaResources();
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

  // Synchronize dynamic local video status to socket
  useEffect(() => {
    if (socket && isJoined) {
      socket.emit("voiceVideoState", { videoEnabled: localVideoEnabled });
    }
  }, [localVideoEnabled, isJoined]);

  // Bubble streams up to parent component
  useEffect(() => {
    if (onStreamsChange) {
      const output: Record<number, { stream: MediaStream | null; videoEnabled: boolean; speaking: boolean }> = {};
      
      if (viewerPlayerId) {
        output[viewerPlayerId] = {
          stream: localStreamRef.current,
          videoEnabled: localVideoEnabled,
          speaking: localSpeaking
        };
      }

      (Object.values(peers) as PeerState[]).forEach(peer => {
        const pId = socketToPlayerId[peer.socketId];
        if (pId) {
          output[pId] = {
            stream: peer.stream || null,
            videoEnabled: peer.videoEnabled,
            speaking: peer.speaking
          };
        }
      });

      onStreamsChange(output);
    }
  }, [peers, localVideoEnabled, localSpeaking, viewerPlayerId, socketToPlayerId, onStreamsChange]);

  // Sets up RTCPeerConnection for a remote peer socket
  const createPeerConnection = (socketId: string, username: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.current[socketId] = pc;

    // Direct local audio and video track sending
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

    // Receive incoming streams into the React state
    pc.ontrack = (event) => {
      console.log("Receiving media track from:", username);
      const remoteStream = event.streams[0];
      
      setPeers(prev => {
        const existing = prev[socketId];
        return {
          ...prev,
          [socketId]: existing ? {
            ...existing,
            stream: remoteStream
          } : {
            socketId,
            username,
            speaking: false,
            muted: true,
            videoEnabled: false,
            stream: remoteStream
          }
        };
      });
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
    setPeers(prev => {
      const copy = { ...prev };
      delete copy[socketId];
      return copy;
    });
  };

  // Setup local A/V stream
  const initializeMediaStream = async () => {
    try {
      setErrorMessage(null);
      // Request device microphone & camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user"
        }
      });

      localStreamRef.current = stream;

      // By default start with MIC MUTED and VIDEO DISABLED for privacy
      stream.getAudioTracks().forEach(t => {
        t.enabled = false;
      });
      stream.getVideoTracks().forEach(t => {
        t.enabled = false;
      });

      // Setup audio analyzer to identify local voice patterns
      setupVoiceVolumeAnalyzer(stream);

      setIsJoined(true);
      console.log("AV stream successfully linked!");

      // Request handshakes from all current players in room
      if (socket) {
        socket.emit("requestPeerConnections");
      }
    } catch (e: any) {
      console.error("Failed to capture user AV input streams:", e);
      setErrorMessage("Media access blocked. Click on site details to allow microphone and camera permissions.");
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

  // Handle Video On / Off triggers
  const toggleVideo = () => {
    if (!localStreamRef.current) return;

    const currentVideoEnabled = !localVideoEnabled;
    setLocalVideoEnabled(currentVideoEnabled);

    localStreamRef.current.getVideoTracks().forEach(track => {
      track.enabled = currentVideoEnabled;
    });
  };

  // Clean elements and references
  const cleanupMediaResources = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    // Clear peer connections
    Object.keys(peerConnections.current).forEach(sid => {
      peerConnections.current[sid].close();
    });
    peerConnections.current = {};

    // Clear Analyzer
    if (javascriptNodeRef.current) javascriptNodeRef.current.disconnect();
    if (analyserRef.current) analyserRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
  };

  return (
    <div className="bg-slate-900/90 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col gap-4">
      {/* Voice/Video header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 pb-3 gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </div>
          <div>
            <h4 className="text-xs font-sans font-extrabold uppercase tracking-widest text-slate-100 flex items-center gap-1.5">
              Live AV Lobby
            </h4>
            <p className="text-[9px] font-mono text-slate-400 uppercase">Interactive audio & video</p>
          </div>
        </div>

        <div className="flex gap-2 self-stretch sm:self-auto">
          <button
            onClick={toggleVideo}
            disabled={!isJoined}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md duration-200 cursor-pointer ${
              !localVideoEnabled
                ? 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow shadow-emerald-600/20 border border-emerald-500/50'
            }`}
          >
            {localVideoEnabled ? (
              <>
                <Video className="w-3.5 h-3.5 text-white" /> Camera On
              </>
            ) : (
              <>
                <VideoOff className="w-3.5 h-3.5 text-rose-400" /> Camera Off
              </>
            )}
          </button>
          <button
            onClick={toggleMute}
            disabled={!isJoined}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md duration-200 cursor-pointer ${
              localMuted
                ? 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow shadow-emerald-600/20 border border-emerald-500/50'
            }`}
          >
            {localMuted ? (
              <>
                <MicOff className="w-3.5 h-3.5 text-rose-400" /> Mic Off
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5 text-white" /> Mic On
              </>
            )}
          </button>
        </div>
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

      {/* Voice/Video grid list */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-2 gap-2">
        {/* Local user */}
        <div
          className={`overflow-hidden rounded-xl border flex flex-col justify-between ${localVideoEnabled ? 'h-32 sm:h-40 lg:h-32' : 'h-20 p-3'} relative transition-all duration-300 ${
            localSpeaking && !localMuted
              ? 'bg-emerald-950/20 border-emerald-500 shadow-lg shadow-emerald-500/10 ring-2 ring-emerald-500/20 scale-[1.02]'
              : 'bg-slate-950/40 border-slate-800'
          }`}
        >
          {localVideoEnabled && (
            <VideoPlayer stream={localStreamRef.current} isLocal={true} />
          )}
          
          {/* Overlay info if video is enabled, or block info if video is disabled */}
          <div className={`flex justify-between items-start w-full ${localVideoEnabled ? 'absolute inset-x-0 top-0 p-2 bg-gradient-to-b from-slate-950/80 to-transparent z-10' : ''}`}>
            <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-tight truncate drop-shadow-md">
              You
            </span>
            <div className="flex gap-1">
              {localMuted ? (
                <MicOff className="w-3.5 h-3.5 text-rose-400 drop-shadow-md" />
              ) : localSpeaking ? (
                <Radio className="w-3.5 h-3.5 text-emerald-400 drop-shadow-md animate-pulse" />
              ) : (
                <Mic className="w-3.5 h-3.5 text-emerald-400 drop-shadow-md" />
              )}
            </div>
          </div>
          <div className={`flex items-center gap-2 w-full ${localVideoEnabled ? 'absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-slate-950/90 to-transparent z-10' : ''}`}>
            <div className={`w-2 h-2 rounded-full ${localMuted ? 'bg-rose-500' : localSpeaking ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
            <span className="text-xs font-sans font-black text-white truncate drop-shadow-md">{currentUser?.username || "You"}</span>
          </div>
        </div>

        {/* Remote Peers connected */}
        {(Object.values(peers) as PeerState[]).map(peer => (
          <div
            key={peer.socketId}
            className={`overflow-hidden rounded-xl border flex flex-col justify-between ${peer.videoEnabled ? 'h-32 sm:h-40 lg:h-32' : 'h-20 p-3'} relative transition-all duration-300 ${
              peer.speaking && !peer.muted
                ? 'bg-emerald-950/20 border-emerald-500 shadow-lg shadow-emerald-500/10 ring-2 ring-emerald-500/20 scale-[1.02]'
                : 'bg-slate-950/40 border-slate-800'
            }`}
          >
            {peer.stream && (
              // We render the VideoPlayer regardless of peer.videoEnabled just to be safe,
              // but we control its visibility or rely on the actual track's enabled state
              <div className={`${peer.videoEnabled ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}>
                 <VideoPlayer stream={peer.stream} isLocal={false} />
              </div>
            )}
            
            <div className={`flex justify-between items-start w-full ${peer.videoEnabled ? 'absolute inset-x-0 top-0 p-2 bg-gradient-to-b from-slate-950/80 to-transparent z-10' : ''}`}>
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-tight truncate drop-shadow-md">
                Remote
              </span>
              {peer.muted ? (
                <MicOff className="w-3.5 h-3.5 text-rose-500 drop-shadow-md" />
              ) : peer.speaking ? (
                <Radio className="w-3.5 h-3.5 text-emerald-400 drop-shadow-md animate-pulse" />
              ) : (
                <Mic className="w-3.5 h-3.5 text-emerald-400 drop-shadow-md" />
              )}
            </div>
            <div className={`flex items-center gap-2 w-full ${peer.videoEnabled ? 'absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-slate-950/90 to-transparent z-10' : ''}`}>
              <div className={`w-2 h-2 rounded-full ${peer.muted ? 'bg-rose-500' : peer.speaking ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
              <span className="text-xs font-sans font-black text-white truncate drop-shadow-md">{peer.username}</span>
            </div>
          </div>
        ))}

        {Object.keys(peers).length === 0 && (
          <div className="col-span-full py-4 text-center leading-relaxed">
            <p className="text-[10px] font-mono uppercase text-slate-500">
              Waiting for other players to unmute or join live AV
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
