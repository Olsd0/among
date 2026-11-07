// 테스트용 정적 서버
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath, relative, sep, isAbsolute, extname } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

export function serveDir(root) {
  return new Promise((resolve) => {
    const hits = [];
    const server = createServer(async (req, res) => {
      try {
        const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        hits.push(path);
        const file = resolvePath(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
        const local = relative(root, file);
        if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) {
          res.writeHead(404); res.end(); return;
        }
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
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
