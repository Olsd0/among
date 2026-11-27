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

/**
 * 출처 목록 페이지의 지문 (11/27 바로 확인 빠르게): 글자 + 사진 주소 + 링크 + 글 주소 + 출처 설정.
 * 회전 배너처럼 순서만 바뀌는 것은 같게 보도록 사진·링크·글 주소는 정렬한다. 화면 사진은 넣지 않는다.
 */
export function listKey(page, source = {}) {
  const uniq = (a) => [...new Set((a || []).filter(Boolean))].sort().join('\n');
  return createHash('sha1').update([
    PAGE_CACHE_VERSION, source.url || '', source.brand || '', source.program || '', source.selector || '', source.exclude || '',
    source.follow || '', source.follow_text || '', source.max_follow ?? '', source.detail_selector || '',
    page.text || '', uniq((page.images || []).map((i) => i && i.src)), uniq(page.links), uniq((page.posts || []).map((p) => p && p.href)),
  ].join('\u0001')).digest('hex');
}

export const LIST_OK_HOURS = 24;

export class PageCache {
  constructor(file, { maxDays = PAGE_CACHE_MAX_DAYS } = {}) {
    this.file = file || '';
    this.maxDays = maxDays;
    this.entries = {};
    this.posts = {};   // 목록 주소 → 버튼으로 연 글 [{href, text, img, seen_at}] (11/22, 7일)
    this.lists = {};   // 출처 id → { key, ok_at }: 그 목록으로 마지막에 끝까지 수집에 성공한 때 (11/27, 바로 확인이 비교)
    this.hits = 0;
    this.misses = 0;
    if (this.file && existsSync(this.file)) {
      try {
        const data = JSON.parse(readFileSync(this.file, 'utf8'));
        if (data && data.version === PAGE_CACHE_VERSION && data.entries && typeof data.entries === 'object') this.entries = data.entries;
        if (data && data.posts && typeof data.posts === 'object') this.posts = data.posts;
        if (data && data.lists && typeof data.lists === 'object') this.lists = data.lists;
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

  /** 버튼으로만 열리는 목록에서 이번에 연 글 주소를 기억한다 (기억해 둔 글은 다시 기억하지 않는다 — 실제로 연 날만 갱신) */
  rememberPosts(listUrl, posts = [], now = new Date()) {
    if (!listUrl) return;
    const map = new Map((this.posts[listUrl] || []).map((p) => [p.href, p]));
    for (const p of posts) if (p && p.href && p.text && !p.remembered) map.set(p.href, { href: p.href, text: p.text, ...(p.img ? { img: p.img } : {}), seen_at: now.toISOString() });
    this.posts[listUrl] = [...map.values()].filter((p) => now - new Date(p.seen_at) < 7 * 86400000).slice(-40);
  }

  knownPosts(listUrl, now = new Date()) {
    return (this.posts[listUrl] || []).filter((p) => now - new Date(p.seen_at) < 7 * 86400000);
  }

  /** 출처를 끝까지(목록·상세·AI) 수집했을 때의 목록 지문을 기억한다 */
  rememberList(id, key, now = new Date()) {
    if (id && key) this.lists[id] = { key, ok_at: now.toISOString() };
  }

  /** 지난 성공 수집(maxHours 안)과 목록 지문이 같으면 true — 그 출처는 이번 바로 확인에서 다시 수집하지 않는다 */
  listUnchanged(id, key, now = new Date(), maxHours = LIST_OK_HOURS) {
    const e = this.lists[id];
    const age = e ? now - new Date(e.ok_at) : NaN;
    return !!(e && key && e.key === key && age >= 0 && age < maxHours * 3600000);
  }

  /** 14일 넘게 안 쓴 주소는 지우고 저장 */
  save(now = new Date()) {
    if (!this.file) return;
    const entries = Object.fromEntries(Object.entries(this.entries).filter(([, e]) => now - new Date(e.used_at || e.read_at) < 14 * 86400000));
    mkdirSync(dirname(this.file), { recursive: true });
    const posts = Object.fromEntries(Object.entries(this.posts).map(([k, v]) => [k, v.filter((p) => now - new Date(p.seen_at) < 7 * 86400000)]).filter(([, v]) => v.length));
    const lists = Object.fromEntries(Object.entries(this.lists).filter(([, e]) => e && now - new Date(e.ok_at) < 3 * 86400000));
    writeFileSync(this.file, JSON.stringify({ version: PAGE_CACHE_VERSION, entries, posts, lists }));
  }
}
