
import React from 'react';
import { FlashcardProps, LanguageMode } from '../types';

const Flashcard: React.FC<FlashcardProps> = ({ word, isFlipped, onFlip, mode, onSpeak, isSpeaking, cardStreak }) => {
  const isEnToIt = mode === LanguageMode.EN_TO_IT;
  const frontText = isEnToIt ? word.en : word.it;
  const backText = isEnToIt ? word.it : word.en;
  
  const getCategoryColor = () => {
    switch(word.category) {
      case 'grammar': return 'bg-blue-500';
      case 'content': return 'bg-emerald-500';
      case 'cultural': return 'bg-rose-500';
      default: return 'bg-gray-500';
    }
  };

  const isMasteredGlobal = word.description?.startsWith('(Mastered)');
  const cleanDescription = word.description?.replace('(Mastered) ', '');
  const italianText = word.it;

  const StreakBadge = () => {
    if (cardStreak >= 3) {
      return (
        <div className="absolute top-8 left-8 flex items-center gap-2 bg-gradient-to-r from-amber-400 to-orange-500 text-white px-3 py-1.5 rounded-full shadow-lg z-30 animate-bounce">
          <i className="fa-solid fa-fire text-xs"></i>
          <span className="text-[10px] font-black uppercase tracking-tighter">Hot Streak</span>
        </div>
      );
    }
    if (cardStreak <= -3) {
      return (
        <div className="absolute top-8 left-8 flex items-center gap-2 bg-rose-600 text-white px-3 py-1.5 rounded-full shadow-lg z-30 animate-pulse">
          <i className="fa-solid fa-triangle-exclamation text-xs"></i>
          <span className="text-[10px] font-black uppercase tracking-tighter">Struggling</span>
        </div>
      );
    }
    return null;
  };

  const SpeakerButton = ({ theme }: { theme: 'light' | 'dark' }) => (
    <button 
      type="button"
      onClick={(e) => onSpeak(e, italianText)}
      disabled={isSpeaking}
      className={`absolute top-8 right-8 w-12 h-12 rounded-full flex items-center justify-center transition-all z-30 shadow-lg active:scale-90 ${
        theme === 'light' 
          ? 'bg-white text-gray-400 hover:text-emerald-500 hover:shadow-emerald-100' 
          : 'bg-white/10 text-white/50 hover:text-emerald-400 hover:bg-white/20'
      } ${isSpeaking ? 'animate-pulse' : ''}`}
    >
      {isSpeaking ? (
        <i className="fa-solid fa-spinner animate-spin"></i>
      ) : (
        <i className="fa-solid fa-volume-high text-lg"></i>
      )}
    </button>
  );

  return (
    <div 
      className="w-full max-w-sm h-80 perspective cursor-pointer group select-none"
      onClick={onFlip}
    >
      <div className={`relative w-full h-full duration-500 preserve-3d shadow-2xl rounded-[2.5rem] ${isFlipped ? 'rotate-y-180' : ''}`}>
        
        {/* Front Side */}
        <div className="absolute w-full h-full backface-hidden bg-white rounded-[2.5rem] border-4 border-white flex flex-col items-center justify-center p-8 text-center overflow-hidden shadow-[inset_0_0_40px_rgba(0,0,0,0.02)]">
          <StreakBadge />
          
          <div className={`absolute bottom-0 left-0 text-[9px] uppercase tracking-widest font-black text-white px-5 py-2 rounded-tr-[1.5rem] ${getCategoryColor()} z-10`}>
            {word.category}
          </div>
          
          {isMasteredGlobal && (
            <div className="absolute bottom-0 right-0 bg-emerald-500 text-white px-5 py-2 rounded-tl-[1.5rem] flex items-center gap-1.5 z-10">
              <i className="fa-solid fa-crown text-[10px]"></i>
              <span className="text-[9px] font-black uppercase tracking-widest">Mastered</span>
            </div>
          )}

          {!isEnToIt && <SpeakerButton theme="light" />}

          <p className="text-gray-300 text-[10px] mb-3 uppercase tracking-[0.2em] font-black">
            {isEnToIt ? 'English' : 'Italiano'}
          </p>
          <h2 className="text-4xl font-black text-gray-800 break-words w-full px-4 leading-tight">
            {frontText}
          </h2>
          <div className="absolute bottom-10 text-gray-200 text-[9px] font-bold flex items-center gap-2 opacity-60">
            <i className="fa-solid fa-hand-pointer animate-pulse"></i>
            <span className="uppercase tracking-widest">Tap to reveal</span>
          </div>
        </div>

        {/* Back Side */}
        <div className="absolute w-full h-full backface-hidden bg-gray-900 text-white rounded-[2.5rem] border-4 border-gray-800 flex flex-col items-center justify-center p-8 text-center rotate-y-180 overflow-hidden shadow-2xl">
          <StreakBadge />
          
          <div className="absolute top-0 left-0 p-8 opacity-[0.03]">
             <i className="fa-solid fa-quote-right text-[10rem]"></i>
          </div>

          {isEnToIt && <SpeakerButton theme="dark" />}
          
          <p className="text-emerald-400 text-[10px] mb-3 uppercase tracking-[0.2em] font-black">
            {isEnToIt ? 'Italiano' : 'English'}
          </p>
          <h2 className="text-4xl font-black break-words w-full px-4 leading-tight">
            {backText}
          </h2>
          {cleanDescription && (
            <div className="mt-6 px-4 py-2 bg-white/5 rounded-xl border border-white/10 max-w-[80%]">
              <p className="text-gray-400 text-xs leading-relaxed italic">
                {cleanDescription}
              </p>
            </div>
          )}
          
          <div className="absolute bottom-10 text-emerald-500/30 text-[9px] font-black uppercase tracking-widest flex items-center gap-2">
            <i className="fa-solid fa-check-double"></i>
            <span>Revealed</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Flashcard;
