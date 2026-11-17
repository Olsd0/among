// POST /api/collector — 수집기 전용 (Cloudflare Secrets의 COLLECTOR_TOKEN). server/core.js
import { handleCollector } from '../../server/core.js';

export const onRequestPost = ({ request, env }) => handleCollector(request, env);
