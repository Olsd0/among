// 직접 계약 광고 한 건. 외부 스크립트·추적 픽셀 없이, 계약 기간에만 표시한다.
export function activeSponsor(value, now = Date.now()) {
  if (!value || value.enabled !== true) return null;
  const text = (key, max) => typeof value[key] === 'string' && value[key].trim().length <= max ? value[key].trim() : '';
  const advertiser = text('advertiser', 60), title = text('title', 100), description = text('description', 240);
  if (!advertiser || !title || !description) return null;
  const timestamp = key => typeof value[key] === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value[key]) ? Date.parse(value[key]) : NaN;
  const start = timestamp('startsAt'), end = timestamp('endsAt');
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now) || now < start || now >= end || end <= start) return null;
  try {
    if (typeof value.url !== 'string' || /[\s\\\u0000-\u001f\u007f]/.test(value.url)) return null;
    const url = new URL(value.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return { advertiser, title, description, url: url.href, endsAt: end };
  } catch { return null; }
}

export function renderSponsor(element, config, now = Date.now()) {
  const sponsor = activeSponsor(config, now);
  element.replaceChildren();
  element.hidden = !sponsor;
  if (!sponsor) return null;
  const make = (tag, text, className) => {
    const el = element.ownerDocument.createElement(tag);
    el.textContent = text;
    if (className) el.className = className;
    element.append(el);
    return el;
  };
  make('span', `광고 · ${sponsor.advertiser}`, 'sponsor-label');
  make('h2', sponsor.title);
  make('p', sponsor.description);
  const link = make('a', '광고주 사이트에서 자세히 보기 ↗');
  link.href = sponsor.url;
  link.target = '_blank';
  link.rel = 'sponsored noopener noreferrer';
  link.setAttribute('aria-label', `${sponsor.advertiser} 광고주 사이트에서 자세히 보기 (새 탭)`);
  return sponsor;
}

if (typeof document !== 'undefined') {
  const slot = document.getElementById('sponsor');
  if (slot) {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      const sponsor = renderSponsor(slot, window.AMONG_CONFIG?.sponsorship);
      // 열린 탭에서도 계약 종료 시 숨기고, 긴 기간은 타이머 범위를 넘기지 않는다.
      if (sponsor) timer = setTimeout(refresh, Math.min(sponsor.endsAt - Date.now() + 1, 2147483647));
    };
    refresh();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
}
