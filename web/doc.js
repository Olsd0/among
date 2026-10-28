// AMONG 안내 페이지 공통: 홈과 같은 화면 테마, 문의처 표시, 개인정보처리방침의 '이용 기록 끄기'·'이 기기 정보 지우기'
(function () {
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };

  // 화면 테마 (홈에서 고른 것과 같게)
  const theme = ls.get('among_theme', 'system');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

  // 문의처: config.js의 contactEmail이 있으면 메일, 없으면 안내 문구
  const email = String((window.AMONG_CONFIG || {}).contactEmail || '').trim();
  const okEmail = /^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/.test(email);
  document.querySelectorAll('[data-contact]').forEach((el) => {
    if (okEmail) {
      const a = document.createElement('a');
      a.href = `mailto:${email}`;
      a.textContent = email;
      el.replaceChildren(a);
    } else {
      el.textContent = el.dataset.contactFallback || '문의 메일 준비 중 (아래 방법으로 알려 주세요)';
    }
  });

  // 이용 기록 끄기 (홈 화면의 track()이 among_notrack을 확인)
  const sw = document.getElementById('trackSwitch');
  const swNote = document.getElementById('trackNote');
  if (sw) {
    const gpc = navigator.globalPrivacyControl === true;
    sw.checked = !gpc && ls.get('among_notrack', false) !== true;
    if (gpc) {
      sw.disabled = true;
      if (swNote) swNote.textContent = '브라우저의 추적 거부(GPC) 신호가 켜져 있어 이용 기록을 보내지 않아요.';
    }
    sw.addEventListener('change', () => {
      const saved = ls.set('among_notrack', !sw.checked);
      if (swNote) swNote.textContent = !saved ? '이 브라우저는 설정을 저장할 수 없어요.' : sw.checked ? '이용 기록을 보내요. 언제든 다시 끌 수 있어요.' : '이제 이 브라우저에서는 이용 기록을 보내지 않아요.';
    });
  }

  // 이 기기에 저장된 AMONG 정보 지우기 (두 번 눌러 확인 — 브라우저 확인 창은 쓰지 않음)
  const clr = document.getElementById('clearLocal');
  const clrNote = document.getElementById('clearNote');
  if (clr) {
    let armed = false;
    clr.addEventListener('click', () => {
      if (!armed) { armed = true; clr.textContent = '한 번 더 누르면 지워요'; return; }
      let n = 0;
      try {
        Object.keys(localStorage).filter((k) => k.startsWith('among_')).forEach((k) => { localStorage.removeItem(k); n++; });
        if (window.caches) caches.keys().then((ks) => ks.filter((k) => k.startsWith('among-')).forEach((k) => caches.delete(k))).catch(() => {});
      } catch { /* 저장소 접근 불가 */ }
      armed = false;
      clr.textContent = '지우기';
      if (sw && !sw.disabled) sw.checked = true;
      if (clrNote) clrNote.textContent = n ? `이 기기에 저장된 AMONG 정보 ${n}가지를 지웠어요. 다음 방문 때 새 무작위 번호가 만들어져요.` : '지울 정보가 없어요.';
    });
  }
})();
