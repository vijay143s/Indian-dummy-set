import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff } from 'lucide-react';

interface DraggableMuteButtonProps {
  isMuted: boolean;
  disabled: boolean;
  onClick: () => void;
}

export const DraggableMuteButton: React.FC<DraggableMuteButtonProps> = ({ isMuted, disabled, onClick }) => {
  const [position, setPosition] = useState({ x: 20, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    // Initial position based on screen width to avoid immediate overlap
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Default to right middle, away from top-right corner
    setPosition({ x: Math.max(20, w - 80), y: h / 2 });
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    setIsDragging(false);
    offsetRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
    if (dragRef.current) {
      dragRef.current.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 || disabled) return;
    setIsDragging(true);
    
    let newX = e.clientX - offsetRef.current.x;
    let newY = e.clientY - offsetRef.current.y;
    
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    // Confine to screen
    newX = Math.max(10, Math.min(newX, w - 70));
    newY = Math.max(10, Math.min(newY, h - 70));
    
    // Avoid top-right corner (Leave button)
    if (newX > w - 160 && newY < 80) {
      newY = 80;
    }

    setPosition({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      dragRef.current.releasePointerCapture(e.pointerId);
    }
    // Only fire click if we didn't drag it around
    if (!isDragging) {
      onClick();
    }
    setTimeout(() => setIsDragging(false), 50);
  };

  if (disabled) return null;

  return (
    <div
      ref={dragRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 9999,
        touchAction: 'none'
      }}
      className={`p-3 rounded-full shadow-2xl cursor-grab active:cursor-grabbing border-2 backdrop-blur-md transition-colors ${
        isMuted 
          ? 'bg-rose-950/80 border-rose-500 shadow-rose-900/50 text-rose-400' 
          : 'bg-emerald-600 border-emerald-400 shadow-emerald-600/50 text-white'
      }`}
    >
      {isMuted ? <MicOff className="w-8 h-8 opacity-80" /> : <Mic className="w-8 h-8 animate-pulse" />}
    </div>
  );
};
