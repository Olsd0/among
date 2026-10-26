// 테스트용 정적 서버
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css' };

export function serveDir(root) {
  return new Promise((resolve) => {
    const hits = [];
    const server = createServer(async (req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      hits.push(path);
      try {
        const body = await readFile(join(root, path.endsWith('/') ? path + 'index.html' : path));
        res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404); res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ base: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
