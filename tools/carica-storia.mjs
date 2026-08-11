// Ricostruisce su GitHub l'intera storia dei commit locali, con la API Git Data.
//
// Un commit alla volta: per ognuno si legge l'albero da git, si caricano i blob, si crea
// l'albero e il commit con il genitore giusto, conservando autore, messaggio e DATE
// originali. Alla fine il ramo remoto ha la stessa storia di quello locale, non uno
// schiacciamento — e i due possono tornare a parlarsi.
//
//   node carica-storia.mjs <cartella> <utente/repo>

import { execFileSync } from 'node:child_process';

const [, , RADICE, REPO] = process.argv;
if (!RADICE || !REPO) throw new Error('uso: node carica-storia.mjs <cartella> <utente/repo>');

const git = (...args) => execFileSync('git', ['-C', RADICE, ...args], {
  encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
});
const gitBin = (...args) => execFileSync('git', ['-C', RADICE, ...args], {
  encoding: 'buffer', maxBuffer: 128 * 1024 * 1024,
});

function api(percorso, metodo = 'GET', corpo = null) {
  const args = ['api', percorso, '-X', metodo, '-H', 'Accept: application/vnd.github+json'];
  if (corpo) args.push('--input', '-');
  const out = execFileSync('gh', args, {
    input: corpo ? JSON.stringify(corpo) : undefined,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : null;
}

const commits = git('log', '--reverse', '--format=%H').trim().split('\n');
console.log(`${commits.length} commit da ricostruire su ${REPO}`);

// I blob non si ricaricano due volte: il contenuto identico ha lo stesso sha, e fra un
// commit e l'altro cambia una manciata di file su cinquanta.
const giaCaricati = new Map();

let genitore = null;
for (const sha of commits) {
  const voci = git('ls-tree', '-r', sha).trim().split('\n').map((riga) => {
    const [meta, percorso] = riga.split('\t');
    const [modo, , oggetto] = meta.split(/\s+/);
    return { modo, oggetto, percorso };
  });

  const albero = [];
  for (const v of voci) {
    let blobSha = giaCaricati.get(v.oggetto);
    if (!blobSha) {
      const contenuto = gitBin('cat-file', 'blob', v.oggetto);
      blobSha = api(`repos/${REPO}/git/blobs`, 'POST', {
        content: contenuto.toString('base64'),
        encoding: 'base64',
      }).sha;
      giaCaricati.set(v.oggetto, blobSha);
      process.stdout.write('.');
    }
    albero.push({ path: v.percorso, mode: v.modo, type: 'blob', sha: blobSha });
  }

  const t = api(`repos/${REPO}/git/trees`, 'POST', { tree: albero });
  // Un campo per chiamata: mettere i segnaposto dentro un JSON scritto a mano dava
  // stringhe non quotate ({"an":MrBagigio}) e quindi JSON non valido.
  const campo = (f) => git('show', '-s', `--format=${f}`, sha).trim();
  const info = {
    an: campo('%an'), ae: campo('%ae'), ad: campo('%aI'),
    cn: campo('%cn'), ce: campo('%ce'), cd: campo('%cI'),
  };
  const messaggio = git('show', '-s', '--format=%B', sha).replace(/\n+$/, '');

  const commit = api(`repos/${REPO}/git/commits`, 'POST', {
    message: messaggio,
    tree: t.sha,
    parents: genitore ? [genitore] : [],
    author: { name: info.an, email: info.ae, date: info.ad },
    committer: { name: info.cn, email: info.ce, date: info.cd },
  });
  genitore = commit.sha;
  process.stdout.write(`\n  ${sha.slice(0, 7)} → ${commit.sha.slice(0, 7)}  ${messaggio.split('\n')[0].slice(0, 60)}\n`);
}

api(`repos/${REPO}/git/refs/heads/main`, 'PATCH', { sha: genitore, force: true });
console.log(`ramo main → ${genitore}`);
