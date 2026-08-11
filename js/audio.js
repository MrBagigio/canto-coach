// Il suono che fa l'app: la nota di riferimento da cantare.
//
// Due decisioni che l'AVVIO §2 chiama per nome, e nessuna delle due è estetica.
//
// ① NON una sinusoide. Un tono puro è difficile da agganciare per l'orecchio: non ha
//    armoniche, quindi la sensazione di «altezza» è debole e chi non è allenato ci canta
//    sopra a caso. Serve un timbro con parziali, tipo organo. Qui sono le prime sei, con
//    ampiezze 1/n smussate: abbastanza da dare un'altezza solida, non tante da diventare
//    un ronzio.
//
// ② L'APP NON SUONA MENTRE MISURA. È la regola su cui sta in piedi tutto il progetto
//    (§0: strumento e voce si alternano, non suonano mai insieme) ed è anche la lezione
//    che è già costata cara altrove: nell'ukulele il click del metronomo veniva contato
//    come una pennata dell'utente, e l'esercizio risultava suonato benissimo a strumento
//    appoggiato sul tavolo. Un programma che emette e misura si dà da solo la risposta
//    che sperava.
//
//    Qui non basta smettere di suonare: bisogna aspettare che la CODA sia finita, perché
//    una nota che si spegne è ancora un suono in banda. `daiLaNota()` risolve solo quando
//    la coda è passata, e il collaudo misura in dB quanto esce dall'app durante la
//    finestra di misura invece di darlo per buono.

const CODA_MS = 260;          // discesa dell'inviluppo: sotto, si sente il taglio netto
const ATTACCO_MS = 25;
const SILENZIO_MS = 120;      // margine dopo la coda, prima di dichiarare che si può misurare

let ctx = null;
let bus = null;
let onda = null;

/** Il contesto audio, uno solo per tutta l'app. */
export function contesto() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(ctx.destination);
  }
  return ctx;
}

/** Il bus da cui esce TUTTO quello che suona l'app. Esiste perché il collaudo lo possa ascoltare. */
export function uscita() {
  contesto();
  return bus;
}

export async function sblocca() {
  const c = contesto();
  if (c.state !== 'running') await c.resume().catch(() => {});
  return c.state === 'running';
}

function ondaOrgano() {
  if (onda) return onda;
  const c = contesto();
  const imag = [0, 1, 0.5, 0.34, 0.22, 0.13, 0.08];
  onda = c.createPeriodicWave(new Float32Array(imag.length), new Float32Array(imag));
  return onda;
}

/**
 * Suona una nota e risolve QUANDO L'ARIA È TORNATA FERMA, non quando l'inviluppo comincia
 * a scendere. La differenza è tutto il punto dell'alternanza.
 *
 * @param {number} frequenza Hz
 * @param {{durataMs?:number, volume?:number}} opzioni
 * @returns {Promise<void>}
 */
export function daiLaNota(frequenza, { durataMs = 1600, volume = 0.22 } = {}) {
  const c = contesto();
  const o = c.createOscillator();
  o.setPeriodicWave(ondaOrgano());
  o.frequency.value = frequenza;
  const g = c.createGain();
  const t0 = c.currentTime + 0.02;
  const tFine = t0 + durataMs / 1000;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(volume, t0 + ATTACCO_MS / 1000);
  g.gain.setValueAtTime(volume, tFine);
  g.gain.exponentialRampToValueAtTime(0.0001, tFine + CODA_MS / 1000);
  o.connect(g).connect(uscita());
  o.start(t0);
  o.stop(tFine + CODA_MS / 1000 + 0.02);
  return new Promise((risolvi) => {
    o.onended = () => { g.disconnect(); risolvi(); };
    // Rete di sicurezza: `onended` non arriva se la scheda va in secondo piano nel momento
    // sbagliato, e una promessa che non si risolve blocca l'esercizio per sempre.
    setTimeout(risolvi, durataMs + CODA_MS + SILENZIO_MS + 400);
  });
}

/** Un arpeggio o una scala: note in fila, ognuna aspettata. */
export async function daiLeNote(frequenze, { durataMs = 700, pausaMs = 60 } = {}) {
  for (const f of frequenze) {
    await daiLaNota(f, { durataMs });
    if (pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
  }
}

export function chiudi() {
  if (ctx) { ctx.close().catch(() => {}); ctx = null; bus = null; onda = null; }
}

export { CODA_MS, SILENZIO_MS };
