// Server statico minimo per provare l'app in locale (i moduli ES non si caricano
// da file://, servono le intestazioni HTTP). Nessuna dipendenza.
//
//   node tools/serve.mjs [porta]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.argv[2]) || 4181;

const TIPI = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORTA}`);
    let percorso = join(RADICE, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
    if (!percorso.startsWith(RADICE)) { res.writeHead(403).end('vietato'); return; }
    try {
      if ((await stat(percorso)).isDirectory()) percorso = join(percorso, 'index.html');
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('non trovato');
      return;
    }
    const corpo = await readFile(percorso);
    res.writeHead(200, {
      'content-type': TIPI[extname(percorso)] || 'application/octet-stream',
      'cache-control': 'no-store',       // in sviluppo la cache serve solo a ingannare
    }).end(corpo);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(e));
  }
}).listen(PORTA, () => console.log(`Canto Coach su http://localhost:${PORTA}`));
