// AMONG 수집 실행: 출처 목록 → 렌더링 → Claude 추출 → 엔진 검증 → 시트 반영 → 실행 기록
// 사용: node src/run.js   (환경변수는 README 참고)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeAndValidate, dedupe, mergeSimilar, groupFreeItems, summarize, normPrograms, todayKST, stabilizeIds, normalizeNews, linkNews, mergeNews, pickImage } from './engine.js';
import { couponId, contentHash, newsId, newsHash, runId as makeRunId } from './ids.js';
import { extractCoupons, pickProvider } from './extract.js';
import { openBrowser, collectSource } from './fetch.js';
import { SheetClient } from './sheet.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // DRY_RUN=1: 출처는 시트(없으면 파일)에서 읽되 결과는 시트에 쓰지 않는다 (AI 추출 시험용)
  const sheetRead = env.APPS_SCRIPT_URL ? new SheetClient(env.APPS_SCRIPT_URL, env.COLLECTOR_TOKEN) : null;
  const sheet = o.sheet || (env.DRY_RUN === '1' ? null : sheetRead);
  const log = (...a) => { if (!o.quiet) console.log(...a); };

  const llm = pickProvider(env);
  const report = {
    run_id, trigger, started_at: now.toISOString(), finished_at: null, duration_s: null,
    model: llm.provider === 'mock' ? 'mock' : `${llm.provider}:${llm.model}`,
    sources: [], pages: 0, input_tokens: 0, output_tokens: 0, summary: null, ingest: null, errors: [], state: 'running',
  };

  // 예약 실행 중복 방지: 00시 Apps Script 트리거가 이미 오늘 수집을 끝냈으면 GitHub 예약 실행(지연되어 새벽에 도착)은 건너뛴다
  const statusReader = o.sheetRead || sheetRead;
  if (trigger === 'schedule' && statusReader && env.SKIP_IF_DONE !== '0') {
    const done = await collectedToday(statusReader, now).catch(() => '');
    if (done) {
      report.state = 'skipped';
      report.finished_at = new Date().toISOString();
      report.errors.push(`오늘(${todayKST(now)}) 이미 수집함: ${done}`);
      writeFileSync(join(outDir, 'run_log.json'), JSON.stringify(report, null, 2));
      log(`[${run_id}] 오늘 이미 수집을 마쳐 건너뜀 (${done})`);
      if (process.env.GITHUB_ACTIONS && !o.quiet) console.log(`::notice title=수집 건너뜀::${report.errors[0]}`);
      return report;
    }
  }

  let ctx;
  try {
    if (sheet) await sheet.post('run_start', { run_id, trigger, started_at: report.started_at });

    let sources = o.sources;
    if (!sources && env.LOCAL_SOURCES === '1') sources = loadLocalSources(env.SOURCES_FILE);  // 전체 경로 점검용
    if (!sources && (sheet || sheetRead)) sources = (await (sheet || sheetRead).post('sources')).sources;
    if (!sources) sources = loadLocalSources(env.SOURCES_FILE || 'sources.json');
    // 시험 실행(dry)에서 아직 시트에 없는 출처 id를 지정하면 sources.example.json에서 가져온다 (시트에 넣기 전에 추출 품질 확인)
    if (env.DRY_RUN === '1' && env.ONLY) sources = withExampleSources(sources, env.ONLY.split(',').map((x) => x.trim()));
    const only = env.ONLY ? env.ONLY.split(',').map((s) => s.trim()) : null;
    sources = sources.filter(isActive).filter((s) => !only || only.includes(s.id));
    log(`[${run_id}] 출처 ${sources.length}개 수집 시작 (trigger=${trigger}, model=${report.model})`);

    ctx = o.browser || (await openBrowser());
    const all = [];
    const allNews = [];

    // 출처 여러 개를 동시에 (기본 4) — 출처 수가 늘어도 작업 제한 시간(25분) 안에 끝나게. 같은 사이트 안에서는 여전히 1.5초 간격
    // 실행 시간 예산(기본 35분): 작업 제한 25분 전에 스스로 마무리해 결과·기록을 남긴다.
    // 예산을 넘기거나 AI 한도가 끝나면 남은 출처는 '실패'로 두어 시트의 기존 쿠폰을 건드리지 않는다.
    const deadline = started + (+(env.RUN_BUDGET_S || 2100)) * 1000;
    let stopReason = '';
    const one = async (source) => {
      const sr = { id: source.id, brand: source.brand, ok: false, pages: 0, found: 0, published: 0, error: '' };
      report.sources.push(sr);
      try {
        if (stopReason) throw new Error(`건너뜀: ${stopReason}`);
        const pages = await collectSource(ctx, source, { outDir: env.SAVE_SHOTS === '1' ? join(outDir, 'shots') : undefined });
        for (const page of pages) {
          if (page.error) { report.errors.push(`${source.id} 상세: ${page.error}`); continue; }
          if (stopReason) throw new Error(`중단: ${stopReason}`);
          if (Date.now() > deadline) { stopReason = '실행 시간 예산 초과'; throw new Error(stopReason); }
          sr.pages++; report.pages++;
          const program = normPrograms(source.program)[0] || '';
          const ext = await extractCoupons(page, {
            brand: source.brand, category: source.category, program, now,
            provider: llm.provider, apiKey: llm.apiKey, model: llm.model,
          });
          report.input_tokens += ext.usage.input_tokens;
          report.output_tokens += ext.usage.output_tokens;
          if (ext.truncated) report.errors.push(`${source.id}: 응답이 max_tokens에서 잘림 (${page.finalUrl})`);
          const nctx = {
            now, brand: source.brand, category: source.category, sourceId: source.id, programs: normPrograms(source.program),
            sourceUrl: page.finalUrl || page.url, officialLink: source.official_link || source.url, pageText: page.text,
          };
          for (const raw of ext.coupons) {
            const c = normalizeAndValidate(raw, nctx);
            c.id = couponId(c);
            c.checked_at = now.toISOString();
            // 사진은 이 쿠폰을 읽은 바로 그 공식 페이지의 이미지일 때만 (브랜드 자체 출처만 — 멤버십·결제 페이지의 그림은 대개 로고)
            c.image_url = source.brand && c.status !== 'rejected' ? pickImage(c, page, source.brand) : '';
            all.push(c);
            sr.found++;
          }
          for (const raw of ext.news || []) {
            const n = normalizeNews(raw, nctx);
            n.image_url = source.brand && n.status !== 'rejected' ? pickImage({ evidence: n.evidence }, page, source.brand) : '';
            n.id = newsId(n);
            n.checked_at = now.toISOString();
            allNews.push(n);
            sr.news = (sr.news || 0) + 1;
          }
        }
        sr.ok = true;
      } catch (e) {
        if (e.code === 'AI_QUOTA') stopReason = 'AI 하루 한도 소진';
        // robots.txt가 (AI) 수집을 거부하면 이 출처의 쿠폰은 더 확인할 수 없으므로 내린다 (성공한 출처로 보고 → 시트에서 사라짐 처리)
        if (e.code === 'ROBOTS' && !sr.pages && /거부|차단/.test(e.message)) {
          sr.ok = true;
          sr.robots_blocked = true;
          report.errors.push(`${source.id}: ${e.message} → 이 출처 쿠폰·소식을 내림 (sources 탭에서 active=FALSE 권장)`);
          log(`  ⊘ ${source.id}: ${e.message}`);
          return;
        }
        sr.error = e.message;
        report.errors.push(`${source.id}: ${e.message}`);
        log(`  ✗ ${source.id}: ${e.message}`);
      }
      if (sr.ok) log(`  ✓ ${source.id}: 페이지 ${sr.pages}, 후보 ${sr.found}`);
    };
    // 출처 하나가 멈춰도(브라우저·네트워크) 전체가 25분 제한에 걸리지 않게: 출처별 제한 + 전체 예산 뒤 강제 마무리
    const srcLimit = +(env.SOURCE_TIMEOUT_S || 480) * 1000;
    const guarded = (source) => {
      let timer;
      return Promise.race([
        one(source),
        new Promise((res) => { timer = setTimeout(() => {
          const sr = report.sources.find((x) => x.id === source.id);
          if (sr && !sr.ok) sr.error = sr.error || `출처 처리 시간 초과 (${srcLimit / 1000}s)`;
          report.errors.push(`${source.id}: 출처 처리 시간 초과`);
          res();
        }, srcLimit); }),
      ]).finally(() => clearTimeout(timer));
    };
    const all_done = pool(sources, +(env.COLLECT_CONCURRENCY || (llm.provider === 'gemini' ? 2 : 4)), guarded);  // Gemini 무료 한도는 분당 요청 수가 작아 2개씩
    const hard = Math.max(30000, deadline - Date.now() + 120000);
    let hardTimer;
    const finishedInTime = await Promise.race([all_done.then(() => true), new Promise((r) => { hardTimer = setTimeout(() => r(false), hard); })]);
    clearTimeout(hardTimer);
    if (!finishedInTime) {
      stopReason = stopReason || '실행 시간 예산 초과';
      report.errors.push('전체 실행 시간 초과로 남은 출처를 실패 처리');
      for (const x of report.sources) if (!x.ok && !x.error) x.error = '시간 초과';
      for (const src of sources) if (!report.sources.find((x) => x.id === src.id)) report.sources.push({ id: src.id, brand: src.brand, ok: false, pages: 0, found: 0, published: 0, error: '시간 초과로 시작 못 함' });
    }
    // 시간 초과로 끝난 출처가 나중에 ok가 되지 않도록 지금 상태를 고정
    for (const x of report.sources) x.ok = x.ok && !/시간 초과/.test(x.error || '');

    let merged = groupFreeItems(mergeSimilar(dedupe(all, couponId))).map((c) => ({ ...c, id: couponId(c), hash: contentHash(c) }));
    // 같은 행사인데 AI 표기 차이로 id가 바뀌는 것을 막는다 (지금 게시 중인 쿠폰의 id를 이어 씀)
    if (statusReader && env.STABILIZE_IDS !== '0') {
      try {
        const st = stabilizeIds(merged, (await statusReader.get('coupons')).coupons);
        merged = st.list;
        report.ids_reused = st.reused;
      } catch (e) { report.errors.push(`id 안정화 건너뜀: ${e.message}`); }
    }
    for (const sr of report.sources) sr.published = merged.filter((c) => c.source_id === sr.id && c.status === 'published').length;
    report.summary = summarize(merged);

    // 소식: 같은 id는 하나로(게시 > 보류 > 버림, 신뢰도 높은 쪽), 같은 페이지의 게시 쿠폰과 연결
    const rank = (n) => (n.status === 'published' ? 2 : n.status === 'pending' ? 1 : 0) + (n.confidence || 0) / 10;
    const newsById = new Map();
    for (const n of allNews) { const cur = newsById.get(n.id); if (!cur || rank(n) > rank(cur)) newsById.set(n.id, n); }
    const news = mergeNews(linkNews([...newsById.values()], merged)).map((n) => ({ ...n, hash: newsHash(n) }));
    report.news = { published: news.filter((n) => n.status === 'published').length, pending: news.filter((n) => n.status === 'pending').length, rejected: news.filter((n) => n.status === 'rejected').length };
    report.with_image = merged.filter((c) => c.status === 'published' && c.image_url).length;

    // 시트에는 published·pending만 저장 (rejected는 개수·사유만 실행 기록에 남김)
    const keep = merged.filter((c) => c.status !== 'rejected');
    writeFileSync(join(outDir, 'coupons.json'), JSON.stringify(merged, null, 2));
    writeFileSync(join(outDir, 'news.json'), JSON.stringify(news, null, 2));

    if (sheet) {
      report.ingest = (await sheet.post('ingest', {
        run_id, checked_at: now.toISOString(), coupons: keep,
        news: news.filter((n) => n.status !== 'rejected'),
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
    if (ctx && !o.browser) { let t; await Promise.race([ctx.close().catch(() => {}), new Promise((r) => { t = setTimeout(r, 15000); })]); clearTimeout(t); }
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
      console.log(`::notice title=수집 결과::${one(`${report.state} · 게시 ${s?.published ?? 0} / 보류 ${s?.pending ?? 0} / 버림 ${s?.rejected ?? 0} · 사진 ${report.with_image ?? 0} · 소식 게시 ${report.news?.published ?? 0} / 보류 ${report.news?.pending ?? 0} / 버림 ${report.news?.rejected ?? 0} · id 이어 씀 ${report.ids_reused ?? 0} · 토큰 in ${report.input_tokens} out ${report.output_tokens}`)}`);
      // 주석은 단계당 10개까지만 보이므로 여러 줄을 묶어서 남긴다 (%0A = 줄바꿈)
      const block = (t) => String(t).replace(/\r?\n/g, ' ').replace(/%/g, '%25');
      const groups = (lines, n) => Array.from({ length: Math.ceil(lines.length / n) }, (_, i) => lines.slice(i * n, i * n + n));
      const srcLines = (report.sources || []).map((x) => `${x.robots_blocked ? '⊘' : x.ok ? '✓' : '✗'}|${x.id}|페이지${x.pages}|후보${x.found}|게시${x.published}|소식${x.news || 0}${x.robots_blocked ? '|robots 거부 → 내림' : x.ok ? '' : `|${x.error}`}`.slice(0, 300));
      groups(srcLines, 12).slice(0, 2).forEach((g, i) => console.log(`::notice title=출처 ${i + 1}::${g.map(block).join('%0A')}`));
      if (report.errors.length) console.log(`::warning title=오류 ${report.errors.length}건::${report.errors.slice(0, 15).map((e) => block(e).slice(0, 200)).join('%0A')}`);
      let cs = [];
      try { cs = JSON.parse(readFileSync(join(outDir, 'coupons.json'), 'utf8')); } catch { /* 없음 */ }
      const cLines = cs.map((c) => [c.status, c.source_id, c.brand, c.menu, c.regular_price ?? '', c.coupon_price ?? '', c.discount_rate ?? '', c.discount_type, c.discount_value ?? '', c.audience, (c.programs || []).join('+'), c.start_date || '', c.end_date || '', (c.issues || []).join('/'), String(c.evidence || '').slice(0, 50)].join('|').slice(0, 300));
      groups(cLines, 25).slice(0, 4).forEach((g, i) => console.log(`::notice title=쿠폰 ${i + 1}::${g.map(block).join('%0A')}`));
      let ns = [];
      try { ns = JSON.parse(readFileSync(join(outDir, 'news.json'), 'utf8')); } catch { /* 없음 */ }
      const nLines = ns.map((n) => [n.status, n.source_id, n.brand, n.title, n.discount_label, n.start_date || '', n.end_date || '', n.related_ids.length, n.image_url ? '사진' : '', (n.issues || []).join('/')].join('|').slice(0, 300));
      if (nLines.length) groups(nLines, 25).slice(0, 1).forEach((g, i) => console.log(`::notice title=소식 ${i + 1}::${g.map(block).join('%0A')}`));
      const imgLines = cs.filter((c) => c.image_url).map((c) => `${c.brand}|${c.menu}|${c.image_url}`.slice(0, 300));
      if (imgLines.length) console.log(`::notice title=사진 ${imgLines.length}건::${imgLines.slice(0, 25).map(block).join('%0A')}`);
    }
  }
  return report;
}

/** only에 있지만 목록에 없는 출처를 예시 파일에서 보충 (활성 여부와 관계없이 — 시험용) */
export function withExampleSources(sources, only, file = 'sources.example.json') {
  const have = new Set(sources.map((s) => s.id));
  const missing = only.filter((id) => id && !have.has(id));
  if (!missing.length || !existsSync(file)) return sources;
  const extra = loadLocalSources(file).filter((s) => missing.includes(s.id)).map((s) => ({ ...s, active: 'TRUE' }));
  return [...sources, ...extra];
}

/** 오늘(KST) 이미 성공한 수집이 있으면 그 시각을, 없으면 '' */
// 실행 상태(queued·running)는 보지 않는다: 00시 트리거가 이 실행을 부르면서 'queued'로 바꿔 두기 때문 (같은 워크플로는 concurrency로 한 번에 하나만 돈다)
export async function collectedToday(sheetClient, now = new Date()) {
  const st = await sheetClient.get('status');
  const last = st && st.last_checked_at;
  if (!last) return '';
  return todayKST(new Date(last)) === todayKST(now) ? last : '';
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (!process.env.SOURCES_FILE && !process.env.APPS_SCRIPT_URL && existsSync('sources.example.json') && !existsSync('sources.json')) {
    process.env.SOURCES_FILE = 'sources.example.json';
  }
  const report = await runCollector();
  // 멈춘 브라우저·요청이 남아 있어도 프로세스를 끝낸다
  process.exit(report.state === 'failed' ? 1 : 0);
}
