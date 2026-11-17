// D1과 같은 모양의 시험용 DB (node:sqlite). 쓰기 횟수를 센다.
import { DatabaseSync } from 'node:sqlite';

export function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  const stats = { writes: 0 };
  const fix = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  const prep = (text, args = []) => ({
    bind: (...a) => prep(text, fix(a)),
    all: async () => ({ results: sql.prepare(text).all(...args) }),
    first: async () => sql.prepare(text).get(...args) ?? null,
    run: async () => { const r = sql.prepare(text).run(...args); if (/^\s*(INSERT|UPDATE|DELETE)/i.test(text)) stats.writes += Number(r.changes); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (t) => prep(t), batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; }, sql, stats };
}
