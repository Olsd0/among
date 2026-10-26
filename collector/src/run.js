// AMONG 수집 실행: 출처 목록 → 렌더링 → Claude 추출 → 엔진 검증 → 시트 반영 → 실행 기록
// 사용: node src/run.js   (환경변수는 README 참고)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeAndValidate, dedupe, summarize } from './engine.js';
import { couponId, contentHash, runId as makeRunId } from './ids.js';
import { extractCoupons, DEFAULT_MODEL } from './extract.js';
import { openBrowser, collectSource } from './fetch.js';
import { SheetClient } from './sheet.js';

export function loadLocalSources(file) {
  const list = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(list) ? list : list.sources;
}

/** 최대 n개씩 동시에 실행 */
export async function pool(items, n, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(n, queue.length)) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

function isActive(s) {
  return s && s.url && !/^(false|0|n|no|off|중지)$/i.test(String(s.active ?? 'true'));
}

/**
 * @param {object} o
 * @param {object} o.env       환경변수 (기본 process.env)
 * @param {Date}   o.now       기준 시각 (테스트용)
 * @param {Array}  o.sources   출처 목록 직접 지정 (없으면 시트 → SOURCES_FILE 순)
 * @param {object} o.sheet     SheetClient 대체 (테스트용)
 * @param {object} o.browser   openBrowser() 결과 대체 (테스트용)
 */
export async function runCollector(o = {}) {
  const env = o.env || process.env;
  const now = o.now || new Date();
  const started = Date.now();
  const run_id = makeRunId(now);
  const trigger = env.TRIGGER || 'local';
  const outDir = resolve(env.OUT_DIR || 'out');
  mkdirSync(outDir, { recursive: true });

  const sheet = o.sheet || (env.APPS_SCRIPT_URL ? new SheetClient(env.APPS_SCRIPT_URL, env.COLLECTOR_TOKEN) : null);
  const log = (...a) => { if (!o.quiet) console.log(...a); };

  const report = {
    run_id, trigger, started_at: now.toISOString(), finished_at: null, duration_s: null,
    model: env.MOCK_CLAUDE === '1' ? 'mock' : (env.CLAUDE_MODEL || DEFAULT_MODEL),
    sources: [], pages: 0, input_tokens: 0, output_tokens: 0, summary: null, ingest: null, errors: [], state: 'running',
  };

  let ctx;
  try {
    if (sheet) await sheet.post('run_start', { run_id, trigger, started_at: report.started_at });

    let sources = o.sources;
    if (!sources && sheet) sources = (await sheet.post('sources')).sources;
    if (!sources) sources = loadLocalSources(env.SOURCES_FILE || 'sources.json');
    const only = env.ONLY ? env.ONLY.split(',').map((s) => s.trim()) : null;
    sources = sources.filter(isActive).filter((s) => !only || only.includes(s.id));
    log(`[${run_id}] 출처 ${sources.length}개 수집 시작 (trigger=${trigger}, model=${report.model})`);

    ctx = o.browser || (await openBrowser());
    const all = [];

    // 출처 여러 개를 동시에 (기본 4) — 출처 수가 늘어도 작업 제한 시간(25분) 안에 끝나게. 같은 사이트 안에서는 여전히 1.5초 간격
    const one = async (source) => {
      const sr = { id: source.id, brand: source.brand, ok: false, pages: 0, found: 0, published: 0, error: '' };
      report.sources.push(sr);
      try {
        const pages = await collectSource(ctx, source, { outDir: env.SAVE_SHOTS === '1' ? join(outDir, 'shots') : undefined });
        for (const page of pages) {
          if (page.error) { report.errors.push(`${source.id} 상세: ${page.error}`); continue; }
          sr.pages++; report.pages++;
          const ext = await extractCoupons(page, {
            brand: source.brand, category: source.category, now,
            mock: env.MOCK_CLAUDE === '1', apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL || DEFAULT_MODEL,
          });
          report.input_tokens += ext.usage.input_tokens;
          report.output_tokens += ext.usage.output_tokens;
          if (ext.truncated) report.errors.push(`${source.id}: 응답이 max_tokens에서 잘림 (${page.finalUrl})`);
          for (const raw of ext.coupons) {
            const c = normalizeAndValidate(raw, {
              now, brand: source.brand, category: source.category, sourceId: source.id,
              sourceUrl: page.finalUrl || page.url, officialLink: source.official_link || source.url, pageText: page.text,
            });
            c.id = couponId(c);
            c.checked_at = now.toISOString();
            all.push(c);
            sr.found++;
          }
        }
        sr.ok = true;
      } catch (e) {
        sr.error = e.message;
        report.errors.push(`${source.id}: ${e.message}`);
        log(`  ✗ ${source.id}: ${e.message}`);
      }
      if (sr.ok) log(`  ✓ ${source.id}: 페이지 ${sr.pages}, 후보 ${sr.found}`);
    };
    await pool(sources, +(env.COLLECT_CONCURRENCY || 4), one);

    const merged = dedupe(all, couponId).map((c) => ({ ...c, hash: contentHash(c) }));
    for (const sr of report.sources) sr.published = merged.filter((c) => c.source_id === sr.id && c.status === 'published').length;
    report.summary = summarize(merged);

    // 시트에는 published·pending만 저장 (rejected는 개수·사유만 실행 기록에 남김)
    const keep = merged.filter((c) => c.status !== 'rejected');
    writeFileSync(join(outDir, 'coupons.json'), JSON.stringify(merged, null, 2));

    if (sheet) {
      report.ingest = (await sheet.post('ingest', {
        run_id, checked_at: now.toISOString(), coupons: keep,
        sources_ok: report.sources.filter((s) => s.ok).map((s) => s.id),
      })).result;
    }
    const okCount = report.sources.filter((s) => s.ok).length;
    report.state = sources.length && okCount === 0 ? 'failed' : okCount < sources.length ? 'partial' : 'success';
  } catch (e) {
    report.state = 'failed';
    report.errors.push(e.message);
    log(`✗ 실행 실패: ${e.stack || e.message}`);
  } finally {
    if (ctx && !o.browser) await ctx.close().catch(() => {});
    report.finished_at = new Date().toISOString();
    report.duration_s = Math.round((Date.now() - started) / 1000);
    writeFileSync(join(outDir, 'run_log.json'), JSON.stringify(report, null, 2));
    if (sheet) {
      try { await sheet.post('run_finish', { report }); }
      catch (e) { log(`✗ 실행 기록 저장 실패: ${e.message}`); }
    }
    const s = report.summary;
    log(`[${run_id}] ${report.state} · ${report.duration_s}s · 게시 ${s?.published ?? 0} / 보류 ${s?.pending ?? 0} / 버림 ${s?.rejected ?? 0} · 토큰 in ${report.input_tokens} out ${report.output_tokens}`);
    if (report.ingest) log(`  시트: 신규 ${report.ingest.inserted} · 변경 ${report.ingest.updated} · 유지 ${report.ingest.unchanged} · 사라짐 ${report.ingest.gone} · 만료 ${report.ingest.expired}`);
    // GitHub Actions 주석: 로그를 열지 않고 API·요약 화면에서 결과 확인
    if (process.env.GITHUB_ACTIONS && !o.quiet) {
      const one = (t) => String(t).replace(/\r?\n/g, ' ').slice(0, 900);
      console.log(`::notice title=수집 결과::${one(`${report.state} · 게시 ${s?.published ?? 0} / 보류 ${s?.pending ?? 0} / 버림 ${s?.rejected ?? 0} · 토큰 in ${report.input_tokens} out ${report.output_tokens}`)}`);
      for (const x of report.sources || []) {
        console.log(`::${x.ok ? 'notice' : 'warning'} title=출처 ${x.id}::${one(x.ok ? `페이지 ${x.pages ?? ''} · 쿠폰 ${x.found ?? ''}` : x.error)}`);
      }
    }
  }
  return report;
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (!process.env.SOURCES_FILE && !process.env.APPS_SCRIPT_URL && existsSync('sources.example.json') && !existsSync('sources.json')) {
    process.env.SOURCES_FILE = 'sources.example.json';
  }
  const report = await runCollector();
  process.exitCode = report.state === 'failed' ? 1 : 0;
}
