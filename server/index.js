import dotenv from 'dotenv';
import express from 'express';
import { MongoClient } from 'mongodb';
import cors from 'cors';

dotenv.config({ path: '.env.local' });

const app = express();
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URL_TASK_MANAGER || process.env.MONGODB_URI;
const DB_NAME = process.env.DATABASE_NAME_TASK_MANAGER || 'task-manager';

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
      updatedAt: new Date(),
    };

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

    await progressCol.updateOne(
      { userId },
      {
        $set: {
          wordStreaks,
          failCounts,
          masteredIds,
          learningIds,
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

// GET /api/progress?userId= — get user progress (streaks, mastered, learning)
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
      });
    }
    return res.json({
      wordStreaks: progress.wordStreaks || {},
      masteredIds: progress.masteredIds || [],
      learningIds: progress.learningIds || [],
      failCounts: progress.failCounts || {},
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

    return res.json({
      dailyAttempts: daily,
      weeklyAttempts: weekly,
      hardWordIds,
      totalWordsAttempted: allAttempts.length,
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
    });
  } catch (err) {
    console.error('GET /api/leaderboard', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
