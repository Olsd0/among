// AMONG 안내 페이지의 움직임 (story.css와 짝). 없어도 그림은 끝난 모습으로 보인다.
// 1) data-reveal 그림이 화면에 들어오면 .in → 처음 모습에서 끝난 모습으로 한 번 움직인다
// 2) 첫 화면 쿠폰 줄 세우기 '다시 보기'
(function () {
  const root = document.documentElement;
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still && 'IntersectionObserver' in window) {
    root.classList.add('story-ready');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.2 });
    document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
  }

  document.querySelectorAll('[data-replay]').forEach((btn) => {
    const target = document.getElementById(btn.getAttribute('data-replay'));
    if (!target || still) return;
    btn.hidden = false;
    btn.addEventListener('click', () => {
      target.classList.remove('play');
      void target.offsetWidth; // 애니메이션을 처음부터 다시
      target.classList.add('play');
    });
  });
})();
