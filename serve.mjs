import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ...['app', 'harness', 'scenarios', 'trace'].map((name) => ['/' + name + '.mjs', [name + '.mjs', 'text/javascript']]),
]);
const port = Number(process.argv[2] ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('用法：npm start -- <端口 1–65535>');
  process.exit(1);
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const asset = assets.get(request.url.split('?')[0]);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(new URL('./docs/' + asset[0], import.meta.url));
    response.writeHead(200, {
      'Content-Type': asset[1] + '; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'",
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(500).end();
  }
});
server.on('error', (error) => {
  console.error('预览服务启动失败 · ' + error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port));
