// Quello che l'app si ricorda di te. Tutto in localStorage, tutto dentro il telefono:
// nessun account, nessun server, niente da cancellare da nessuna parte.

const CHIAVE = 'canto-coach';

const vuoto = () => ({
  versione: 1,
  estensione: null,      // {grave, acuto, quando} — numeri MIDI
  zonaProvvisoria: null, // {basso, alto} dalla prima nota cantata, finché non c'è l'estensione
  sessioni: [],          // le ultime, dalla più recente
  visto: {},             // quali esercizi hai già aperto almeno una volta
  schede: [],            // ripetizione spaziata dell'orecchio
});

let dati = null;

export function leggi() {
  if (dati) return dati;
  try {
    const grezzo = localStorage.getItem(CHIAVE);
    dati = grezzo ? { ...vuoto(), ...JSON.parse(grezzo) } : vuoto();
  } catch { dati = vuoto(); }
  return dati;
}

function scrivi() {
  try { localStorage.setItem(CHIAVE, JSON.stringify(dati)); } catch { /* modalità privata */ }
}

export function salvaEstensione(grave, acuto, quando) {
  leggi();
  dati.estensione = { grave, acuto, quando };
  scrivi();
}

export function salvaZonaProvvisoria(zona) {
  leggi();
  dati.zonaProvvisoria = zona;
  scrivi();
}

/**
 * Una sessione fatta. Se ne tengono venti: servono a vedere una tendenza, e una tendenza
 * su cento sessioni non la guarda nessuno da un telefono.
 */
export function salvaSessione(voce) {
  leggi();
  dati.sessioni.unshift({ ...voce, quando: Date.now() });
  dati.sessioni = dati.sessioni.slice(0, 20);
  scrivi();
}

export function sessioniDi(esercizio) {
  return leggi().sessioni.filter((s) => s.esercizio === esercizio);
}

/** Le schede dell'orecchio, create alla prima apertura da un elenco di id. */
export function schede(idAttesi) {
  leggi();
  const per = new Map(dati.schede.map((s) => [s.id, s]));
  const fuse = idAttesi.map((id) => per.get(id) || { id, gradino: 0, quando: 0, viste: 0, giuste: 0 });
  if (fuse.length !== dati.schede.length) { dati.schede = fuse; scrivi(); }
  return dati.schede;
}

export function salvaScheda(scheda) {
  leggi();
  const i = dati.schede.findIndex((s) => s.id === scheda.id);
  if (i >= 0) dati.schede[i] = scheda; else dati.schede.push(scheda);
  scrivi();
}

export function segnaVisto(id) {
  leggi();
  dati.visto[id] = true;
  scrivi();
}

export function dimenticaTutto() {
  dati = vuoto();
  scrivi();
}

/**
 * L'estensione è vecchia? Cambia con la giornata — con il sonno, con il raffreddore, con
 * l'ora. Dirlo è parte della misura: un numero di tre settimane fa presentato come «la tua
 * estensione» è una bugia piccola ma è una bugia.
 */
export function estensioneStantia(giorni = 10) {
  const e = leggi().estensione;
  if (!e) return false;
  return Date.now() - e.quando > giorni * 24 * 3600 * 1000;
}
