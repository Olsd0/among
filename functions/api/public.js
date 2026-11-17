// Cloudflare Pages Functions: GET /api/public — 방문자용 조회를 D1에서 (server/d1-store.js)
// D1 연결(바인딩 이름 DB)이 없으면 { ok:false, error:'no_db' }를 주고 화면은 기존 Apps Script를 쓴다.
import { handlePublic } from '../../server/d1-store.js';

export const onRequestGet = ({ request, env, waitUntil }) => handlePublic(request, env, { waitUntil });
