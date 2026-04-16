
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { Word, LanguageMode } from './types';
import { DECKS } from './data/words';
import Flashcard from './components/Flashcard';
import { fetchProgress, postAttempt, fetchStats } from './api';

// Audio Helpers
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const STORAGE_KEY_STREAKS = 'italiano_flash_card_streaks';
const STORAGE_KEY_MASTERED = 'italiano_flash_mastered_ids';
const STORAGE_KEY_AUTH = 'italiano_flash_auth';
const STORAGE_KEY_USER = 'italiano_flash_user';

type PracticeMode = 'mixed' | 'hard' | 'mastered';

function getAllWords(): Word[] {
  return Object.values(DECKS).flat();
}

function getHardWordIds(cardStreaks: Record<string, number>, learningIds: Set<string>, statsHardIds: string[]): string[] {
  const fromLocal = new Set<string>();
  Object.entries(cardStreaks).forEach(([id, streak]) => { if (streak <= -2) fromLocal.add(id); });
  learningIds.forEach((id) => fromLocal.add(id));
  statsHardIds.forEach((id) => fromLocal.add(id));
  return Array.from(fromLocal);
}

const App: React.FC = () => {
  const [activeDeckKey, setActiveDeckKey] = useState<keyof typeof DECKS>('CLASSIC');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [mode, setMode] = useState<LanguageMode>(LanguageMode.EN_TO_IT);
  const [shuffledVocab, setShuffledVocab] = useState<Word[]>([]);
  const [aiContext, setAiContext] = useState<string | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  const [isDifficultOnly, setIsDifficultOnly] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [stats, setStats] = useState<{ dailyAttempts: number; weeklyAttempts: number; hardWordIds: string[] } | null>(null);
  const [progressLoadedFromApi, setProgressLoadedFromApi] = useState(false);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>('mixed');
  const [showHardList, setShowHardList] = useState(false);
  
  // Audio context persistence
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Per-card performance tracking
  const [cardStreaks, setCardStreaks] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_STREAKS);
    return saved ? JSON.parse(saved) : {};
  });

  // Performance & Scoring
  const [masteredIds, setMasteredIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_MASTERED);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  
  const [learningIds, setLearningIds] = useState<Set<string>>(new Set());
  const [score, setScore] = useState(0);
  const [sessionStreak, setSessionStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);

  // Persistence Effects
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_STREAKS, JSON.stringify(cardStreaks));
  }, [cardStreaks]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_MASTERED, JSON.stringify(Array.from(masteredIds)));
  }, [masteredIds]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY_AUTH);
    const user = localStorage.getItem(STORAGE_KEY_USER);
    if (stored === 'true' && user) {
      setIsAuthenticated(true);
      setCurrentUser(user);
    }
  }, []);

  // When logged in, sync progress and stats from MongoDB
  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const [progressData, statsData] = await Promise.all([
          fetchProgress(currentUser),
          fetchStats(currentUser),
        ]);
        if (cancelled) return;
        if (progressData.wordStreaks && Object.keys(progressData.wordStreaks).length > 0) {
          setCardStreaks(progressData.wordStreaks);
        }
        if (progressData.masteredIds?.length) {
          setMasteredIds(new Set(progressData.masteredIds));
        }
        if (progressData.learningIds?.length) {
          setLearningIds(new Set(progressData.learningIds));
        }
        setProgressLoadedFromApi(true);
        setStats({
          dailyAttempts: statsData.dailyAttempts ?? 0,
          weeklyAttempts: statsData.weeklyAttempts ?? 0,
          hardWordIds: statsData.hardWordIds ?? [],
        });
      } catch (_) {
        // API unavailable (e.g. server not running); keep using localStorage
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, currentUser]);

  // Handle deck changes and practice mode
  useEffect(() => {
    shuffleWithMode(practiceMode);
  }, [activeDeckKey, practiceMode]);

  // After loading progress from API, reshuffle so deck reflects server state
  useEffect(() => {
    if (!progressLoadedFromApi) return;
    setProgressLoadedFromApi(false);
    shuffleWithMode(practiceMode);
  }, [progressLoadedFromApi]);

  const shuffleWithMode = (mode: PracticeMode) => {
    let baseList: Word[] = [...DECKS[activeDeckKey]];
    const hardIds = getHardWordIds(cardStreaks, learningIds, stats?.hardWordIds ?? []);

    if (mode === 'hard') {
      baseList = baseList.filter((w) => (cardStreaks[w.id] || 0) <= -2 || learningIds.has(w.id) || hardIds.includes(w.id));
      if (baseList.length === 0) baseList = [...DECKS[activeDeckKey]];
    } else if (mode === 'mastered') {
      baseList = baseList.filter((w) => masteredIds.has(w.id));
      if (baseList.length === 0) baseList = [...DECKS[activeDeckKey]];
    }
    // 'mixed' = full deck (mastered words stay in so they get reviewed Duolingo-style)

    const shuffled = baseList.sort(() => Math.random() - 0.5);
    setShuffledVocab(shuffled);
    setIsDifficultOnly(mode === 'hard' && baseList.length > 0);
    setCurrentIndex(0);
    setIsFlipped(false);
    setAiContext(null);
    setIsSessionComplete(false);
    setSessionStreak(0);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const expectedUser = process.env.USER_NAME;
    const expectedPassword = process.env.PASSWORD;

    if (loginUsername === expectedUser && loginPassword === expectedPassword) {
      setIsAuthenticated(true);
      setCurrentUser(loginUsername);
      localStorage.setItem(STORAGE_KEY_AUTH, 'true');
      localStorage.setItem(STORAGE_KEY_USER, loginUsername);
      setLoginError(null);
      setLoginPassword('');
    } else {
      setLoginError('Invalid username or password');
    }
  };

  const nextCard = useCallback(() => {
    setIsFlipped(false);
    setAiContext(null);
    setTimeout(() => {
      if (currentIndex >= shuffledVocab.length - 1) {
        setIsSessionComplete(true);
      } else {
        setCurrentIndex((prev) => prev + 1);
      }
    }, 150);
  }, [currentIndex, shuffledVocab.length]);

  const prevCard = useCallback(() => {
    if (currentIndex > 0) {
      setIsFlipped(false);
      setAiContext(null);
      setTimeout(() => {
        setCurrentIndex((prev) => prev - 1);
      }, 150);
    }
  }, [currentIndex]);

  const markPerformance = (status: 'mastered' | 'learning') => {
    const wordId = currentWord.id;
    if (currentUser) {
      postAttempt(currentUser, wordId, activeDeckKey, status).catch(() => {}).then(() => {
        fetchStats(currentUser).then((s) => setStats({
          dailyAttempts: s.dailyAttempts ?? 0,
          weeklyAttempts: s.weeklyAttempts ?? 0,
          hardWordIds: s.hardWordIds ?? [],
        })).catch(() => {});
      });
    }

    setCardStreaks(prev => {
      const currentStreak = prev[wordId] || 0;
      let newStreak = 0;
      if (status === 'mastered') {
        newStreak = currentStreak > 0 ? currentStreak + 1 : 1;
      } else {
        newStreak = currentStreak < 0 ? currentStreak - 1 : -1;
      }
      return { ...prev, [wordId]: newStreak };
    });

    if (status === 'mastered') {
      setMasteredIds(prev => new Set(prev).add(wordId));
      setLearningIds(prev => {
        const next = new Set(prev);
        next.delete(wordId);
        return next;
      });
      const newSessionStreak = sessionStreak + 1;
      setSessionStreak(newSessionStreak);
      setMaxStreak(Math.max(maxStreak, newSessionStreak));
      setScore(prev => prev + 10 + (newSessionStreak > 3 ? 5 : 0));
      nextCard();
    } else {
      setLearningIds(prev => new Set(prev).add(wordId));
      setMasteredIds(prev => {
        const next = new Set(prev);
        next.delete(wordId);
        return next;
      });
      setSessionStreak(0);
      nextCard();
    }
  };

  const handleSpeak = async (e: React.MouseEvent, text: string) => {
    e.preventDefault();
    e.stopPropagation(); 
    if (isSpeaking) return;
    setIsSpeaking(true);

    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Read this Italian word clearly: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio && audioCtxRef.current) {
        const decodedBytes = decode(base64Audio);
        const audioBuffer = await decodeAudioData(decodedBytes, audioCtxRef.current, 24000, 1);
        const source = audioCtxRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtxRef.current.destination);
        source.onended = () => {
          setIsSpeaking(false);
          source.disconnect();
        };
        source.start();
      } else {
        setIsSpeaking(false);
      }
    } catch (err) {
      console.error("TTS Error:", err);
      setIsSpeaking(false);
    }
  };

  const toggleMode = () => {
    setMode((prev) => prev === LanguageMode.EN_TO_IT ? LanguageMode.IT_TO_EN : LanguageMode.EN_TO_IT);
    setIsFlipped(false);
    setAiContext(null);
  };

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  const getAiSentence = async () => {
    if (isLoadingAi) return;
    setIsLoadingAi(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Generate a short, natural Italian sentence using the word "${currentWord.it}". 
                   Also provide the English translation. Keep it friendly and relevant to a travel vlog context.`,
        config: {
          systemInstruction: "You are an Italian language tutor. Provide concise examples.",
          temperature: 0.7,
        }
      });
      setAiContext(response.text || "Could not generate example.");
    } catch (err) {
      console.error("AI Error:", err);
      setAiContext("Error fetching AI context. Please check your API key.");
    } finally {
      setIsLoadingAi(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex flex-col">
              <h1 className="text-sm font-black text-gray-900 tracking-tight leading-none">Italiano Flash</h1>
              <div className="flex mt-1">
                <div className="w-2 h-1 bg-emerald-600"></div>
                <div className="w-2 h-1 bg-gray-100"></div>
                <div className="w-2 h-1 bg-red-600"></div>
              </div>
            </div>
          </div>
          <p className="text-gray-500 text-sm mb-4">
            Sign in to access your Italian flashcard practice.
          </p>
          {loginError && (
            <div className="mb-4 bg-rose-50 text-rose-600 text-xs font-medium px-3 py-2 rounded-2xl border border-rose-100">
              {loginError}
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Username
              </label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-2xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Password
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-2xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              className="w-full mt-2 py-3 bg-emerald-500 text-white rounded-2xl text-sm font-black uppercase tracking-wide hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-100 active:scale-95 flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-lock"></i>
              Sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (shuffledVocab.length === 0) return null;

  const currentWord = shuffledVocab[currentIndex];
  const currentCardStreak = cardStreaks[currentWord.id] || 0;
  const masteryStatus = masteredIds.has(currentWord.id) ? 'mastered' : learningIds.has(currentWord.id) ? 'learning' : null;
  const totalInCurrentDeck = DECKS[activeDeckKey].length;
  const masteryPercentage = Math.round((masteredIds.size / Object.values(DECKS).reduce((acc, deck) => acc + deck.length, 0)) * 100);

  if (isSessionComplete) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-10 flex flex-col items-center animate-slide">
          <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center text-4xl mb-6 shadow-inner">
            🏆
          </div>
          <h2 className="text-3xl font-black text-gray-900 mb-2">Session Complete!</h2>
          <p className="text-gray-500 mb-8">Ottimo lavoro! Review your results.</p>
          
          <div className="grid grid-cols-2 gap-4 w-full mb-8">
            <div className="bg-emerald-50 p-4 rounded-2xl">
              <p className="text-[10px] text-emerald-600 font-bold uppercase mb-1">Score</p>
              <p className="text-2xl font-black text-emerald-700">{score}</p>
            </div>
            <div className="bg-orange-50 p-4 rounded-2xl">
              <p className="text-[10px] text-orange-600 font-bold uppercase mb-1">Missed</p>
              <p className="text-2xl font-black text-orange-700">{learningIds.size}</p>
            </div>
            <div className="bg-blue-50 p-4 rounded-2xl col-span-2">
              <p className="text-[10px] text-blue-600 font-bold uppercase mb-1">Overall Progress</p>
              <p className="text-2xl font-black text-blue-700">{masteryPercentage}%</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 w-full">
            <button 
              onClick={() => shuffleWithMode('hard')}
              className="w-full py-4 bg-orange-500 text-white rounded-2xl font-bold hover:bg-orange-600 transition-all shadow-xl shadow-orange-100 active:scale-95 flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-bolt"></i>
              Focus on Hard Words
            </button>
            <button 
              onClick={() => shuffleWithMode(practiceMode)}
              className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-xl active:scale-95"
            >
              Restart Deck
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hardIds = getHardWordIds(cardStreaks, learningIds, stats?.hardWordIds ?? []);
  const hardWordsList = getAllWords().filter((w) => hardIds.includes(w.id));

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center pb-32 overflow-x-hidden">
      {showHardList && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowHardList(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-gray-900">🔥 Hard words</h3>
              <button type="button" onClick={() => setShowHardList(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <ul className="p-4 overflow-y-auto flex-1 space-y-2">
              {hardWordsList.length === 0 ? (
                <li className="text-gray-500 text-sm">No hard words yet. Keep practicing!</li>
              ) : (
                hardWordsList.map((w) => (
                  <li key={w.id} className="flex justify-between items-center py-2 px-3 bg-rose-50/50 rounded-xl border border-rose-100">
                    <span className="text-gray-800 font-medium text-sm">{w.en}</span>
                    <span className="text-rose-600 text-sm font-medium">{w.it}</span>
                  </li>
                ))
              )}
            </ul>
            <div className="p-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => { setShowHardList(false); setPracticeMode('hard'); shuffleWithMode('hard'); }}
                className="w-full py-3 bg-rose-500 text-white rounded-xl text-sm font-bold hover:bg-rose-600 transition-colors"
              >
                Practice these words
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="w-full bg-white border-b border-gray-200 py-3 px-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <h1 className="text-sm font-black text-gray-900 tracking-tight leading-none">Italiano Flash</h1>
            <div className="flex mt-1">
              <div className="w-2 h-1 bg-emerald-600"></div>
              <div className="w-2 h-1 bg-gray-100"></div>
              <div className="w-2 h-1 bg-red-600"></div>
            </div>
          </div>
          
          <select 
            value={activeDeckKey} 
            onChange={(e) => setActiveDeckKey(e.target.value as any)}
            className="bg-gray-100 text-[10px] font-black uppercase px-2 py-1 rounded-lg border-none focus:ring-2 focus:ring-emerald-500 text-gray-600 cursor-pointer"
          >
            <option value="CLASSIC">📚 Cultural</option>
            <option value="VLOG">🎬 Vlog Session</option>
            <option value="PRADA">👗 Prada List</option>
            <option value="TIS">💊 TIS Pharma</option>
            <option value="ADVERBS">🎯 Adverbs & Questions</option>
            <option value="PHRASES">💬 Phrases</option>
          </select>
          <select
            value={practiceMode}
            onChange={(e) => setPracticeMode(e.target.value as PracticeMode)}
            className="bg-gray-100 text-[10px] font-black uppercase px-2 py-1 rounded-lg border-none focus:ring-2 focus:ring-emerald-500 text-gray-600 cursor-pointer"
            title="Practice mode"
          >
            <option value="mixed">🔄 Mixed</option>
            <option value="hard">🔥 Hard</option>
            <option value="mastered">✅ Mastered</option>
          </select>
          {getHardWordIds(cardStreaks, learningIds, stats?.hardWordIds ?? []).length > 0 && (
            <button
              type="button"
              onClick={() => setShowHardList(true)}
              className="bg-rose-50 text-rose-600 px-2 py-1 rounded-lg text-[10px] font-black uppercase border border-rose-200 hover:bg-rose-100 transition-colors flex items-center gap-1"
              title="View hard words list"
            >
              🔥 List
            </button>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {stats != null && (
            <div className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded-full border border-slate-200 text-[10px] font-bold text-slate-600">
              <span title="Today">📅 {stats.dailyAttempts}</span>
              <span className="text-slate-300">|</span>
              <span title="This week">📆 {stats.weeklyAttempts}</span>
              {stats.hardWordIds.length > 0 && (
                <>
                  <span className="text-slate-300">|</span>
                  <span title="Hard words to review">🔥 {stats.hardWordIds.length}</span>
                </>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5 bg-yellow-50 px-3 py-1.5 rounded-full border border-yellow-100">
            <i className="fa-solid fa-star text-yellow-500 text-[10px]"></i>
            <span className="text-xs font-black text-yellow-700">{score}</span>
          </div>
          
          <button 
            onClick={toggleMode}
            className="bg-gray-900 text-white px-3 py-1.5 rounded-full text-[10px] font-black uppercase flex items-center gap-1.5 hover:bg-gray-800 transition-colors"
          >
            <i className="fa-solid fa-right-left"></i>
            {mode === LanguageMode.EN_TO_IT ? 'EN' : 'IT'}
          </button>
        </div>
      </header>

      <div className="w-full max-w-md px-6 mt-6">
        <div className="flex justify-between items-end mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              Deck: {activeDeckKey === 'VLOG' ? 'Vlog' : activeDeckKey === 'PRADA' ? 'Prada' : activeDeckKey === 'TIS' ? 'TIS' : activeDeckKey === 'ADVERBS' ? 'Adverbs' : activeDeckKey === 'PHRASES' ? 'Phrases' : 'Classic'}
              {practiceMode === 'hard' && ' · Hard'}
              {practiceMode === 'mastered' && ' · Mastered'}
            </span>
          </div>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{currentIndex + 1} / {totalInCurrentDeck}</span>
        </div>
        <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden flex">
          <div 
            className="h-full bg-emerald-500 transition-all duration-300" 
            style={{ width: `${((currentIndex + 1) / totalInCurrentDeck) * 100}%` }}
          ></div>
        </div>
      </div>

      <main className="flex-1 w-full flex flex-col items-center justify-center p-6 mt-2">
        <Flashcard 
          word={{
            ...currentWord,
            description: masteryStatus === 'mastered' ? `(Mastered) ${currentWord.description || ''}` : currentWord.description
          }} 
          isFlipped={isFlipped} 
          onFlip={handleFlip} 
          mode={mode} 
          onSpeak={handleSpeak}
          isSpeaking={isSpeaking}
          cardStreak={currentCardStreak}
        />

        <div className={`mt-6 flex gap-4 transition-all duration-300 w-full max-w-sm ${isFlipped ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
          <button 
            onClick={(e) => { e.stopPropagation(); markPerformance('learning'); }}
            className="flex-1 bg-white border-2 border-rose-200 text-rose-600 py-4 rounded-2xl font-bold text-sm hover:bg-rose-50 flex flex-col items-center justify-center gap-1 shadow-sm transition-all active:scale-95 group"
          >
            <i className="fa-solid fa-thumbs-down text-xl group-hover:-rotate-12 transition-transform"></i>
            <span className="text-[10px] uppercase font-black">Too Hard</span>
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); markPerformance('mastered'); }}
            className="flex-1 bg-emerald-500 text-white py-4 rounded-2xl font-bold text-sm hover:bg-emerald-600 flex flex-col items-center justify-center gap-1 shadow-lg shadow-emerald-100 transition-all active:scale-95 group"
          >
            <i className="fa-solid fa-thumbs-up text-xl group-hover:rotate-12 transition-transform"></i>
            <span className="text-[10px] uppercase font-black">I Got It!</span>
          </button>
        </div>

        <div className="mt-8 w-full max-w-sm">
          {aiContext ? (
            <div className="bg-white border border-gray-200 p-5 rounded-2xl animate-slide relative shadow-sm">
              <button 
                onClick={() => setAiContext(null)}
                className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 transition-colors"
              >
                <i className="fa-solid fa-xmark text-xs"></i>
              </button>
              <h4 className="text-[10px] font-black text-emerald-600 uppercase mb-3 flex items-center gap-2">
                <i className="fa-solid fa-sparkles"></i> AI Context Example
              </h4>
              <p className="text-gray-800 text-sm leading-relaxed italic">
                "{aiContext}"
              </p>
            </div>
          ) : (
            <button 
              onClick={getAiSentence}
              disabled={isLoadingAi}
              className="w-full py-4 bg-white border-2 border-dashed border-gray-200 rounded-2xl text-gray-400 text-xs font-black uppercase tracking-widest hover:border-emerald-300 hover:text-emerald-500 transition-all flex items-center justify-center gap-2"
            >
              {isLoadingAi ? <i className="fa-solid fa-spinner animate-spin"></i> : <i className="fa-solid fa-wand-magic-sparkles"></i>}
              {isLoadingAi ? 'Consulting Gemini...' : 'Use AI to generate example'}
            </button>
          )}
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 pb-8 flex items-center justify-center gap-8 shadow-lg z-40">
        <button 
          onClick={prevCard}
          disabled={currentIndex === 0}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90 ${currentIndex === 0 ? 'text-gray-200 cursor-not-allowed' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
        >
          <i className="fa-solid fa-chevron-left"></i>
        </button>

        <button 
          onClick={() => shuffleWithMode(practiceMode)}
          className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center text-white hover:bg-emerald-600 transition-all active:rotate-180 shadow-lg"
        >
          <i className="fa-solid fa-rotate text-lg"></i>
        </button>

        <button 
          onClick={nextCard}
          className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-all active:scale-90"
        >
          <i className="fa-solid fa-chevron-right"></i>
        </button>
      </nav>
    </div>
  );
};

export default App;
