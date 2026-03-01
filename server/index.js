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
      updatedAt: new Date(),
    };

    const wordStreaks = progress.wordStreaks || {};
    const current = wordStreaks[wordId] || 0;
    const newStreak = outcome === 'mastered' ? (current > 0 ? current + 1 : 1) : (current < 0 ? current - 1 : -1);
    wordStreaks[wordId] = newStreak;

    let masteredIds = [...(progress.masteredIds || [])];
    let learningIds = [...(progress.learningIds || [])];
    if (outcome === 'mastered') {
      if (!masteredIds.includes(wordId)) masteredIds.push(wordId);
      learningIds = learningIds.filter((id) => id !== wordId);
    } else {
      if (!learningIds.includes(wordId)) learningIds.push(wordId);
      masteredIds = masteredIds.filter((id) => id !== wordId);
    }

    await progressCol.updateOne(
      { userId },
      {
        $set: {
          wordStreaks,
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
      });
    }
    return res.json({
      wordStreaks: progress.wordStreaks || {},
      masteredIds: progress.masteredIds || [],
      learningIds: progress.learningIds || [],
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
