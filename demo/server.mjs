// Serves the demo app on one URL. `?v=before|after` picks a version for a single request;
// POST /__variant/<name> switches what the plain URL serves, so both uilint runs hit the same address.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('./', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export function startServer(port = 5173) {
  let current = 'before';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname.startsWith('/__variant/')) {
      current = url.pathname.split('/').pop();
      res.end(current);
      return;
    }
    const variant = url.searchParams.get('v') ?? current;
    let file;
    if (url.pathname === '/' || url.pathname === '/index.html') file = 'app/index.html';
    else if (url.pathname === '/app.js') file = `app/dist/${variant}.js`;
    else if (url.pathname === '/styles.css') file = 'app/styles.css';
    else file = normalize(url.pathname).replace(/^\/+/, '');
    try {
      let body = await readFile(join(root, file));
      if (file === 'app/index.html' && url.searchParams.has('v')) {
        body = Buffer.from(String(body).replace('/app.js', `/app.js?v=${variant}`));
      }
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://localhost:${port}/`,
    setVariant: (v) => fetch(`http://127.0.0.1:${port}/__variant/${v}`, { method: 'POST' }),
    close: () => new Promise((r) => server.close(r)),
  })));
}
