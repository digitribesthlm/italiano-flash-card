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
