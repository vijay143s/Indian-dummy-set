import React, { useState, useEffect } from 'react';
import { LogIn, Plus, Shield, Phone, User as UserIcon } from 'lucide-react';

interface LobbyPortalProps {
  onJoinGame: (code: string, mobile: string, name: string) => void;
  onCreateGame: (mobile: string, name: string, maxScore: number) => void;
  errorMsg: string | null;
}

export const LobbyPortal: React.FC<LobbyPortalProps> = ({
  onJoinGame,
  onCreateGame,
  errorMsg,
}) => {
  const [code, setCode] = useState('');
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [maxScore, setMaxScore] = useState<number | string>(200);
  const [submitting, setSubmitting] = useState(false);

  // Load from local storage on mount
  useEffect(() => {
    const savedMobile = localStorage.getItem('ds_mobile');
    const savedName = localStorage.getItem('ds_name');
    if (savedMobile) setMobile(savedMobile);
    if (savedName) setName(savedName);
  }, []);

  // Save to local storage when joining/creating
  const persistIdentity = () => {
    localStorage.setItem('ds_mobile', mobile);
    localStorage.setItem('ds_name', name);
  };

  const validate = () => {
    if (mobile.length !== 10) {
      alert("Please enter a valid 10-digit mobile number.");
      return false;
    }
    if (!name.trim()) {
      alert("Please enter your display name.");
      return false;
    }
    return true;
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (!code) return;
    setSubmitting(true);
    persistIdentity();
    onJoinGame(code.toUpperCase().trim(), mobile, name);
    setTimeout(() => setSubmitting(false), 2000);
  };

  const handleCreate = () => {
    if (!validate()) return;
    setSubmitting(true);
    persistIdentity();
    const finalScore = typeof maxScore === 'number' ? maxScore : parseInt(maxScore) || 200;
    onCreateGame(mobile, name, finalScore);
    setTimeout(() => setSubmitting(false), 2000);
  };

  return (
    <div id="lobby-portal-container" className="w-full max-w-md p-8 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl text-slate-200">
      {/* Brand Header */}
      <div className="flex flex-col items-center text-center mb-8">
        <div className="w-16 h-16 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/10 mb-4 transition-transform hover:scale-105 duration-300">
          <span className="text-2xl font-black tracking-tighter">DS</span>
        </div>
        <h1 className="text-2xl font-sans font-black tracking-tight text-white mb-2 uppercase">
          Indian Dummy Set
        </h1>
        <p className="text-xs text-slate-500 font-mono tracking-wider">
          SERVER-AUTHORITATIVE HIGH DENSITY MULTIPLAYER
        </p>
      </div>

      {errorMsg && (
        <div id="lobby-error" className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono leading-relaxed">
          {errorMsg}
        </div>
      )}

      <div className="flex flex-col gap-6">
        
        {/* Player Identity Details */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col">
            <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 font-bold">Mobile Number (10 Digits)</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="e.g. 9876543210"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                required
                className="w-full py-3 pl-10 pr-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-600 font-sans text-sm focus:border-indigo-500 focus:outline-none transition-all duration-200"
              />
            </div>
          </div>

          <div className="flex flex-col">
            <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 font-bold">Display Name</label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="e.g. Vijay"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full py-3 pl-10 pr-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-600 font-sans text-sm focus:border-indigo-500 focus:outline-none transition-all duration-200"
              />
            </div>
          </div>
        </div>

        <div className="h-px bg-slate-800" />

        {/* Join Match Controls */}
        <form onSubmit={handleJoin} className="flex flex-col gap-3">
          <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest font-bold">Join Game Lobby</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="LOBBY CODE (E.g. DS-HD9A)"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              className="flex-1 py-3 px-4 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono text-white placeholder-slate-600 placeholder-font-mono text-center tracking-widest uppercase focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none duration-205"
            />
            <button
              type="submit"
              disabled={submitting}
              id="join-code-btn"
              className="py-3 px-6 bg-indigo-600 hover:bg-indigo-500 text-white font-sans font-bold text-sm rounded-xl transition duration-200 shadow-md shadow-indigo-600/10 flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
            >
              <LogIn className="w-4 h-4" />
              Join
            </button>
          </div>
        </form>

        {/* Divider */}
        <div className="relative flex items-center justify-center py-1">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-800" />
          </div>
          <span className="relative px-3 text-[10px] font-mono tracking-widest uppercase bg-slate-900 text-slate-600 font-bold">OR</span>
        </div>

        {/* Create Match Controls */}
        <div className="flex flex-col gap-3">
          <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest font-bold">Host New Lobby</label>
          <div className="flex gap-2 items-center bg-slate-950 px-4 py-2 rounded-xl border border-slate-800">
            <span className="text-xs font-mono text-slate-400">Elimination Score:</span>
            <input
              type="number"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value === '' ? '' : parseInt(e.target.value))}
              className="w-20 bg-transparent text-white font-bold font-mono text-right focus:outline-none"
              min={50}
              max={1000}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={submitting}
            id="create-lobby-btn"
            className="flex items-center justify-center gap-2 w-full py-3.5 px-4 rounded-xl bg-slate-950 hover:bg-slate-800 text-indigo-400 border border-indigo-500/30 hover:border-indigo-400 font-sans font-bold text-sm transition-all duration-200 active:scale-95"
          >
            <Plus className="w-4 h-4" strokeWidth={3} />
            Host a New Lobby Code
          </button>
        </div>
      </div>

      {/* Anti-cheat disclaimer */}
      <div className="mt-8 flex items-center justify-center gap-2 text-[10px] text-slate-500 border-t border-slate-800/50 pt-4">
        <Shield className="w-3.5 h-3.5" />
        <span className="font-mono">Server-verified game states prevent cheating.</span>
      </div>
    </div>
  );
};
