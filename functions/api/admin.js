// POST /api/admin — 관리자 전용 (Cloudflare Secrets의 ADMIN_TOKEN). server/core.js
import { handleAdmin } from '../../server/core.js';

export const onRequestPost = ({ request, env }) => handleAdmin(request, env);
