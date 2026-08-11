// Service worker: l'app deve partire anche senza rete — in macchina, in cantina, in treno.
// È il modo in cui questa app viene usata di più: cuffie, telefono, nessuna scusa.
//
// Strategia: RETE PRIMA per il codice, cache prima solo per le icone.
//
// La cache-first è la scelta ovvia e sbagliata, e in questa famiglia di progetti ha morso
// TRE volte, sempre in modo diverso: in sviluppo serviva il file di ieri e un fix sembrava
// inerte; in produzione, dopo un rilascio, il service worker vecchio serviva dalla cache i
// moduli che conosceva e andava in rete per quelli nuovi — miscuglio di due versioni,
// «does not provide an export named…», pagina bianca; e due volte è bastato dimenticarsi
// di alzare `VERSIONE`. Un rimedio che dipende dal ricordarsi di alzare un numero non è
// un rimedio.
//
// Adesso: si prova la rete con un tetto di 2,5 secondi e la cache è la RISERVA. Online hai
// sempre l'ultima versione senza dover ricordare niente; offline parte comunque tutto.

const VERSIONE = 'canto-v1';
const ATTESA_RETE_MS = 2500;
const RISORSE = [
  './',
  'index.html',
  'app.webmanifest',
  'css/canto.css',
  'js/app.js',
  'js/audio.js',
  'js/ascolto.js',
  'js/pitch.js',
  'js/vibrato.js',
  'js/esercizi.js',
  'js/melodie.js',
  'js/ripasso.js',
  'js/percorso.js',
  'js/teoria.js',
  'js/store.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

// Il banco di collaudo e la prova zero NON vanno in cache: servirebbero la versione di
// ieri, e si finirebbe per collaudare il codice vecchio credendo di provare quello nuovo.
const MAI_IN_CACHE = /collaudo|prova-zero/;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSIONE);
    // Uno per uno e non `addAll`: quello fallisce tutto se manca un file solo, e un'icona
    // assente non deve impedire all'app di funzionare offline.
    await Promise.all(RISORSE.map((r) => cache.add(new Request(r, { cache: 'reload' })).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomi = await caches.keys();
    await Promise.all(nomi.filter((n) => n !== VERSIONE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const richiesta = e.request;
  if (richiesta.method !== 'GET') return;
  const url = new URL(richiesta.url);
  if (url.origin !== self.location.origin) return;
  if (MAI_IN_CACHE.test(url.pathname)) return;

  const immutabile = /\/icons\//.test(url.pathname);

  e.respondWith((async () => {
    const cache = await caches.open(VERSIONE);
    if (immutabile) {
      const salvato = await cache.match(richiesta);
      if (salvato) return salvato;
    }
    const risposta = await conTetto(fetch(richiesta), ATTESA_RETE_MS);
    if (risposta && risposta.ok) {
      cache.put(richiesta, risposta.clone()).catch(() => {});
      return risposta;
    }
    const riserva = await cache.match(richiesta)
      || (richiesta.mode === 'navigate' ? (await cache.match('index.html')) || (await cache.match('./')) : null);
    return riserva || risposta || Response.error();
  })());
});

/** La promessa, oppure null se ci mette troppo o fallisce. Mai un'attesa senza fine. */
function conTetto(promessa, ms) {
  return Promise.race([
    promessa.catch(() => null),
    new Promise((risolvi) => setTimeout(() => risolvi(null), ms)),
  ]);
}
