// Seed script: uploads all vocabulary decks to the flash_decks collection in MongoDB.
// Run with: node seed_decks.js
// Existing documents for a deckKey are replaced to keep the collection idempotent.

import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config({ path: '.env.local' });

const MONGODB_URI = process.env.MONGODB_URL_TASK_MANAGER;
const DB_NAME = process.env.DATABASE_NAME_TASK_MANAGER || 'task-manager';
const COLLECTION = 'flash_decks';

const VOCABULARY_ADVERBS = [
  // Demonstratives & Location
  { id: 'a1', en: 'that (over there)', it: 'quello / quella', category: 'grammar' },
  { id: 'a2', en: 'here', it: 'qui / qua', category: 'grammar' },
  { id: 'a3', en: 'there', it: 'lì / là', category: 'grammar' },
  // Question Words
  { id: 'a4', en: 'how / like', it: 'come', category: 'grammar' },
  { id: 'a5', en: 'when', it: 'quando', category: 'grammar' },
  { id: 'a6', en: 'where', it: 'dove', category: 'grammar' },
  { id: 'a7', en: 'why / because', it: 'perché', category: 'grammar' },
  { id: 'a8', en: 'how much', it: 'quanto', category: 'grammar' },
  { id: 'a9', en: 'which', it: 'quale', category: 'grammar' },
  { id: 'a10', en: 'who', it: 'chi', category: 'grammar' },
  { id: 'a11', en: 'what', it: 'cosa / che cosa', category: 'grammar' },
  // Quantifiers & Indefinite Pronouns
  { id: 'a12', en: 'every', it: 'ogni', category: 'grammar' },
  { id: 'a13', en: 'everything / all', it: 'tutto / tutta', category: 'grammar' },
  { id: 'a14', en: 'nothing', it: 'niente / nulla', category: 'grammar' },
  { id: 'a15', en: 'something', it: 'qualcosa', category: 'grammar' },
  { id: 'a16', en: 'someone', it: 'qualcuno', category: 'grammar' },
  { id: 'a17', en: 'nobody', it: 'nessuno', category: 'grammar' },
  // Frequency & Time Adverbs
  { id: 'a18', en: 'still / again / yet', it: 'ancora', category: 'grammar' },
  { id: 'a19', en: 'already', it: 'già', category: 'grammar' },
  { id: 'a20', en: 'always', it: 'sempre', category: 'grammar' },
  { id: 'a21', en: 'never', it: 'mai', category: 'grammar' },
  { id: 'a22', en: 'often', it: 'spesso', category: 'grammar' },
  { id: 'a23', en: 'immediately', it: 'subito', category: 'grammar' },
  // Manner & Discourse Adverbs
  { id: 'a24', en: 'together', it: 'insieme', category: 'grammar' },
  { id: 'a25', en: 'maybe', it: 'forse', category: 'grammar' },
  { id: 'a26', en: 'anyway', it: 'comunque', category: 'grammar' },
  { id: 'a27', en: 'however', it: 'però', category: 'grammar' },
  { id: 'a28', en: 'also / too', it: 'anche', category: 'grammar' },
  { id: 'a29', en: 'only / just', it: 'solo', category: 'grammar' },
  { id: 'a30', en: 'so / like this', it: 'così', category: 'grammar' },
];

const DECKS_TO_SEED = [
  { deckKey: 'ADVERBS', label: 'Adverbs & Questions', words: VOCABULARY_ADVERBS },
];

async function seed() {
  if (!MONGODB_URI) {
    console.error('Missing MONGODB_URL_TASK_MANAGER in .env.local');
    process.exit(1);
  }

  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);

  for (const deck of DECKS_TO_SEED) {
    await col.replaceOne(
      { deckKey: deck.deckKey },
      { deckKey: deck.deckKey, label: deck.label, words: deck.words, updatedAt: new Date() },
      { upsert: true }
    );
    console.log(`✓ Upserted deck "${deck.deckKey}" (${deck.words.length} words)`);
  }

  await client.close();
  console.log('Done.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
