// Fuzzy-matches a client named in a message against ClientProfile, so "sharma ji" or "Acme" finds
// "Sharma Traders" or "Acme Studio Pvt Ltd" and fills in the email the message didn't have.

import { db } from '../db';

export type ClientMatch = {
  id: string;
  email: string;
  name: string;
  company: string | null;
  paymentStyle: string;
  avgDaysLate: number;
  score: number;
};

const NOISE = /\b(ji|bhai|sir|madam|mr|mrs|ms|dr|the|pvt|private|ltd|limited|llc|inc|co|company|corp)\b/g;
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

// Dice coefficient on character bigrams: tolerant of typos and word order.
function dice(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function similarity(query: string, candidate: string) {
  const q = normalise(query);
  const c = normalise(candidate);
  if (!q || !c) return 0;
  // "Acme" inside "Acme Studio" is a strong signal on its own.
  const contained = (c.split(' ').includes(q) || q.split(' ').includes(c)) && Math.min(q.length, c.length) >= 3 ? 0.85 : 0;
  return Math.max(dice(q, c), contained);
}

const THRESHOLD = 0.72;

export async function matchClient(q: { name?: string | null; email?: string | null; company?: string | null }): Promise<ClientMatch | null> {
  const email = q.email?.trim().toLowerCase();
  if (email) {
    const exact = await db.clientProfile.findUnique({ where: { email } });
    if (exact) return { ...exact, score: 1 };
  }
  const names = [q.name, q.company].filter((s): s is string => !!s?.trim());
  if (names.length === 0) return null;

  const profiles = await db.clientProfile.findMany({ take: 2000 });
  let best: ClientMatch | null = null;
  for (const p of profiles) {
    const score = Math.max(...names.flatMap((n) => [similarity(n, p.name), p.company ? similarity(n, p.company) : 0]));
    if (score >= THRESHOLD && (!best || score > best.score)) best = { ...p, score: Math.round(score * 100) / 100 };
  }
  return best;
}
