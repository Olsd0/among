// 수집기와 화면이 동일한 판단 로직과 상품 사진 목록을 쓰도록 복사한다.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
for (const file of ['engine.js', 'product-images.js', 'notice-images.js', 'verified-news.js', 'app-coupons.js']) {
  copyFileSync(new URL(`../src/${file}`, import.meta.url), new URL(`../../web/${file}`, import.meta.url));
  console.log(`web/${file} 갱신 완료`);
}
const gas = new URL('../../apps-script/Code.gs', import.meta.url);
const marker = '// BEGIN GENERATED APP COUPONS';
const model = readFileSync(new URL('../src/app-coupons.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const backend = readFileSync(new URL('../../apps-script/app-coupon-backend.gs', import.meta.url), 'utf8');
writeFileSync(gas, readFileSync(gas, 'utf8').split(marker)[0].trimEnd() + '\n\n' + marker + '\n' + model + '\n' + backend + '\n// END GENERATED APP COUPONS\n');
