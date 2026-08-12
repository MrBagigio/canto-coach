// Scale, arpeggi e melodie — GENERATE, mai copiate.
//
// Non è pigrizia, è la risposta al problema di §6 dell'AVVIO. Le prime tre app della
// famiglia hanno schivato il diritto d'autore senza accorgersene: una sequenza di accordi
// non è protetta, e infatti le loro librerie di giri esistono. Un'app di canto invece vuole
// MELODIE, che sono la parte più protetta che esista — la melodia è proprio ciò che il
// diritto d'autore protegge in una canzone.
//
// Le tre vie pulite sono: melodie generate, repertorio di pubblico dominio, melodie
// inserite dall'utente che restano sul telefono. Questo file è la prima: intervalli,
// scale e arpeggi sono infiniti, non hanno un autore, e per giunta sono esattamente il
// materiale che si usa a lezione. Nessuna melodia riconoscibile viene generata di
// proposito: si cammina sui gradi di una scala.
//
// Tutto è deterministico dato un seme, perché una funzione che sorteggia dentro di sé non
// si collauda: il collaudo deve poter dire «con QUALUNQUE seme, la melodia sta dentro la
// zona comoda e non salta più di una sesta».

export const SCALE = {
  maggiore: { nome: 'maggiore', gradi: [0, 2, 4, 5, 7, 9, 11] },
  minoreNaturale: { nome: 'minore naturale', gradi: [0, 2, 3, 5, 7, 8, 10] },
  pentatonica: { nome: 'pentatonica maggiore', gradi: [0, 2, 4, 7, 9] },
};

/** Generatore lineare congruente: stessa sequenza a parità di seme, su qualunque telefono. */
export function caso(seme) {
  let s = (seme | 0) || 1;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/** Il grado n-esimo di una scala, anche oltre l'ottava (n può essere negativo). */
export function gradoDi(tonica, n, scala = SCALE.maggiore) {
  const g = scala.gradi;
  const ottava = Math.floor(n / g.length);
  const dentro = ((n % g.length) + g.length) % g.length;
  return tonica + ottava * 12 + g[dentro];
}

/**
 * Quanti GRADI di scala stanno dentro un certo numero di SEMITONI.
 *
 * Esiste perché le due unità si somigliano abbastanza da scambiarle senza che niente
 * esploda, ed è successo: `melodiaGenerata` conta l'ambito in gradi, la zona comoda di chi
 * canta si misura in semitoni, e passare l'una dove serviva l'altra faceva chiedere note
 * fino a SEI semitoni sopra la zona comoda — il grado 8 della maggiore sta a quattordici
 * semitoni dalla tonica, non a otto. A chi canta arrivava l'esatto contrario della
 * promessa «le note te le do dove ci arrivi».
 */
export function gradiInSemitoni(semitoni, scala = SCALE.maggiore) {
  let n = 0;
  while (gradoDi(0, n + 1, scala) <= semitoni) n += 1;
  return n;
}

/**
 * La scala dell'esercizio di agilità: su e giù, cinque note.
 *
 * È l'esercizio classico — quello che qualunque insegnante fa fare — e qui è cronometrato.
 * Sale e ridiscende sulla stessa nota, così l'ultimo suono è il primo e si sente da soli
 * se si è tornati dove si era partiti.
 */
export function scalaAgilita(tonica, { note = 5, scala = SCALE.maggiore } = {}) {
  const su = Array.from({ length: note }, (_, i) => gradoDi(tonica, i, scala));
  const giu = su.slice(0, -1).reverse();
  return [...su, ...giu];
}

/** Un arpeggio: tonica, terza, quinta, ottava e ritorno. */
export function arpeggio(tonica, { scala = SCALE.maggiore } = {}) {
  const su = [0, 2, 4, 7].map((n) => gradoDi(tonica, n, scala));
  return [...su, ...su.slice(0, -1).reverse()];
}

/**
 * Una melodia generata: cammina sui gradi della scala.
 *
 * Regole, tutte per una ragione:
 *   parte e finisce sulla tonica, così l'orecchio ha un punto di riferimento e si sente
 *     da soli quando si è tornati a casa;
 *   i passi sono di uno o due gradi, con un salto di quinta ogni tanto: una melodia tutta
 *     a salti non si canta, una tutta per gradi congiunti non insegna niente;
 *   MAI due note uguali di fila. Non è gusto: due note identiche attaccate sono una nota
 *     sola tenuta lunga, il microfono non le può distinguere, e l'esercizio ne conterebbe
 *     una come mancata — bocciando chi ha fatto esattamente quello che gli era chiesto.
 *     Un limite della misura va tolto di mezzo generando, non ignorato giudicando.
 *   MAI il tritono. Il salto di tre gradi dalla quarta alla settima fa sei semitoni, ed è
 *     l'intervallo più difficile da intonare che esista: non si mette in un esercizio dove
 *     serve altro;
 *   non esce dall'ambito chiesto — che è la zona comoda di CHI CANTA, non un intervallo
 *     scelto a tavolino.
 */
export const SALTO_MASSIMO_SEMITONI = 7;

export function melodiaGenerata(tonica, { passi = 6, seme = 1, scala = SCALE.maggiore, ambito = 8 } = {}) {
  const r = caso(seme);
  const semitoniFra = (a, b) => Math.abs(gradoDi(tonica, a, scala) - gradoDi(tonica, b, scala));
  const gradi = [0];
  let g = 0;
  let direzione = 1;
  // Il grado di due note fa: serve a vietare l'andirivieni. Senza, le prime melodie
  // uscivano tutte «Sol La Sol La Sol» — formalmente a posto e completamente inutili.
  const penultimo = () => (gradi.length > 1 ? gradi[gradi.length - 2] : null);
  const va = (c, evitaRitorno = true) => {
    if (c === g || c < 0 || c > ambito) return false;
    if (evitaRitorno && c === penultimo()) return false;
    const s = semitoniFra(c, g);
    return s <= SALTO_MASSIMO_SEMITONI && s !== 6;
  };

  for (let i = 1; i < passi - 1; i += 1) {
    // Inerzia: una melodia va da qualche parte. Cambiare direzione a ogni nota è
    // esattamente quello che non fa una frase musicale.
    if (r() > 0.68) direzione = -direzione;
    if (g <= 0) direzione = 1;
    if (g >= ambito) direzione = -1;
    const p = r();
    const salto = p < 0.2 ? 4 : (p < 0.55 ? 2 : 1);
    const candidati = [g + salto * direzione, g + direzione, g + 2 * direzione,
      g - direzione, g + 2, g - 2, g + 1, g - 1];
    const scelto = candidati.find((c) => va(c)) ?? candidati.find((c) => va(c, false));
    if (scelto === undefined) break;
    g = scelto;
    gradi.push(g);
  }

  // Il rientro a casa. La tonica finale NON si raggiunge con un salto qualunque: la prima
  // stesura chiudeva «La4 → Sol3», quattordici semitoni, che nessuno canta. Si scende per
  // gradi finché la tonica è a portata.
  while (semitoniFra(g, 0) > SALTO_MASSIMO_SEMITONI) {
    g += g > 0 ? -2 : 2;
    gradi.push(g);
  }
  if (gradi[gradi.length - 1] === 0) gradi.pop();
  gradi.push(0);
  return gradi.map((n) => gradoDi(tonica, n, scala));
}

/**
 * Spezza una serie di altezze in NOTE.
 *
 * Serve agli esercizi in cui si canta più di un suono di fila (scala, arpeggio, melodia):
 * il microfono dà una linea continua, e il portamento fra una nota e l'altra è parte di
 * quella linea. Una nota è un tratto in cui l'altezza sta ferma abbastanza a lungo.
 *
 * `minMs` non è scelto a caso: sotto i 90 ms non è una nota cantata, è il passaggio da
 * una all'altra. E la durata si conta in millisecondi, non in numero di letture, perché
 * la cadenza del ciclo cambia di quaranta volte fra una pagina davanti e una in secondo
 * piano — è lo stesso difetto già pagato altrove in questo progetto.
 *
 * @param {number[]} serieMidi altezze in numero MIDI frazionario, una per lettura
 * @param {number} dtMs passo fra due letture
 * @returns {Array<{midi:number, daMs:number, durataMs:number}>}
 */
export function segmentaNote(serieMidi, dtMs, { minMs = 90, tolleranza = 0.7 } = {}) {
  const fuori = [];
  let corrente = [];
  let inizio = 0;
  const mediana = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const chiudi = (fine) => {
    const durata = (fine - inizio) * dtMs;
    if (corrente.length && durata >= minMs) {
      fuori.push({ midi: mediana(corrente), daMs: inizio * dtMs, durataMs: durata });
    }
    corrente = [];
  };
  for (let i = 0; i < serieMidi.length; i += 1) {
    const v = serieMidi[i];
    // Un buco (silenzio fra due note) CHIUDE la nota in corso. Se lo si tappasse con
    // l'ultimo valore buono, due note uguali separate da un respiro diventerebbero una
    // nota sola — e in una scala che sale e ridiscende succede a ogni giro.
    if (v === null || !Number.isFinite(v)) { chiudi(i); continue; }
    if (!corrente.length) { corrente = [v]; inizio = i; continue; }
    if (Math.abs(v - mediana(corrente)) <= tolleranza) corrente.push(v);
    else { chiudi(i); corrente = [v]; inizio = i; }
  }
  chiudi(serieMidi.length);
  return fuori;
}

/**
 * Confronta quello che hai cantato con quello che era chiesto.
 *
 * L'allineamento è in ORDINE e non a coppie fisse: se salti una nota, le successive non
 * devono risultare tutte sbagliate per colpa di quella. Si scorre la sequenza attesa e per
 * ognuna si cerca la prossima nota cantata che le assomigli, andando sempre avanti.
 */
export function confrontaSequenza(cantate, attese, { tolleranzaCent = 90 } = {}) {
  const esiti = [];
  let i = 0;
  for (const attesa of attese) {
    let trovata = null;
    for (let j = i; j < cantate.length && j < i + 3; j += 1) {
      const scarto = (cantate[j].midi - attesa) * 100;
      if (Math.abs(scarto) <= tolleranzaCent) { trovata = { ...cantate[j], scarto }; i = j + 1; break; }
    }
    esiti.push({ attesa, cantata: trovata });
  }
  const prese = esiti.filter((e) => e.cantata).length;
  const scarti = esiti.filter((e) => e.cantata).map((e) => e.cantata.scarto);
  return {
    esiti,
    prese,
    su: attese.length,
    scartoMedio: scarti.length ? scarti.reduce((a, b) => a + b, 0) / scarti.length : null,
    durataMs: cantate.length ? (cantate[cantate.length - 1].daMs + cantate[cantate.length - 1].durataMs) - cantate[0].daMs : 0,
  };
}
