
import type React from 'react';

export interface Word {
  id: string;
  en: string;
  it: string;
  category: 'grammar' | 'content' | 'cultural';
  description?: string;
}

export const LanguageMode = {
  EN_TO_IT: 'EN_TO_IT',
  IT_TO_EN: 'IT_TO_EN',
} as const;
export type LanguageMode = typeof LanguageMode[keyof typeof LanguageMode];

export interface FlashcardProps {
  word: Word;
  isFlipped: boolean;
  onFlip: () => void;
  mode: LanguageMode;
  onSpeak: (e: React.MouseEvent, text: string) => void;
  isSpeaking: boolean;
  cardStreak: number;
}
