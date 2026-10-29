// 수집기와 화면이 동일한 판단 로직과 상품 사진 목록을 쓰도록 복사한다.
import { copyFileSync } from 'node:fs';
for (const file of ['engine.js', 'product-images.js', 'notice-images.js']) {
  copyFileSync(new URL(`../src/${file}`, import.meta.url), new URL(`../../web/${file}`, import.meta.url));
  console.log(`web/${file} 갱신 완료`);
}
