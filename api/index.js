import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URL_TASK_MANAGER;
const DB_NAME = process.env.DATABASE_NAME_TASK_MANAGER || 'task-manager';

let client = null;

async function getDb() {
  if (!MONGODB_URI) throw new Error('Missing MONGODB_URL_TASK_MANAGER');
  if (!client) {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
  }
  return client.db(DB_NAME);
}

function json(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
  });
}

// Simple router
export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api/, '') || '/';

  try {
    // POST /api/attempts
    if (req.method === 'POST' && path === '/attempts') {
      const { userId, wordId, deckKey, outcome } = await parseBody(req);
      if (!userId || !wordId || !outcome) return json(res, { error: 'userId, wordId, outcome required' }, 400);
      if (outcome !== 'mastered' && outcome !== 'learning') return json(res, { error: 'outcome must be mastered or learning' }, 400);

      const db = await getDb();
      const attempts = db.collection('flash_attempts');
      const progressCol = db.collection('flash_progress');

      await attempts.insertOne({ userId, wordId, deckKey: deckKey || null, outcome, createdAt: new Date() });

      const progress = await progressCol.findOne({ userId }) || { userId, wordStreaks: {}, masteredIds: [], learningIds: [], failCounts: {}, updatedAt: new Date() };
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
      } else {
        if (!learningIds.includes(wordId)) learningIds.push(wordId);
        masteredIds = masteredIds.filter((id) => id !== wordId);
      }

      await progressCol.updateOne({ userId }, { $set: { wordStreaks, failCounts, masteredIds, learningIds, updatedAt: new Date() } }, { upsert: true });
      return json(res, { ok: true });
    }

    // GET /api/progress
    if (req.method === 'GET' && path === '/progress') {
      const userId = url.searchParams.get('userId');
      if (!userId) return json(res, { error: 'userId required' }, 400);
      const db = await getDb();
      const progress = await db.collection('flash_progress').findOne({ userId });
      if (!progress) return json(res, { wordStreaks: {}, masteredIds: [], learningIds: [], failCounts: {} });
      return json(res, {
        wordStreaks: progress.wordStreaks || {},
        masteredIds: progress.masteredIds || [],
        learningIds: progress.learningIds || [],
        failCounts: progress.failCounts || {},
      });
    }

    // GET /api/stats
    if (req.method === 'GET' && path === '/stats') {
      const userId = url.searchParams.get('userId');
      if (!userId) return json(res, { error: 'userId required' }, 400);
      const db = await getDb();
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(startOfToday);
      startOfWeek.setDate(startOfWeek.getDate() - 7);

      const [daily, weekly, allAttempts] = await Promise.all([
        db.collection('flash_attempts').countDocuments({ userId, createdAt: { $gte: startOfToday } }),
        db.collection('flash_attempts').countDocuments({ userId, createdAt: { $gte: startOfWeek } }),
        db.collection('flash_attempts').aggregate([
          { $match: { userId } }, { $sort: { createdAt: -1 } },
          { $group: { _id: '$wordId', lastOutcome: { $first: '$outcome' }, count: { $sum: 1 } } },
        ]).toArray(),
      ]);

      const progress = await db.collection('flash_progress').findOne({ userId });
      const wordStreaks = progress?.wordStreaks || {};
      const hardWordIds = Object.entries(wordStreaks).filter(([, s]) => s <= -2).map(([id]) => id);

      return json(res, { dailyAttempts: daily, weeklyAttempts: weekly, hardWordIds, totalWordsAttempted: allAttempts.length });
    }

    // GET /api/decks
    if (req.method === 'GET' && path === '/decks') {
      const db = await getDb();
      const query = {};
      if (url.searchParams.get('deckKey')) query.deckKey = url.searchParams.get('deckKey');
      const decks = await db.collection('flash_decks').find(query).toArray();
      return json(res, decks);
    }

    // POST /api/sessions
    if (req.method === 'POST' && path === '/sessions') {
      const { userId, deckKey, score, wordsAttempted, wordsMastered, wordsLearning, duration } = await parseBody(req);
      if (!userId) return json(res, { error: 'userId required' }, 400);
      const db = await getDb();
      await db.collection('flash_sessions').insertOne({
        userId, deckKey: deckKey || null, score: score || 0,
        wordsAttempted: wordsAttempted || 0, wordsMastered: wordsMastered || 0,
        wordsLearning: wordsLearning || 0, duration: duration || null, createdAt: new Date(),
      });
      return json(res, { ok: true });
    }

    // GET /api/sessions
    if (req.method === 'GET' && path === '/sessions') {
      const userId = url.searchParams.get('userId');
      if (!userId) return json(res, { error: 'userId required' }, 400);
      const db = await getDb();
      const query = { userId };
      const days = parseInt(url.searchParams.get('days') || '0', 10);
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        query.createdAt = { $gte: since };
      }
      const sessions = await db.collection('flash_sessions')
        .find(query).sort({ createdAt: -1 }).limit(parseInt(url.searchParams.get('limit') || '50', 10)).toArray();
      return json(res, sessions);
    }

    // GET /api/leaderboard
    if (req.method === 'GET' && path === '/leaderboard') {
      const userId = url.searchParams.get('userId');
      if (!userId) return json(res, { error: 'userId required' }, 400);
      const db = await getDb();

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(startOfToday);
      startOfWeek.setDate(startOfWeek.getDate() - 7);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [todaySessions, weekSessions, monthSessions, allSessions, progress] = await Promise.all([
        db.collection('flash_sessions').countDocuments({ userId, createdAt: { $gte: startOfToday } }),
        db.collection('flash_sessions').countDocuments({ userId, createdAt: { $gte: startOfWeek } }),
        db.collection('flash_sessions').countDocuments({ userId, createdAt: { $gte: startOfMonth } }),
        db.collection('flash_sessions').find({ userId }).sort({ createdAt: -1 }).limit(100).toArray(),
        db.collection('flash_progress').findOne({ userId }),
      ]);

      const totalScore = allSessions.reduce((sum, s) => sum + (s.score || 0), 0);
      const totalMastered = allSessions.reduce((sum, s) => sum + (s.wordsMastered || 0), 0);
      const masteredIds = progress?.masteredIds || [];
      const hardIds = Object.entries(progress?.wordStreaks || {}).filter(([, s]) => s <= -2).map(([id]) => id);

      const bestSession = allSessions.length > 0
        ? allSessions.reduce((best, s) => (s.score || 0) > (best.score || 0) ? s : best, allSessions[0])
        : null;

      let dailyStreak = 0;
      const daySet = new Set(allSessions.map(s => new Date(s.createdAt).toDateString()));
      const check = new Date(startOfToday);
      while (daySet.has(check.toDateString())) { dailyStreak++; check.setDate(check.getDate() - 1); }

      return json(res, {
        totalScore, totalMastered, totalWordsMastered: masteredIds.length,
        hardWordCount: hardIds.length, hardWordIds: hardIds, masteredIds,
        sessionsToday: todaySessions, sessionsThisWeek: weekSessions,
        sessionsThisMonth: monthSessions, dailyStreak,
        bestScore: bestSession?.score || 0, recentSessions: allSessions.slice(0, 10),
      });
    }

    return json(res, { error: 'Not found' }, 404);
  } catch (err) {
    console.error(`API ${req.method} ${path}`, err);
    return json(res, { error: err.message }, 500);
  }
}
