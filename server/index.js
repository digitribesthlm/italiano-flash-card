import dotenv from 'dotenv';
import express from 'express';
import { MongoClient } from 'mongodb';
import cors from 'cors';

dotenv.config({ path: '.env.local' });

const app = express();
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URL_TASK_MANAGER;
const DB_NAME = process.env.MONGO_DB_NAME || 'task-manager';

let db = null;

async function getDb() {
  if (db) return db;
  if (!MONGODB_URI) throw new Error('Missing MONGODB_URL_TASK_MANAGER');
  const client = await MongoClient.connect(MONGODB_URI);
  db = client.db(DB_NAME);
  return db;
}

const COLLECTION_ATTEMPTS = 'flash_attempts';
const COLLECTION_PROGRESS = 'flash_progress';
const COLLECTION_DECKS = 'flash_decks';
const COLLECTION_SESSIONS = 'flash_sessions';
const COLLECTION_DAILY_LISTS = 'flash_daily_lists';

// SM-2 spaced repetition algorithm.
// quality: 0-5 (0=total failure, 5=perfect).
// Returns { ease, interval, repetitions, nextReview }.
function sm2(quality, prevEase, prevInterval, prevRepetitions) {
  let ease = prevEase || 2.5;
  let interval = prevInterval || 0;
  let repetitions = prevRepetitions || 0;

  if (quality < 3) {
    // Failed: reset
    repetitions = 0;
    interval = 1;
  } else {
    // Passed
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * ease);
    }
    repetitions += 1;
  }

  // Update ease factor
  ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ease < 1.3) ease = 1.3;

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);
  nextReview.setHours(0, 0, 0, 0);

  return { ease: Math.round(ease * 100) / 100, interval, repetitions, nextReview };
}

// Map app outcome to SM-2 quality.
// "learning" = user failed the card → quality 1
// "mastered" = user got it right → quality 4
function outcomeToQuality(outcome) {
  return outcome === 'mastered' ? 4 : 1;
}

// POST /api/attempts — record one attempt and update user progress
app.post('/api/attempts', async (req, res) => {
  try {
    const { userId, wordId, deckKey, outcome } = req.body;
    if (!userId || !wordId || !outcome) {
      return res.status(400).json({ error: 'userId, wordId, outcome required' });
    }
    if (outcome !== 'mastered' && outcome !== 'learning') {
      return res.status(400).json({ error: 'outcome must be mastered or learning' });
    }

    const database = await getDb();
    const attempts = database.collection(COLLECTION_ATTEMPTS);
    const progressCol = database.collection(COLLECTION_PROGRESS);

    const doc = {
      userId,
      wordId,
      deckKey: deckKey || null,
      outcome,
      createdAt: new Date(),
    };
    await attempts.insertOne(doc);

    const progress = await progressCol.findOne({ userId }) || {
      userId,
      wordStreaks: {},
      masteredIds: [],
      learningIds: [],
      failCounts: {},
      wordEase: {},
      wordInterval: {},
      wordRepetitions: {},
      wordNextReview: {},
      updatedAt: new Date(),
    };

    // Existing streak/failCount logic
    const wordStreaks = progress.wordStreaks || {};
    const failCounts = progress.failCounts || {};
    const current = wordStreaks[wordId] || 0;
    const newStreak = outcome === 'mastered' ? (current > 0 ? current + 1 : 1) : (current < 0 ? current - 1 : -1);
    wordStreaks[wordId] = newStreak;
    if (outcome === 'learning') failCounts[wordId] = (failCounts[wordId] || 0) + 1;

    let masteredIds = [...(progress.masteredIds || [])];
    let learningIds = [...(progress.learningIds || [])];
    if (outcome === 'mastered') {
      if (!masteredIds.includes(wordId)) masteredIds.push(wordId);
      learningIds = learningIds.filter((id) => id !== wordId);
      delete failCounts[wordId];
    } else {
      if (!learningIds.includes(wordId)) learningIds.push(wordId);
      masteredIds = masteredIds.filter((id) => id !== wordId);
    }

    // SM-2 scheduling
    const quality = outcomeToQuality(outcome);
    const wordEase = progress.wordEase || {};
    const wordInterval = progress.wordInterval || {};
    const wordRepetitions = progress.wordRepetitions || {};
    const wordNextReview = progress.wordNextReview || {};

    const sm2Result = sm2(
      quality,
      wordEase[wordId],
      wordInterval[wordId],
      wordRepetitions[wordId] || 0
    );

    wordEase[wordId] = sm2Result.ease;
    wordInterval[wordId] = sm2Result.interval;
    wordRepetitions[wordId] = sm2Result.repetitions;
    wordNextReview[wordId] = sm2Result.nextReview.toISOString();

    await progressCol.updateOne(
      { userId },
      {
        $set: {
          wordStreaks,
          failCounts,
          masteredIds,
          learningIds,
          wordEase,
          wordInterval,
          wordRepetitions,
          wordNextReview,
          lastReviewDate: new Date().toISOString(),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/attempts', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/progress?userId= — get user progress including SM-2 fields
app.get('/api/progress', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const database = await getDb();
    const progress = await database.collection(COLLECTION_PROGRESS).findOne({ userId });
    if (!progress) {
      return res.json({
        wordStreaks: {},
        masteredIds: [],
        learningIds: [],
        failCounts: {},
        wordEase: {},
        wordInterval: {},
        wordNextReview: {},
      });
    }
    return res.json({
      wordStreaks: progress.wordStreaks || {},
      masteredIds: progress.masteredIds || [],
      learningIds: progress.learningIds || [],
      failCounts: progress.failCounts || {},
      wordEase: progress.wordEase || {},
      wordInterval: progress.wordInterval || {},
      wordNextReview: progress.wordNextReview || {},
    });
  } catch (err) {
    console.error('GET /api/progress', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/stats?userId= — daily/weekly stats and hard word ids
app.get('/api/stats', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const database = await getDb();
    const attempts = database.collection(COLLECTION_ATTEMPTS);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);

    const [daily, weekly, allAttempts] = await Promise.all([
      attempts.countDocuments({ userId, createdAt: { $gte: startOfToday } }),
      attempts.countDocuments({ userId, createdAt: { $gte: startOfWeek } }),
      attempts
        .aggregate([
          { $match: { userId } },
          { $sort: { createdAt: -1 } },
          { $group: { _id: '$wordId', lastOutcome: { $first: '$outcome' }, count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);

    const progress = await database.collection(COLLECTION_PROGRESS).findOne({ userId });
    const wordStreaks = progress?.wordStreaks || {};
    const hardWordIds = Object.entries(wordStreaks)
      .filter(([, streak]) => streak <= -2)
      .map(([id]) => id);

    // Count words due for review today
    const wordNextReview = progress?.wordNextReview || {};
    const todayStr = startOfToday.toISOString().split('T')[0];
    const dueCount = Object.entries(wordNextReview).filter(([, d]) => {
      const revDate = new Date(d).toISOString().split('T')[0];
      return revDate <= todayStr;
    }).length;

    return res.json({
      dailyAttempts: daily,
      weeklyAttempts: weekly,
      hardWordIds,
      totalWordsAttempted: allAttempts.length,
      dueCount,
    });
  } catch (err) {
    console.error('GET /api/stats', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/decks?deckKey= — list all decks or a single deck with its words
app.get('/api/decks', async (req, res) => {
  try {
    const database = await getDb();
    const query = {};
    if (req.query.deckKey) query.deckKey = req.query.deckKey;
    const decks = await database.collection(COLLECTION_DECKS).find(query).toArray();
    return res.json(decks);
  } catch (err) {
    console.error('GET /api/decks', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/daily-list?userId=X&count=30 — generate personalized daily word list
app.get('/api/daily-list', async (req, res) => {
  try {
    const userId = req.query.userId;
    const count = parseInt(req.query.count || '30', 10);
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const database = await getDb();

    // Get all words from all decks
    const decks = await database.collection(COLLECTION_DECKS).find({}).toArray();
    const allWords = [];
    const seen = new Set();
    for (const deck of decks) {
      for (const w of deck.words || []) {
        if (!seen.has(w.id)) {
          seen.add(w.id);
          allWords.push(w);
        }
      }
    }

    // Get user progress
    const progress = await database.collection(COLLECTION_PROGRESS).findOne({ userId });
    const wordEase = progress?.wordEase || {};
    const wordNextReview = progress?.wordNextReview || {};
    const wordStreaks = progress?.wordStreaks || {};
    const failCounts = progress?.failCounts || {};
    const learningIds = new Set(progress?.learningIds || []);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Seeded PRNG for deterministic new-word rotation per user per day
    const dateSeed = parseInt(todayStr.replace(/-/g, ''), 10);
    const userSeed = userId.split('').reduce((h, c) => h + c.charCodeAt(0), 0);
    let newWordSeed = dateSeed + userSeed;

    // Partition words into four buckets
    const learningWords = [];
    const dueReviewWords = [];
    const scheduledWords = [];
    const newWordsRaw = [];

    for (const w of allWords) {
      const nextReviewRaw = wordNextReview[w.id];
      const ease = wordEase[w.id] || 2.5;
      const streak = wordStreaks[w.id] || 0;
      const failCount = failCounts[w.id] || 0;

      if (learningIds.has(w.id)) {
        // Force-include: score for ordering within learning bucket
        let priority = 10;
        if (nextReviewRaw) {
          const nextReview = new Date(nextReviewRaw);
          const daysOverdue = Math.floor((today - nextReview) / (1000 * 60 * 60 * 24));
          const daysFactor = Math.max(daysOverdue + 1, 1);
          const easeFactor = Math.pow(8, 3.0 - ease);
          const failFactor = Math.pow(2, Math.min(failCount, 5));
          const streakFactor = streak < 0 ? (1 + Math.abs(streak) * 0.5) : 1;
          priority = daysFactor * easeFactor * 5 * failFactor * streakFactor;
        }
        learningWords.push({ ...w, priority, category: 'learning', ease, streak, nextReview: nextReviewRaw || null });
      } else if (nextReviewRaw) {
        const nextReview = new Date(nextReviewRaw);
        const daysOverdue = Math.floor((today - nextReview) / (1000 * 60 * 60 * 24));
        if (daysOverdue >= 0) {
          const daysFactor = daysOverdue + 1;
          const easeFactor = Math.pow(8, 3.0 - ease);
          const failFactor = Math.pow(2, Math.min(failCount, 5));
          const streakFactor = streak < 0 ? (1 + Math.abs(streak) * 0.5) : 1;
          const priority = daysFactor * easeFactor * 5 * failFactor * streakFactor;
          dueReviewWords.push({ ...w, priority, category: 'review', ease, streak, nextReview: nextReviewRaw });
        } else {
          scheduledWords.push({ ...w, priority: daysOverdue, category: 'scheduled', ease, streak, nextReview: nextReviewRaw });
        }
      } else {
        newWordsRaw.push({ ...w, priority: 0, category: 'new', ease, streak, nextReview: null });
      }
    }

    // Sort buckets
    learningWords.sort((a, b) => b.priority - a.priority || a.ease - b.ease);
    dueReviewWords.sort((a, b) => b.priority - a.priority || a.ease - b.ease);
    scheduledWords.sort((a, b) => b.priority - a.priority || a.ease - b.ease);

    // Seeded shuffle for new words (same order all day for the same user)
    const newWords = (() => {
      const a = [...newWordsRaw];
      for (let i = a.length - 1; i > 0; i--) {
        newWordSeed = (newWordSeed * 16807 + 0) % 2147483647;
        const j = newWordSeed % (i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    })();

    // Force-include ALL learning words
    const selected = [...learningWords];

    // Dynamic list size: cover all due words, min 30, max 60
    const MIN_LIST_SIZE = 30;
    const MAX_LIST_SIZE = 60;
    const totalDueToday = dueReviewWords.length + learningWords.length;
    const effectiveCount = Math.min(
      Math.max(count, totalDueToday + 5, MIN_LIST_SIZE),
      MAX_LIST_SIZE
    );

    const slotsLeft = effectiveCount - selected.length;

    if (slotsLeft > 0) {
      const desiredReview = Math.round(slotsLeft * 0.75);
      let reviewSlots = Math.min(dueReviewWords.length, desiredReview);
      let newSlots = Math.min(newWords.length, slotsLeft - reviewSlots);

      if (newSlots < slotsLeft - reviewSlots) {
        reviewSlots = Math.min(dueReviewWords.length, slotsLeft - newSlots);
      }

      for (let i = 0; i < reviewSlots; i++) selected.push(dueReviewWords[i]);
      for (let i = 0; i < newSlots; i++) selected.push(newWords[i]);
    }

    // Check for existing daily list today
    const existingList = await database.collection(COLLECTION_DAILY_LISTS).findOne({
      userId,
      date: todayStr,
    });

    // Save/cache the generated list
    await database.collection(COLLECTION_DAILY_LISTS).updateOne(
      { userId, date: todayStr },
      {
        $set: {
          userId,
          date: todayStr,
          wordIds: selected.map((w) => w.id),
          count: selected.length,
          completed: existingList?.completed || false,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    const newCount = selected.filter((w) => w.category === 'new').length;
    const reviewCount = selected.filter((w) => w.category === 'review').length;
    const learningCount = selected.filter((w) => w.category === 'learning').length;

    return res.json({
      words: selected,
      total: selected.length,
      newCount,
      reviewCount,
      learningCount,
      completed: existingList?.completed || false,
    });
  } catch (err) {
    console.error('GET /api/daily-list', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/daily-list/complete — mark today's daily list as done
app.post('/api/daily-list/complete', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const database = await getDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    await database.collection(COLLECTION_DAILY_LISTS).updateOne(
      { userId, date: todayStr },
      { $set: { completed: true, completedAt: new Date() } }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/daily-list/complete', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions — save a completed practice session
app.post('/api/sessions', async (req, res) => {
  try {
    const { userId, deckKey, score, wordsAttempted, wordsMastered, wordsLearning, duration } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const database = await getDb();
    const doc = {
      userId,
      deckKey: deckKey || null,
      score: score || 0,
      wordsAttempted: wordsAttempted || 0,
      wordsMastered: wordsMastered || 0,
      wordsLearning: wordsLearning || 0,
      duration: duration || null,
      createdAt: new Date(),
    };
    await database.collection(COLLECTION_SESSIONS).insertOne(doc);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/sessions', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions?userId=&limit=&days= — session history
app.get('/api/sessions', async (req, res) => {
  try {
    const { userId, limit, days } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const database = await getDb();
    const query = { userId };
    if (days) {
      const since = new Date();
      since.setDate(since.getDate() - parseInt(days, 10));
      query.createdAt = { $gte: since };
    }
    const sessions = await database.collection(COLLECTION_SESSIONS)
      .find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit || '50', 10))
      .toArray();
    return res.json(sessions);
  } catch (err) {
    console.error('GET /api/sessions', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/leaderboard?userId= — aggregate stats for progress dashboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const database = await getDb();
    const sessions = database.collection(COLLECTION_SESSIONS);
    const progressCol = database.collection(COLLECTION_PROGRESS);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todaySessions, weekSessions, monthSessions, allSessions, progress] = await Promise.all([
      sessions.countDocuments({ userId, createdAt: { $gte: startOfToday } }),
      sessions.countDocuments({ userId, createdAt: { $gte: startOfWeek } }),
      sessions.countDocuments({ userId, createdAt: { $gte: startOfMonth } }),
      sessions.find({ userId }).sort({ createdAt: -1 }).limit(100).toArray(),
      progressCol.findOne({ userId }),
    ]);

    const totalScore = allSessions.reduce((sum, s) => sum + (s.score || 0), 0);
    const totalMastered = allSessions.reduce((sum, s) => sum + (s.wordsMastered || 0), 0);
    const masteredIds = progress?.masteredIds || [];
    const hardIds = Object.entries(progress?.wordStreaks || {})
      .filter(([, s]) => s <= -2)
      .map(([id]) => id);

    // Due count for today
    const wordNextReview = progress?.wordNextReview || {};
    const todayStr = startOfToday.toISOString().split('T')[0];
    const dueCount = Object.entries(wordNextReview).filter(([, d]) => {
      const revDate = new Date(d).toISOString().split('T')[0];
      return revDate <= todayStr;
    }).length;

    // Best session
    const bestSession = allSessions.length > 0
      ? allSessions.reduce((best, s) => (s.score || 0) > (best.score || 0) ? s : best, allSessions[0])
      : null;

    // Daily streak (consecutive days with at least one session)
    let dailyStreak = 0;
    const daySet = new Set(allSessions.map(s => new Date(s.createdAt).toDateString()));
    const check = new Date(startOfToday);
    while (daySet.has(check.toDateString())) {
      dailyStreak++;
      check.setDate(check.getDate() - 1);
    }

    return res.json({
      totalScore,
      totalMastered,
      totalWordsMastered: masteredIds.length,
      hardWordCount: hardIds.length,
      hardWordIds: hardIds,
      masteredIds,
      sessionsToday: todaySessions,
      sessionsThisWeek: weekSessions,
      sessionsThisMonth: monthSessions,
      dailyStreak,
      bestScore: bestSession?.score || 0,
      recentSessions: allSessions.slice(0, 10),
      dueCount,
    });
  } catch (err) {
    console.error('GET /api/leaderboard', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/deck-stats?userId= — per-deck statistics for improvement tracking
app.get('/api/deck-stats', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const database = await getDb();
    const sessions = database.collection(COLLECTION_SESSIONS);
    const attempts = database.collection(COLLECTION_ATTEMPTS);
    const decksCol = database.collection(COLLECTION_DECKS);

    // Get all decks for labels and word counts
    const allDecks = await decksCol.find({}).toArray();
    const deckMeta = {};
    for (const d of allDecks) {
      deckMeta[d.deckKey] = {
        label: d.label || d.deckKey,
        wordCount: (d.words || []).length,
      };
    }

    // Aggregate attempts per deck
    const attemptAgg = await attempts.aggregate([
      { $match: { userId } },
      { $group: {
        _id: '$deckKey',
        totalAttempts: { $sum: 1 },
        masteredAttempts: { $sum: { $cond: [{ $eq: ['$outcome', 'mastered'] }, 1, 0] } },
        distinctWords: { $addToSet: '$wordId' },
        lastAttempt: { $max: '$createdAt' },
      }},
    ]).toArray();

    // Aggregate sessions per deck
    const sessionAgg = await sessions.aggregate([
      { $match: { userId } },
      { $group: {
        _id: '$deckKey',
        sessionsPlayed: { $sum: 1 },
        highScore: { $max: '$score' },
        avgScore: { $avg: '$score' },
        lastPlayed: { $max: '$createdAt' },
      }},
    ]).toArray();

    // Get last 10 session scores + wordsLearning per deck for trend & comparison
    const recentScoresByDeck = {};
    const recentLearningByDeck = {};
    const prevSessionByDeck = {};
    const allUserSessions = await sessions.find({ userId }).sort({ createdAt: -1 }).toArray();
    for (const s of allUserSessions) {
      const dk = s.deckKey || '__unknown__';
      if (!recentScoresByDeck[dk]) {
        recentScoresByDeck[dk] = [];
        recentLearningByDeck[dk] = [];
      }
      if (recentScoresByDeck[dk].length < 10) {
        recentScoresByDeck[dk].push(s.score || 0);
        recentLearningByDeck[dk].push(s.wordsLearning || 0);
      }
      // Capture the previous session (second most recent, since first is current)
      if (!prevSessionByDeck[dk] && recentScoresByDeck[dk].length === 2) {
        prevSessionByDeck[dk] = {
          score: s.score || 0,
          wordsLearning: s.wordsLearning || 0,
          wordsMastered: s.wordsMastered || 0,
          wordsAttempted: s.wordsAttempted || 0,
        };
      }
    }

    // Build per-deck previous-high (max score excluding most recent session)
    const prevHighByDeck = {};
    const sessionsByDeck = {};
    for (const s of allUserSessions) {
      const dk = s.deckKey || '__unknown__';
      if (!sessionsByDeck[dk]) sessionsByDeck[dk] = [];
      sessionsByDeck[dk].push(s.score || 0);
    }
    for (const [dk, scores] of Object.entries(sessionsByDeck)) {
      prevHighByDeck[dk] = scores.length > 1 ? Math.max(...scores.slice(1)) : 0;
    }

    // Build per-deck stats
    const sessionByDeck = {};
    for (const s of sessionAgg) sessionByDeck[s._id || '__unknown__'] = s;

    const attemptByDeck = {};
    for (const a of attemptAgg) attemptByDeck[a._id || '__unknown__'] = a;

    const decks = allDecks.map((d) => {
      const dk = d.deckKey;
      const meta = deckMeta[dk] || { label: dk, wordCount: 0 };
      const sess = sessionByDeck[dk] || {};
      const att = attemptByDeck[dk] || {};
      const recentScores = recentScoresByDeck[dk] || [];
      const recentLearning = recentLearningByDeck[dk] || [];
      const prevSession = prevSessionByDeck[dk] || null;

      const sessionsPlayed = sess.sessionsPlayed || 0;
      const totalAttempts = att.totalAttempts || 0;
      const masteredAttempts = att.masteredAttempts || 0;
      const masteryRate = totalAttempts > 0 ? Math.round((masteredAttempts / totalAttempts) * 100) : 0;
      const wordsSeen = att.distinctWords ? att.distinctWords.length : 0;
      const highScore = sess.highScore || 0;
      const avgScore = sess.avgScore ? Math.round(sess.avgScore) : 0;
      const recentAvgScore = recentScores.length > 0
        ? Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length)
        : 0;
      const avgWordsLearning = recentLearning.length > 0
        ? Math.round(recentLearning.reduce((a, b) => a + b, 0) / recentLearning.length)
        : 0;
      // Trend: positive = improving, negative = declining
      const trend = recentScores.length >= 3
        ? Math.round(recentScores.slice(0, Math.floor(recentScores.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(recentScores.length / 2))
          - Math.round(recentScores.slice(-Math.floor(recentScores.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(recentScores.length / 2))
        : 0;

      return {
        deckKey: dk,
        label: meta.label,
        wordCount: meta.wordCount,
        highScore,
        prevHigh: prevHighByDeck[dk] || 0,
        avgScore,
        sessionsPlayed,
        totalAttempts,
        masteryRate,
        wordsSeen,
        completionPct: meta.wordCount > 0 ? Math.round((wordsSeen / meta.wordCount) * 100) : 0,
        lastPlayed: sess.lastPlayed || att.lastAttempt || null,
        recentScores,
        recentAvgScore,
        trend,
        avgWordsLearning,
        prevSession,
      };
    });

    // Sort: active decks first (by lastPlayed desc), then unplayed
    decks.sort((a, b) => {
      if (!a.lastPlayed && !b.lastPlayed) return 0;
      if (!a.lastPlayed) return 1;
      if (!b.lastPlayed) return -1;
      return new Date(b.lastPlayed) - new Date(a.lastPlayed);
    });

    return res.json({ decks });
  } catch (err) {
    console.error('GET /api/deck-stats', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
