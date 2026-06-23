import React from 'react';
import { CardType } from '../types.ts';
import { Heart, Diamond, Club, Spade, HelpCircle, Star, Crown, Gem, Sword } from 'lucide-react';

interface CardVisualProps {
  card: CardType;
  isSelected?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

export const CardVisual: React.FC<CardVisualProps> = ({ card, isSelected = false, onClick, size = 'md' }) => {
  const isHidden = card.suit === 'hidden' || card.rank === 'hidden';
  const isPlaceholder = card.suit === 'wildcard_placeholder';

  // Determine colors based on suits
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

  // Map suits to icons
  const renderSuitIcon = (suit: string, className: string) => {
    switch (suit) {
      case 'hearts':
        return <Heart className={`${className} fill-current`} />;
      case 'diamonds':
        return <Diamond className={`${className} fill-current`} />;
      case 'clubs':
        return <Club className={`${className} fill-current`} />;
      case 'spades':
        return <Spade className={`${className} fill-current`} />;
      default:
        return <HelpCircle className={className} />;
    }
  };

  const renderCentralEmblem = () => {
    if (card.suit === 'joker' || card.rank === 'joker') {
      return (
         <div className="flex flex-col items-center">
           <span className={`${size === 'sm' ? 'text-3xl' : 'text-5xl'} leading-none grayscale`}>🃏</span>
           <span className={`${size === 'sm' ? 'text-[7px]' : 'text-[9px]'} font-mono tracking-widest uppercase mt-1 text-black font-extrabold`}>Joker</span>
         </div>
      );
    }
    
    if (card.rank === 'K') return <Crown className={`${size === 'sm' ? 'w-6 h-6' : 'w-10 h-10'} fill-current`} />;
    if (card.rank === 'Q') return <Gem className={`${size === 'sm' ? 'w-6 h-6' : 'w-10 h-10'} fill-current`} />;
    if (card.rank === 'J') return <Sword className={`${size === 'sm' ? 'w-6 h-6' : 'w-10 h-10'} fill-current`} />;
    
    return renderSuitIcon(card.suit, size === 'sm' ? 'w-6 h-6' : (size === 'lg' ? 'w-12 h-12' : 'w-10 h-10'));
  };

  const sizeClasses = {
    sm: 'w-16 h-24 text-xs rounded-md',
    md: 'w-24 h-36 text-sm rounded-lg',
    lg: 'w-28 h-40 text-base rounded-xl',
  };

  if (isHidden) {
    return (
      <div
        onClick={onClick}
        id={`card-back-${card.id}`}
        className={`relative ${sizeClasses[size]} select-none flex flex-col items-center justify-center border-2 border-white/25 bg-radial from-red-600 to-red-950 text-white shadow-lg cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:shadow-red-500/20 active:translate-y-0`}
      >
        {/* Intricate decorative back pattern */}
        <div className="absolute inset-1.5 border border-white/10 rounded" />
        <div className="absolute inset-3 border border-dashed border-white/10 rounded flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center bg-red-900/50">
            <span className="text-[10px] font-mono tracking-wider text-red-100 font-bold">DS</span>
          </div>
        </div>
      </div>
    );
  }

  if (isPlaceholder) {
    return (
      <div
        onClick={onClick}
        id={`card-placeholder-${card.id}`}
        className={`relative ${sizeClasses[size]} select-none flex flex-col items-center justify-center border-2 border-dashed border-yellow-500/50 bg-slate-900/80 text-yellow-500 shadow-lg cursor-pointer transition-all duration-300 hover:-translate-y-1 ${
          isSelected ? 'ring-4 ring-yellow-400 scale-105 shadow-yellow-500/30 -translate-y-4' : ''
        }`}
      >
        <Star className="w-6 h-6 animate-pulse mb-1" />
        <span className="text-[10.5px] text-center font-mono font-bold leading-tight px-1">HIDDEN WILD</span>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      id={`card-${card.id}`}
      className={`relative ${sizeClasses[size]} select-none flex flex-col justify-between bg-white border border-slate-400 overflow-hidden shadow-[-4px_0px_8px_rgba(0,0,0,0.25)] cursor-pointer transition-all duration-200 ${
        size === 'sm' ? 'p-1' : 'p-2 border-2'
      } ${
        isRed ? 'text-red-600' : 'text-black'
      } ${
        isSelected 
          ? 'ring-2 ring-indigo-500 -translate-y-4 shadow-[0_10px_20px_rgba(0,0,0,0.4)] z-10 scale-105' 
          : 'hover:-translate-y-2 hover:shadow-[-6px_4px_12px_rgba(0,0,0,0.3)] active:translate-y-0'
      }`}
    >
      {/* Top Left Corner */}
      <div className="flex flex-col items-start leading-none shrink-0">
        <span className={`font-sans font-bold tracking-tight ${size === 'sm' ? 'text-xs md:text-sm' : 'text-lg'}`}>{card.rank === 'joker' ? '★' : card.rank}</span>
        {card.suit !== 'joker' && renderSuitIcon(card.suit, size === 'sm' ? 'w-2.5 h-2.5 mt-0.5' : 'w-3.5 h-3.5 mt-0.5')}
      </div>

      {/* Central Emblem */}
      <div className="flex items-center justify-center self-center my-auto shrink-0">
        {renderCentralEmblem()}
      </div>

      {/* Wildcard Overlays */}
      {card.isWild && (
        <span className="absolute top-1 right-1 px-1 py-0.5 text-[8px] font-mono bg-yellow-400 text-yellow-950 rounded font-bold uppercase shadow-sm">
          Wild
        </span>
      )}

      {card.isHiddenWild && (
        <span className="absolute bottom-1 right-1 px-1 py-0.5 text-[8px] font-mono bg-emerald-500 text-white rounded font-bold uppercase shadow-sm flex items-center gap-0.5">
          <Star className="w-2 h-2 fill-current" /> Private
        </span>
      )}

      {/* Bottom Right Corner (inverted) */}
      <div className="flex flex-col items-end leading-none rotate-180 shrink-0">
        <span className={`font-sans font-bold tracking-tight ${size === 'sm' ? 'text-xs md:text-sm' : 'text-lg'}`}>{card.rank === 'joker' ? '★' : card.rank}</span>
        {card.suit !== 'joker' && renderSuitIcon(card.suit, size === 'sm' ? 'w-2.5 h-2.5 mt-0.5' : 'w-3.5 h-3.5 mt-0.5')}
      </div>
    </div>
  );
};
