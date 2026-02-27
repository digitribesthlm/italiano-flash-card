
import React from 'react';

export interface Word {
  id: string;
  en: string;
  it: string;
  category: 'grammar' | 'content' | 'cultural';
  description?: string;
}

export enum LanguageMode {
  EN_TO_IT = 'EN_TO_IT',
  IT_TO_EN = 'IT_TO_EN'
}

export interface FlashcardProps {
  word: Word;
  isFlipped: boolean;
  onFlip: () => void;
  mode: LanguageMode;
  onSpeak: (e: React.MouseEvent, text: string) => void;
  isSpeaking: boolean;
  cardStreak: number;
}
