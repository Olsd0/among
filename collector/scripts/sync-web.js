// collector/src/engine.js → web/engine.js 복사 (화면과 수집기가 같은 계산 로직을 쓰도록)
import { copyFileSync } from 'node:fs';
const src = new URL('../src/engine.js', import.meta.url);
const dst = new URL('../../web/engine.js', import.meta.url);
copyFileSync(src, dst);
console.log('web/engine.js 갱신 완료');
