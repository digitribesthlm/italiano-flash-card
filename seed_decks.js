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

const VOCABULARY_YOUTUBE = [
  // Food & Agriculture
  { id: 'yt1', en: 'tomato', it: 'pomodoro', category: 'content' },
  { id: 'yt2', en: 'harvest', it: 'raccolto', category: 'content' },
  { id: 'yt3', en: 'harvest season / countryside', it: 'campagna', category: 'content' },
  { id: 'yt4', en: 'soil / land', it: 'terreno', category: 'content' },
  { id: 'yt5', en: 'field', it: 'campo', category: 'content' },
  { id: 'yt6', en: 'to grow / cultivate', it: 'coltivare', category: 'content' },
  { id: 'yt7', en: 'to harvest / collect', it: 'raccogliere', category: 'content' },
  { id: 'yt8', en: 'supplier', it: 'fornitore', category: 'content' },
  { id: 'yt9', en: 'farmer', it: 'agricoltore', category: 'content' },
  { id: 'yt10', en: 'processing', it: 'lavorazione', category: 'content' },
  // Production & Process
  { id: 'yt11', en: 'selection', it: 'selezione', category: 'content' },
  { id: 'yt12', en: 'phase / stage', it: 'fase', category: 'content' },
  { id: 'yt13', en: 'check / control', it: 'controllo', category: 'content' },
  { id: 'yt14', en: 'analysis', it: 'analisi', category: 'content' },
  { id: 'yt15', en: 'smell', it: 'odore', category: 'content' },
  { id: 'yt16', en: 'taste / flavor', it: 'sapore', category: 'content' },
  // Colors
  { id: 'yt17', en: 'red', it: 'rosso', category: 'content' },
  { id: 'yt18', en: 'green', it: 'verde', category: 'content' },
  { id: 'yt19', en: 'yellow', it: 'giallo', category: 'content' },
  // Adjectives
  { id: 'yt20', en: 'fresh', it: 'fresco', category: 'content' },
  { id: 'yt21', en: 'perfect', it: 'perfetto', category: 'content' },
  { id: 'yt22', en: 'fundamental / essential', it: 'fondamentale', category: 'content' },
  { id: 'yt23', en: 'special', it: 'speciale', category: 'content' },
  { id: 'yt24', en: 'unique', it: 'unico', category: 'content' },
  { id: 'yt25', en: 'ready', it: 'pronto', category: 'content' },
  { id: 'yt26', en: 'young', it: 'giovane', category: 'content' },
  // Places & Position
  { id: 'yt27', en: 'inside', it: 'dentro', category: 'grammar' },
  { id: 'yt28', en: 'outside', it: 'fuori', category: 'grammar' },
  // Time
  { id: 'yt29', en: 'yesterday', it: 'ieri', category: 'grammar' },
  { id: 'yt30', en: 'night', it: 'notte', category: 'content' },
  { id: 'yt31', en: 'moment', it: 'momento', category: 'content' },
  { id: 'yt32', en: 'time (instance)', it: 'volta', category: 'content' },
  // Daily Life
  { id: 'yt33', en: 'lunch', it: 'pranzo', category: 'content' },
  { id: 'yt34', en: 'money', it: 'soldi', category: 'content' },
  { id: 'yt35', en: 'work / job', it: 'lavoro', category: 'content' },
  // Abstract / Concepts
  { id: 'yt36', en: 'tradition', it: 'tradizione', category: 'content' },
  { id: 'yt37', en: 'experience', it: 'esperienza', category: 'content' },
  { id: 'yt38', en: 'innovation', it: 'innovazione', category: 'content' },
  { id: 'yt39', en: 'research', it: 'ricerca', category: 'content' },
  { id: 'yt40', en: 'project', it: 'progetto', category: 'content' },
];

const DECKS_TO_SEED = [
  { deckKey: 'ADVERBS', label: 'Adverbs & Questions', words: VOCABULARY_ADVERBS },
  { deckKey: 'YOUTUBE', label: 'Mutti', words: VOCABULARY_YOUTUBE },
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
