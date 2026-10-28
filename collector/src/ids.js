// 쿠폰 id · 변경 감지 해시 (Node 전용 — engine.js를 브라우저에서도 쓰기 위해 분리)
import { createHash } from 'node:crypto';
import { menuKey } from './engine.js';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

/**
 * 같은 쿠폰이면 매일 같은 id가 나와야 한다 → upsert 기준.
 * 가격은 키에 넣지 않는다 (가격 정정 시 새 쿠폰이 아니라 기존 쿠폰의 수정으로 본다).
 */
export function couponId(c) {
  const key = [c.brand, menuKey(c.menu), c.item_type, c.audience, c.end_date || ''];
  // 통신사·결제 조건이 붙은 혜택은 조건이 다르면 다른 쿠폰 (SKT 20%와 KT 15%가 한 id로 겹치지 않게).
  // 조건이 없는 기존 쿠폰은 id가 바뀌지 않도록 비어 있으면 키에 넣지 않는다.
  if ((c.programs || []).length) key.push([...c.programs].sort().join(','));
  return 'c_' + sha1(key.join('|')).slice(0, 12);
}

const HASH_FIELDS = ['menu', 'item_type', 'regular_price', 'coupon_price', 'discount_rate', 'discount_type', 'discount_value', 'channels',
  'audience', 'app_only', 'min_order', 'start_date', 'end_date', 'conditions', 'status', 'programs', 'program_note', 'how_to_use', 'stackable', 'image_url'];

/** 화면에 보이는 내용이 바뀌었는지 판단하는 해시 (checked_at 등 시각 필드 제외) */
export function contentHash(c) {
  const o = {};
  for (const f of HASH_FIELDS) o[f] = Array.isArray(c[f]) ? [...c[f]].sort() : c[f] ?? null;
  return sha1(JSON.stringify(o)).slice(0, 16);
}

/**
 * 소식 id: 같은 출처·브랜드·기간·혜택 숫자면 같은 소식 (AI가 날마다 제목을 조금씩 다르게 써도 id가 바뀌지 않게 제목은 넣지 않음)
 */
export function newsId(n) {
  const digits = String(n.discount_label || '').replace(/[^\d+%]/g, '');
  return 'n_' + sha1([n.source_id, n.brand, n.start_date || '', n.end_date || '', digits].join('|')).slice(0, 12);
}

const NEWS_HASH_FIELDS = ['title', 'summary', 'discount_label', 'start_date', 'end_date', 'programs', 'image_url', 'related_ids', 'status'];
export function newsHash(n) {
  const o = {};
  for (const f of NEWS_HASH_FIELDS) o[f] = Array.isArray(n[f]) ? [...n[f]].sort() : n[f] ?? null;
  return sha1(JSON.stringify(o)).slice(0, 16);
}

export function runId(now = new Date()) {
  return 'r_' + now.toISOString().replace(/[-:T]/g, '').slice(0, 14) + '_' + Math.random().toString(36).slice(2, 6);
}
