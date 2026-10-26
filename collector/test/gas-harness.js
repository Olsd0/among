// Apps Script(Code.gs)를 Node에서 돌려보기 위한 최소 가짜 환경
// SpreadsheetApp · PropertiesService · CacheService · LockService · UrlFetchApp · ContentService · Utilities
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      out.push(Array.from({ length: this.nc }, (_, j) => (row[this.c - 1 + j] ?? '')));
    }
    return out;
  }
  setValues(vals) {
    vals.forEach((row, i) => {
      const ri = this.r - 1 + i;
      while (this.sheet.data.length <= ri) this.sheet.data.push([]);
      row.forEach((v, j) => { this.sheet.data[ri][this.c - 1 + j] = v; });
    });
    return this;
  }
  clearContent() {
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i];
      if (row) for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = '';
    }
    this.sheet.trim();
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; }
  trim() { while (this.data.length && this.data.at(-1).every((v) => v === '' || v === undefined)) this.data.pop(); }
  getLastRow() { this.trim(); return this.data.length; }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => r.length)); }
  getMaxRows() { return 1000; }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  getDataRange() {
    const nr = Math.max(1, this.getLastRow());
    const nc = Math.max(1, this.getLastColumn());
    return new FakeRange(this, 1, 1, nr, nc);
  }
  setFrozenRows() {}
  /** 테스트용: 머리글 기준 객체 배열 */
  objects() {
    const [h, ...rows] = this.data;
    return rows.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
  }
}

export function loadAppsScript(path, { now = Date.parse('2026-10-25T03:00:00Z') } = {}) {
  const clock = { now };
  const sheets = new Map();
  const props = new Map();
  const cache = new Map();
  const fetches = [];
  let fetchResponse = { code: 204, body: '' };

  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
    static now() { return clock.now; }
  }

  const pad = (n) => String(n).padStart(2, '0');
  const ctx = {
    Date: FakeDate,
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets.get(n) || null,
        insertSheet: (n) => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        setProperties: (o) => { for (const [k, v] of Object.entries(o)) props.set(k, String(v)); },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => cache.get(k) ?? null,
        put: (k, v) => { if (v.length > 100000) throw new Error('too large'); cache.set(k, v); },
        remove: (k) => cache.delete(k),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: {
      fetch: (url, opts) => {
        fetches.push({ url, opts });
        return { getResponseCode: () => fetchResponse.code, getContentText: () => fetchResponse.body };
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }),
    },
    Utilities: {
      getUuid: () => randomUUID(),
      formatDate: (d, tz, fmt) => {
        if (tz !== 'Asia/Seoul' || fmt !== 'yyyy-MM-dd') throw new Error('fake formatDate: 지원하지 않는 형식');
        const k = new RealDate(d.getTime() + 9 * 3600 * 1000);
        return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`;
      },
    },
    Logger: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path, 'utf8'), ctx, { filename: 'Code.gs' });

  const parse = (out) => JSON.parse(out.content);
  return {
    ctx, sheets, props, cache, fetches, clock,
    setFetchResponse: (code, body = '') => { fetchResponse = { code, body }; },
    get: (params) => parse(ctx.doGet({ parameter: params })),
    post: (body) => parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } })),
    sheet: (n) => sheets.get(n),
  };
}

/** 수집기(run.js)가 쓰는 SheetClient 자리에 끼우는 어댑터 */
export function sheetAdapter(gas, token) {
  return {
    async post(action, payload = {}) {
      const r = gas.post({ action, token, ...JSON.parse(JSON.stringify(payload)) });
      if (!r.ok) throw new Error(`시트 ${action} 실패: ${r.error}`);
      return r;
    },
  };
}
