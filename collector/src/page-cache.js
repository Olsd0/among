// 수집 최적화 (11/16 대표 요청): 어제와 글자·이미지가 그대로인 페이지는 AI에게 다시 읽히지 않고 지난번 추출 결과를 쓴다.
// - 저장하는 것: 페이지 주소별 지문(해시)과 추출 결과(공개 행사 내용)뿐. 화면 사진·키·개인정보 없음.
// - 최대 3일만 다시 쓴다 → 글자는 같고 그림 속 내용만 바뀐 경우, 날짜에 따라 해석이 달라지는 경우도 3일 안에 다시 읽는다.
// - 잘린 응답·실패는 저장하지 않는다.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const PAGE_CACHE_VERSION = 1;
export const PAGE_CACHE_MAX_DAYS = 3;

export function pageKey(page, ctx = {}) {
  const images = (page.images || []).map((i) => i.src).join('\n');
  return createHash('sha1').update([PAGE_CACHE_VERSION, ctx.model || '', ctx.brand || '', ctx.program || '', page.text || '', images].join('\u0001')).digest('hex');
}

export class PageCache {
  constructor(file, { maxDays = PAGE_CACHE_MAX_DAYS } = {}) {
    this.file = file || '';
    this.maxDays = maxDays;
    this.entries = {};
    this.hits = 0;
    this.misses = 0;
    if (this.file && existsSync(this.file)) {
      try {
        const data = JSON.parse(readFileSync(this.file, 'utf8'));
        if (data && data.version === PAGE_CACHE_VERSION && data.entries && typeof data.entries === 'object') this.entries = data.entries;
      } catch { this.entries = {}; }
    }
  }

  /** 같은 지문으로 최근(maxDays 안)에 읽은 결과가 있으면 돌려준다. 처음 읽은 날은 그대로 두어 3일 뒤에는 반드시 다시 읽는다 */
  get(url, key, now = new Date()) {
    const e = this.entries[url];
    const ok = e && e.key === key && e.ext && (now - new Date(e.read_at)) >= 0 && (now - new Date(e.read_at)) < this.maxDays * 86400000;
    if (!ok) { this.misses++; return null; }
    this.hits++;
    e.used_at = now.toISOString();
    return { ...structuredClone(e.ext), usage: { input_tokens: 0, output_tokens: 0 }, truncated: false, cached: true };
  }

  set(url, key, ext, now = new Date()) {
    if (!ext || ext.truncated || ext.cached) return;
    this.entries[url] = {
      key, read_at: now.toISOString(), used_at: now.toISOString(),
      ext: { coupons: ext.coupons || [], news: ext.news || [], page_kind: ext.page_kind || 'other', notes: ext.notes || '', model: ext.model || '' },
    };
  }

  /** 14일 넘게 안 쓴 주소는 지우고 저장 */
  save(now = new Date()) {
    if (!this.file) return;
    const entries = Object.fromEntries(Object.entries(this.entries).filter(([, e]) => now - new Date(e.used_at || e.read_at) < 14 * 86400000));
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ version: PAGE_CACHE_VERSION, entries }));
  }
}
