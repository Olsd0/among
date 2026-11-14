import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadAppsScript } from './gas-harness.js';
import { encodeArtworkUrl, decodeArtworkUrl } from '../src/artwork-meta.js';

test('article provenance survives the existing Sheets ingest and public API without a backend migration', () => {
  const gas = loadAppsScript(fileURLToPath(new URL('../../apps-script/Code.gs', import.meta.url)), { now: Date.parse('2026-11-14T06:00:00Z') });
  gas.ctx.setup(); gas.props.set('COLLECTOR_TOKEN', 'test-token');
  const meta = { kind: 'press_related', source: 'https://press.example/article/1', checkedAt: '2026-11-14T06:00:00.000Z', credit: '브랜드 제공' };
  const image = encodeArtworkUrl('https://press.example/photo.jpg', meta);
  const event = { id: 'n_artwork', brand: '테스트브랜드', title: '기간 한정 행사', summary: '확인한 혜택', discount_label: '30%', start_date: '2026-11-12', end_date: '2026-11-18', status: 'published', source_id: 'test-event', source_url: 'https://brand.example/event/1', image_url: image, programs: [], related_ids: [], hash: 'test-image-hash', evidence: '공식 행사', issues: [], confidence: 0.99 };
  const result = gas.post({ action: 'ingest', token: 'test-token', run_id: 'r_artwork', coupons: [], news: [event], sources_ok: ['test-event'] });
  assert.equal(result.ok, true);
  const publicNews = gas.get({ action: 'coupons' }).news;
  assert.equal(publicNews[0].image_url, image);
  assert.deepEqual(decodeArtworkUrl(publicNews[0].image_url), { url: 'https://press.example/photo.jpg', meta });
  assert.equal(publicNews[0].source_url, event.source_url, 'the official event destination is never replaced by the photo source');
});
