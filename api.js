const API_BASE = '';

export async function fetchProgress(userId) {
  const res = await fetch(`${API_BASE}/api/progress?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error('Failed to fetch progress');
  return res.json();
}

export async function postAttempt(userId, wordId, deckKey, outcome) {
  const res = await fetch(`${API_BASE}/api/attempts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, wordId, deckKey, outcome }),
  });
  if (!res.ok) throw new Error('Failed to save attempt');
  return res.json();
}

export async function fetchStats(userId) {
  const res = await fetch(`${API_BASE}/api/stats?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

export async function fetchDecks(deckKey) {
  const url = deckKey ? `${API_BASE}/api/decks?deckKey=${encodeURIComponent(deckKey)}` : `${API_BASE}/api/decks`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch decks');
  return res.json();
}

export async function postSession(userId, sessionData) {
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...sessionData }),
  });
  if (!res.ok) throw new Error('Failed to save session');
  return res.json();
}

export async function fetchSessions(userId, { limit, days } = {}) {
  const params = new URLSearchParams({ userId });
  if (limit) params.set('limit', limit);
  if (days) params.set('days', days);
  const res = await fetch(`${API_BASE}/api/sessions?${params}`);
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json();
}

export async function fetchLeaderboard(userId) {
  const res = await fetch(`${API_BASE}/api/leaderboard?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error('Failed to fetch leaderboard');
  return res.json();
}

export async function fetchDailyList(userId, count = 30) {
  const res = await fetch(`${API_BASE}/api/daily-list?userId=${encodeURIComponent(userId)}&count=${count}`);
  if (!res.ok) throw new Error('Failed to fetch daily list');
  return res.json();
}

export async function completeDailyList(userId) {
  const res = await fetch(`${API_BASE}/api/daily-list/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error('Failed to complete daily list');
  return res.json();
}
