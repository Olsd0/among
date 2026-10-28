// AMONG 지표 화면 스크립트 (admin.html에서 분리 — CSP로 인라인 스크립트를 막기 위해)
(function () {
  const API = (window.AMONG_CONFIG || {}).apiUrl || '';
  const DEMO = new URLSearchParams(location.search).has('demo') || !API;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x) => (x === null || x === undefined || x === '' ? '—' : `${Math.round(Number(x) * 1000) / 10}%`);
  const num = (x) => (x === null || x === undefined || x === '' ? '—' : Number(x).toLocaleString('ko-KR'));
  const kst = (iso) => {
    if (!iso) return '—';
    const d = new Date(new Date(iso).getTime() + 9 * 3600e3);
    if (isNaN(d)) return '—';
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  const ss = { get(k) { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* 무시 */ } } };
  let data = null;

  function demo() {
    const days = [];
    const t = Date.now();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(t - i * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
      const v = i > 20 ? 0 : Math.round(4 + (20 - i) * 1.6 + (i % 3) * 2);
      days.push({ date: d, visitors: v, clicks: Math.round(v * 0.45), details: Math.round(v * 0.8), refresh: i % 4 === 0 ? 1 : 0 });
    }
    const runs = Array.from({ length: 7 }, (_, i) => ({
      run_id: 'r_demo' + i, trigger: i === 2 ? 'button' : 'schedule', state: i === 4 ? 'partial' : 'success',
      started_at: new Date(t - i * 864e5).toISOString(), duration_s: 140 + i * 7, published: 18 - (i % 3), pending: 2 + (i % 2), rejected: 3,
      inserted: i === 0 ? 2 : 0, updated: 1, gone: i % 3 === 0 ? 1 : 0, auto_publish_rate: 0.86 + (i % 3) * 0.02, input_tokens: 42000, output_tokens: 3100,
      errors: i === 4 ? 'brand-d: HTTP 503' : '',
    }));
    return {
      ok: true, period: { from: days[0].date, to: days.at(-1).date, days: 30 },
      collection: {
        last_success_at: new Date(t - 3600e3).toISOString(), auto_publish_rate_7runs: 0.88, tokens_7runs: 315000,
        coupons_by_status: { published: 18, pending: 2, gone: 5, expired: 9 },
        published_by_brand: { A버거: 6, B버거: 5, C버거: 4, D버거: 3 }, pending_reasons: { '종료일 미상': 1, '신뢰도 낮음': 1 },
        runs, sources: [
          { id: 'brand-a', brand: 'A버거', active: 'TRUE', last_ok_at: new Date(t - 3600e3).toISOString(), last_error: '' },
          { id: 'brand-d', brand: 'D버거', active: 'TRUE', last_ok_at: new Date(t - 5 * 864e5).toISOString(), last_error: 'HTTP 503' },
        ],
      },
      usage: { visitors: 41, sessions: 96, click_session_rate: 0.43, multi_brand_rate: 0.61, engaged_sessions: 58, retention_7d: 0.32, retention_7d_base: 25, daily: days },
      reports: { total: 3, open: 1, recent: [{ ts: new Date(t - 7200e3).toISOString(), brand: 'B버거', menu: '치즈버거 세트', reason: '가격이 달라요', memo: '앱에서는 6,100원', status: '새 제보' }] },
      security: { refresh_today: 2, refresh_daily_max: 6, last_refresh_error: '', retention_days: { events: 180, reports: 365 }, last_purge_at: new Date(t - 12 * 3600e3).toISOString() },
    };
  }

  async function load() {
    $('#errNote').hidden = true;
    if (DEMO) { data = demo(); render(); return; }
    const token = $('#token').value.trim();
    if (!token) { $('#errNote').hidden = false; $('#errNote').textContent = '관리 토큰(ADMIN_TOKEN)을 입력하세요.'; return; }
    ss.set('among_admin', token);
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'metrics', token, days: +$('#days').value }) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error === 'unauthorized' ? '토큰이 맞지 않아요.' : j.error);
      data = j; render();
    } catch (e) {
      $('#errNote').hidden = false; $('#errNote').textContent = '불러오지 못했어요: ' + e.message;
    }
  }

  function tile(k, v, s, sm) { return `<div class="tile"><div class="k">${esc(k)}</div><div class="v${sm ? ' sm' : ''}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`; }

  function barChart(el, rows, key, label) {
    const W = 600, H = 160, pad = { l: 28, r: 4, t: 8, b: 20 };
    const max = Math.max(1, ...rows.map((r) => r[key] || 0));
    const nice = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const bw = iw / rows.length;
    const ticks = [0, nice / 2, nice];
    let g = '';
    ticks.forEach((tv) => { const y = pad.t + ih - (tv / nice) * ih; g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="var(--grid)" stroke-width="1"/><text x="${pad.l - 6}" y="${y + 3}" text-anchor="end">${tv}</text>`; });
    let bars = '';
    rows.forEach((r, i) => {
      const v = r[key] || 0; const h = (v / nice) * ih; const x = pad.l + i * bw + 1; const w = Math.max(1, bw - 2);
      const y = pad.t + ih - h; const rr = Math.min(4, w / 2, h);
      const path = h > 0 ? `M${x},${pad.t + ih} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${pad.t + ih} Z` : '';
      bars += `<g data-i="${i}">${path ? `<path d="${path}" fill="var(--series)"/>` : ''}<rect x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${ih}" fill="transparent"/></g>`;
    });
    const step = Math.ceil(rows.length / 6);
    let xl = '';
    rows.forEach((r, i) => { if (i % step === 0 || i === rows.length - 1) xl += `<text x="${pad.l + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${+r.date.slice(5, 7)}/${+r.date.slice(8)}</text>`; });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><g class="axis">${g}${xl}</g>${bars}</svg><div class="tip"></div>`;
    const svg = el.querySelector('svg'); const tip = el.querySelector('.tip');
    svg.addEventListener('mousemove', (e) => {
      const gEl = e.target.closest('g[data-i]'); if (!gEl) { tip.classList.remove('on'); return; }
      const r = rows[+gEl.dataset.i]; const box = el.getBoundingClientRect();
      tip.textContent = `${+r.date.slice(5, 7)}/${+r.date.slice(8)} · ${label} ${num(r[key])}`;
      tip.style.left = `${e.clientX - box.left}px`; tip.style.top = `${e.clientY - box.top}px`; tip.classList.add('on');
    });
    svg.addEventListener('mouseleave', () => tip.classList.remove('on'));
  }

  function hbars(el, obj) {
    const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { el.innerHTML = '<p class="muted">없음</p>'; return; }
    const max = Math.max(...entries.map((e) => e[1]));
    el.innerHTML = entries.map(([k, v]) => `<div><span>${esc(k)}</span><i style="width:${(v / max) * 100}%"></i><span class="muted" style="text-align:right">${num(v)}</span></div>`).join('');
  }

  const STATE = { success: ['good', '성공'], partial: ['warn', '일부 실패'], failed: ['bad', '실패'], running: ['warn', '실행 중'] };
  const TRIG = { schedule: '00시 예약', button: '갱신 버튼', manual: '수동', local: '로컬' };

  function render() {
    $('#demoNote').hidden = !DEMO;
    const c = data.collection, u = data.usage;
    const live = (c.coupons_by_status || {}).published || 0;
    $('#tiles').innerHTML = [
      tile('자동 게시율', pct(c.auto_publish_rate_7runs), '최근 7회 평균 · 게시/(게시+보류)'),
      tile('게시 중 쿠폰', num(live), `보류 ${num((c.coupons_by_status || {}).pending || 0)}`),
      tile('마지막 성공 수집', kst(c.last_success_at), `최근 7회 토큰 ${num(c.tokens_7runs)}`, true),
      tile('방문자', num(u.visitors), `세션 ${num(u.sessions)} · ${data.period.from} ~ ${data.period.to}`),
      tile('공식 앱 이동률', pct(u.click_session_rate), '이동이 있었던 세션 비율'),
      tile('2개+ 브랜드 비교율', pct(u.multi_brand_rate), `상세·이동 세션 ${num(u.engaged_sessions)}개 중`),
      tile('7일 재방문율', pct(u.retention_7d), `첫 방문 7일 지난 ${num(u.retention_7d_base)}명 기준`),
      tile('제보', num(data.reports.total), `미처리 ${num(data.reports.open)}`),
      tile('통신사·페이 혜택', num(Object.values(c.published_by_program || {}).reduce((a, b) => a + b, 0)), Object.entries(c.published_by_program || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '아직 없음'),
      tile('영양정보 메뉴', num(c.nutrition_items || 0), c.nutrition_updated_at ? `갱신 ${kst(c.nutrition_updated_at)}` : '공공데이터 키 등록 후 주 1회 자동'),
      tile('오늘의 소식', num(c.news_published || 0), '공식 이벤트·공지에서 수집 때 함께 갱신'),
      tile('사진 있는 쿠폰', num(c.coupons_with_image || 0), `게시 중 ${num(live)}개 중 · 공식 행사 페이지 이미지`),
      (() => {
        const sec = data.security || {};
        const purge = sec.last_purge_at ? `기록 정리 ${kst(sec.last_purge_at)}` : '기록 정리 전';
        const err = sec.last_refresh_error ? ` · 갱신 오류: ${esc(sec.last_refresh_error.slice(0, 60))}` : '';
        return tile('바로 갱신 (오늘)', `${num(sec.refresh_today || 0)} / ${num(sec.refresh_daily_max || 6)}`, `${purge} · 보관 이용기록 ${num((sec.retention_days || {}).events || 180)}일·제보 ${num((sec.retention_days || {}).reports || 365)}일${err}`);
      })(),
    ].join('');
    barChart($('#chVisitors'), u.daily, 'visitors', '방문자');
    barChart($('#chClicks'), u.daily, 'clicks', '이동');

    $('#runs').innerHTML = '<thead><tr><th>시작</th><th>주체</th><th>결과</th><th class="n">소요</th><th class="n">게시</th><th class="n">보류</th><th class="n">버림</th><th class="n">신규</th><th class="n">변경</th><th class="n">사라짐</th><th class="n">게시율</th><th class="n">토큰</th></tr></thead><tbody>' +
      (c.runs || []).map((r) => {
        const st = STATE[r.state] || ['warn', r.state];
        return `<tr><td>${kst(r.started_at)}</td><td>${esc(TRIG[r.trigger] || r.trigger)}</td><td><span class="pill ${st[0]}">${esc(st[1])}</span>${r.errors ? `<div class="err-text">${esc(String(r.errors).slice(0, 140))}</div>` : ''}</td>` +
          `<td class="n">${num(r.duration_s)}초</td><td class="n">${num(r.published)}</td><td class="n">${num(r.pending)}</td><td class="n">${num(r.rejected)}</td><td class="n">${num(r.inserted)}</td><td class="n">${num(r.updated)}</td><td class="n">${num(r.gone)}</td><td class="n">${pct(r.auto_publish_rate)}</td><td class="n">${num(Number(r.input_tokens || 0) + Number(r.output_tokens || 0))}</td></tr>`;
      }).join('') + '</tbody>';

    $('#sources').innerHTML = '<thead><tr><th>출처</th><th>브랜드</th><th>상태</th><th>마지막 성공</th></tr></thead><tbody>' +
      (c.sources || []).map((s) => {
        const off = String(s.active).toUpperCase() === 'FALSE';
        const pill = off ? '<span class="pill warn">꺼짐</span>' : s.last_error ? '<span class="pill bad">오류</span>' : s.last_ok_at ? '<span class="pill good">정상</span>' : '<span class="pill warn">미실행</span>';
        return `<tr><td>${esc(s.id)}</td><td>${esc(s.brand)}</td><td>${pill}${s.last_error ? `<div class="err-text">${esc(s.last_error)}</div>` : ''}</td><td>${kst(s.last_ok_at)}</td></tr>`;
      }).join('') + '</tbody>';

    hbars($('#brands'), c.published_by_brand);
    hbars($('#pending'), c.pending_reasons);

    const reps = data.reports.recent || [];
    $('#reports').innerHTML = reps.length ? '<thead><tr><th>시각</th><th>쿠폰</th><th>사유</th><th>내용</th><th>상태</th></tr></thead><tbody>' +
      reps.map((r) => `<tr><td>${kst(r.ts)}</td><td>${esc(r.brand)} ${esc(r.menu)}</td><td>${esc(r.reason)}</td><td>${esc(r.memo)}</td><td>${esc(r.status)}</td></tr>`).join('') + '</tbody>'
      : '<tbody><tr><td class="muted">아직 제보가 없어요</td></tr></tbody>';
  }

  // 활동보고서·사업계획서에 붙일 "실측" 요약 (예시 모드에서는 복사하지 않음)
  $('#copyBtn').addEventListener('click', async () => {
    if (!data) return;
    if (DEMO) { alert('예시 지표는 보고서에 쓸 수 없어 복사하지 않습니다.'); return; }
    const c = data.collection, u = data.usage;
    const text = [
      `[AMONG 실측 지표] 기간 ${data.period.from} ~ ${data.period.to} (KST, 대시보드 생성 ${kst(data.generated_at)})`,
      `- 방문자 ${num(u.visitors)}명(브라우저 기준), 세션 ${num(u.sessions)}개`,
      `- 공식 앱 이동률 ${pct(u.click_session_rate)} (이동이 있었던 세션 / 전체 세션)`,
      `- 2개 이상 브랜드 비교율 ${pct(u.multi_brand_rate)} (상세 확인·이동이 있었던 세션 ${num(u.engaged_sessions)}개 기준)`,
      `- 7일 재방문율 ${pct(u.retention_7d)} (첫 방문 후 7일이 지난 ${num(u.retention_7d_base)}명 기준)`,
      `- 자동 수집: 최근 7회 평균 자동 게시율 ${pct(c.auto_publish_rate_7runs)}, 현재 게시 쿠폰 ${num((c.coupons_by_status || {}).published || 0)}개`,
      `- 오류 제보 ${num(data.reports.total)}건 (미처리 ${num(data.reports.open)}건)`,
    ].join('\n');
    try { await navigator.clipboard.writeText(text); alert('복사했어요. 표본 수와 기간을 함께 적어 주세요.'); }
    catch { prompt('아래 내용을 복사하세요', text); }
  });

  $('#authForm').addEventListener('submit', (e) => { e.preventDefault(); load(); });
  $('#token').value = ss.get('among_admin');
  if (DEMO || $('#token').value) load();
})();
