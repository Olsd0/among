// 수집기와 화면이 동일한 판단 로직과 상품 사진 목록을 쓰도록 복사한다.
// Apps Script(Code.gs) 끝의 생성 구역도 같은 규칙 파일로 다시 만든다 (앱 전용 쿠폰 · 온라인 특가).
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
for (const file of ['engine.js', 'product-images.js', 'notice-images.js', 'verified-news.js', 'verified-events.js', 'event-notices.js', 'artwork-meta.js', 'app-coupons.js', 'online-deals-core.js']) {
  copyFileSync(new URL(`../src/${file}`, import.meta.url), new URL(`../../web/${file}`, import.meta.url));
  console.log(`web/${file} 갱신 완료`);
}
const gas = new URL('../../apps-script/Code.gs', import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const model = path => read(path).replace(/^export /gm, '');
const marker = '// BEGIN GENERATED APP COUPONS';
const sections = [
  marker, model('../src/app-coupons.js'), read('../../apps-script/app-coupon-backend.gs'), '// END GENERATED APP COUPONS', '',
  '// BEGIN GENERATED ONLINE DEALS', model('../src/online-deals-core.js'), read('../../apps-script/online-deals-backend.gs'), '// END GENERATED ONLINE DEALS',
];
writeFileSync(gas, readFileSync(gas, 'utf8').split(marker)[0].trimEnd() + '\n\n' + sections.join('\n') + '\n');
console.log('apps-script/Code.gs 생성 구역 갱신 완료');
