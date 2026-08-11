// Banco di voci e strumenti sintetici per il collaudo.
//
// Serve a una cosa sola: dare al rilevatore un segnale di cui si conosce la verità, così
// l'errore si misura in centesimi invece di stimarlo a orecchio. Non usa il microfono —
// il verdetto non deve dipendere dalla stanza in cui sono.
//
// La lezione che questo file mette in pratica arriva dai tre progetti precedenti: IL BANCO
// GENTILE MENTE. Un tono puro, o una serie armonica perfetta a volume comodo, dice che
// tutto funziona e non prova niente. Qui il banco è costruito apposta per essere ostile
// nei quattro modi in cui la voce rompe un rilevatore nato sulle corde:
//
//   ① la fondamentale può essere più debole del secondo armonico (voce grave + il taglio
//      dei bassi di un microfono di telefono) → `fondamentaleDb`;
//   ② le formanti spostano l'energia su armonici alti, che diventano i picchi dominanti
//      dello spettro → il modello di formanti qui sotto, non un'ampiezza 1/n qualunque;
//   ③ il vibrato muove l'altezza mentre la si misura → `vibratoHz`/`vibratoCent`;
//   ④ un mugolato tranquillo sta 20 dB sotto una corda pizzicata → `rms`, che è un
//      LIVELLO VOLUTO in dBFS e non un guadagno arbitrario.
//
// Il quarto punto è quello che rende questo banco diverso da quello dell'ukulele: lì il
// guadagno era 0,45 «perché andava bene», e con un numero arbitrario non si può collaudare
// una soglia. Qui il livello si chiede in dBFS e si verifica misurandolo.

// ── Timbri ───────────────────────────────────────────────────────────────────

/**
 * Formanti di voce maschile adulta (Peterson & Barney, valori classici) più il mugolato.
 *
 * `pendenza` è la caduta della sorgente glottidale in dB per ottava: la voce cantata sta
 * fra 6 e 12, il mugolato a bocca chiusa molto più giù perché la bocca chiusa è un filtro
 * passa-basso. `formanti` sono coppie [centro Hz, larghezza Hz]: più stretta la banda,
 * più alto e appuntito il picco.
 *
 * Il mugolato NON ha le tre formanti di una vocale: a bocca chiusa il tratto vocale è un
 * tubo chiuso con l'uscita dal naso, e quello che resta è una risonanza bassa e una caduta
 * ripida sopra. È esattamente il motivo per cui l'AVVIO dice che canticchiare è più facile
 * da analizzare: meno picchi forti che non sono la fondamentale.
 */
export const TIMBRI = {
  hum: { nome: 'mugolato a bocca chiusa', pendenza: 18, formanti: [[280, 110]] },
  a: { nome: 'vocale «a»', pendenza: 12, formanti: [[730, 90], [1090, 110], [2440, 170]] },
  i: { nome: 'vocale «i»', pendenza: 12, formanti: [[270, 60], [2290, 120], [3010, 180]] },
};

/** Modulo di un risonatore del secondo ordine, normalizzato a 1 in continua. */
function risonanza(f, centro, banda) {
  const num = centro * centro;
  const den = Math.hypot(centro * centro - f * f, f * banda);
  return den > 0 ? num / den : 0;
}

const HZ_TETTO = 6000; // oltre non serve: il rilevatore guarda fino a 1300 Hz e i suoi 4 armonici

/**
 * Le parziali di una voce che canta `hz` con un dato timbro.
 *
 * @param {number} hz fondamentale
 * @param {'hum'|'a'|'i'} vocale
 * @param {{fondamentaleDb?:number}} opzioni `fondamentaleDb` attenua SOLO la prima parziale:
 *   è il taglio dei bassi di un microfono di telefono, la trappola dell'errore d'ottava.
 * @returns {Array<[number, number]>} coppie [frequenza, ampiezza], ampiezza massima 1
 */
export function armonicheVoce(hz, vocale = 'hum', { fondamentaleDb = 0 } = {}) {
  const t = TIMBRI[vocale];
  if (!t) throw new Error(`timbro sconosciuto: ${vocale}`);
  const out = [];
  for (let n = 1; n * hz <= HZ_TETTO; n += 1) {
    const f = n * hz;
    // Sorgente: caduta in dB per ottava. n ottave sopra la fondamentale = log2(n).
    let amp = 10 ** ((-t.pendenza * Math.log2(n)) / 20);
    for (const [centro, banda] of t.formanti) amp *= risonanza(f, centro, banda);
    if (n === 1 && fondamentaleDb) amp *= 10 ** (-Math.abs(fondamentaleDb) / 20);
    out.push([f, amp]);
  }
  const massimo = Math.max(...out.map(([, a]) => a));
  return out.map(([f, a]) => [f, a / massimo]).filter(([, a]) => a > 1e-4);
}

/**
 * Le parziali di uno strumento a corda — il modo ② dell'AVVIO, «canta quello che suoni».
 *
 * `B` è la rigidità della corda: le parziali stanno a n·f·√(1+B·n²), non a n·f. Sul
 * pianoforte nei bassi arriva a 5e-4 e l'ottava parziale finisce 27 centesimi sopra il
 * suo posto. Sulla chitarra e sull'ukulele è quasi zero. È il numero che decide se
 * «canta quello che suoni» funziona su tutta la tastiera o solo al centro.
 */
export function armonicheStrumento(hz, { B = 0, parziali = 14, pendenza = 6 } = {}) {
  const out = [];
  for (let n = 1; n <= parziali; n += 1) {
    const f = n * hz * Math.sqrt(1 + B * n * n);
    if (f > HZ_TETTO) break;
    out.push([f, 10 ** ((-pendenza * Math.log2(n)) / 20)]);
  }
  const massimo = Math.max(...out.map(([, a]) => a));
  return out.map(([f, a]) => [f, a / massimo]);
}

// ── Il banco vero ────────────────────────────────────────────────────────────

/** RMS teorico di una somma di sinusoidi di ampiezze note. */
export function rmsDiParziali(parziali) {
  return Math.sqrt(parziali.reduce((s, [, a]) => s + (a * a) / 2, 0));
}

export const dbfs = (rms) => 20 * Math.log10(Math.max(rms, 1e-9));

/** Rumore bianco uniforme in [−1,1] (RMS = 1/√3), un secondo, da mandare in loop. */
function bufferRumore(ctx) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Rumore LENTO a RMS 1: valori casuali ogni 1/hz secondi, interpolati.
 *
 * Serve a modulare la frequenza in modo casuale ma continuo. Un rumore bianco pieno sulla
 * frequenza non è jitter di voce, è un fischio: la voce sbanda, non trema a 20 kHz.
 */
function bufferLento(ctx, hz) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * 4), sr);
  const d = buf.getChannelData(0);
  const passo = Math.max(1, Math.round(sr / hz));
  let a = Math.random() * 2 - 1;
  let b = Math.random() * 2 - 1;
  for (let i = 0; i < d.length; i += 1) {
    const k = i % passo;
    if (k === 0) { a = b; b = Math.random() * 2 - 1; }
    d[i] = a + (b - a) * (k / passo);
  }
  let s = 0;
  for (let i = 0; i < d.length; i += 1) s += d[i] * d[i];
  const rms = Math.sqrt(s / d.length);
  if (rms > 0) for (let i = 0; i < d.length; i += 1) d[i] /= rms;
  return buf;
}

/**
 * Monta una sorgente sintetica su un AnalyserNode e la restituisce viva.
 *
 * Il livello si chiede in **dBFS voluti** e il guadagno si ricava dall'ampiezza delle
 * parziali, invece di scegliere un numero e sperare: senza questo, una prova sulla soglia
 * del silenzio non misura la soglia, misura il guadagno del banco.
 *
 * @param {AudioContext} ctx
 * @param {Array<[number, number]>} parziali coppie [frequenza, ampiezza]
 * @param {object} opzioni
 * @param {number} opzioni.dbfs livello voluto della sola voce, in dBFS (−55 = mugolato piano)
 * @param {number} opzioni.rumoreDbfs livello del rumore di stanza (ventola), in dBFS
 * @param {number} opzioni.vibratoHz frequenza del vibrato (0 = niente)
 * @param {number} opzioni.vibratoCent ampiezza del vibrato in centesimi (±)
 * @param {number} opzioni.fftSize finestra dell'analizzatore
 */
export function banco(ctx, parziali, {
  dbfs: livelloDb = -20,
  rumoreDbfs = null,
  vibratoHz = 0,
  vibratoCent = 0,
  jitterCent = 0,
  jitterHz = 30,
  soffioDb = null,
  fftSize = 4096,
} = {}) {
  const an = ctx.createAnalyser();
  an.fftSize = fftSize;
  an.smoothingTimeConstant = 0;

  const somma = ctx.createGain();     // punto di somma: voce + rumore
  somma.gain.value = 1;
  somma.connect(an);

  const gVoce = ctx.createGain();
  gVoce.gain.value = (10 ** (livelloDb / 20)) / rmsDiParziali(parziali);
  gVoce.connect(somma);

  const nodi = [];
  let lfo = null;
  if (vibratoHz > 0 && vibratoCent > 0) {
    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = vibratoHz;
    lfo.start();
  }
  // Profondità RELATIVA del vibrato: ±c centesimi valgono un fattore 2^(±c/1200), quindi
  // in Hz la deviazione è proporzionale alla frequenza della parziale. Modulando ogni
  // parziale con la sua deviazione, il suono si sposta tutto insieme — che è quello che
  // fa una voce, invece di stiracchiare lo spettro.
  const profondita = (2 ** (vibratoCent / 1200) - 2 ** (-vibratoCent / 1200)) / 2;

  // Jitter: la micro-instabilità che ha QUALUNQUE voce, anche tenendo una nota ferma.
  // Senza, il banco è una serie armonica perfetta e l'autocorrelazione la aggancia
  // esattamente: si misurano 0,0 centesimi di errore e non si è provato niente. È la
  // trappola del banco gentile, scritta nell'AVVIO e verificata qui — la prima esecuzione
  // di questa prova dava zero su tutti e ventuno i casi.
  let jitterSrc = null;
  if (jitterCent > 0) {
    jitterSrc = ctx.createBufferSource();
    jitterSrc.buffer = bufferLento(ctx, jitterHz);
    jitterSrc.loop = true;
    jitterSrc.start();
  }
  const profJitter = 2 ** (jitterCent / 1200) - 1;

  parziali.forEach(([f, amp]) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const ga = ctx.createGain();
    ga.gain.value = amp;
    o.connect(ga).connect(gVoce);
    o.start();
    nodi.push([o, ga]);
    if (lfo) {
      const gm = ctx.createGain();
      gm.gain.value = f * profondita;
      lfo.connect(gm).connect(o.frequency);
      nodi.push([null, gm]);
    }
    if (jitterSrc) {
      const gj = ctx.createGain();
      gj.gain.value = f * profJitter;
      jitterSrc.connect(gj).connect(o.frequency);
      nodi.push([null, gj]);
    }
  });

  // Soffio: la parte non periodica della voce. Qui è rumore BIANCO, non filtrato in alto
  // come sarebbe un'aspirazione vera: è la versione pessimista: mette disturbo anche dove
  // sta la fondamentale, dove un soffio vero ne mette poco. Se il rilevatore regge questo,
  // regge il respiro di una persona.
  if (soffioDb !== null) {
    const s = ctx.createBufferSource();
    s.buffer = bufferRumore(ctx);
    s.loop = true;
    const gs = ctx.createGain();
    gs.gain.value = rmsDiParziali(parziali) * (10 ** (soffioDb / 20)) * Math.sqrt(3);
    s.connect(gs).connect(gVoce);
    s.start();
    nodi.push([null, gs]);
    nodi.push([s, null]);
  }

  let rumoreSrc = null;
  if (rumoreDbfs !== null) {
    // Rumore bianco uniforme in [−1,1]: RMS = 1/√3. Il guadagno si ricava da lì, così
    // «ventola a −48 dBFS» è davvero −48 e non un aggettivo.
    rumoreSrc = ctx.createBufferSource();
    rumoreSrc.buffer = bufferRumore(ctx);
    rumoreSrc.loop = true;
    const gr = ctx.createGain();
    gr.gain.value = (10 ** (rumoreDbfs / 20)) * Math.sqrt(3);
    rumoreSrc.connect(gr).connect(somma);
    rumoreSrc.start();
    nodi.push([null, gr]);
  }

  return {
    an,
    gVoce,
    /** Spegne e riaccende la voce lasciando vivo il rumore: serve a far tarare il pavimento. */
    silenzia() { gVoce.gain.value = 0; },
    riaccendi(db = livelloDb) { gVoce.gain.value = (10 ** (db / 20)) / rmsDiParziali(parziali); },
    chiudi() {
      nodi.forEach(([o, g]) => { if (o) { o.stop(); o.disconnect(); } if (g) g.disconnect(); });
      if (lfo) { lfo.stop(); lfo.disconnect(); }
      if (jitterSrc) { jitterSrc.stop(); jitterSrc.disconnect(); }
      if (rumoreSrc) rumoreSrc.stop();
      gVoce.disconnect();
      somma.disconnect();
    },
  };
}

/**
 * Attesa misurata sull'orologio dell'audio, non su `setTimeout`.
 *
 * Un browser che tiene la pagina in secondo piano strozza i timer a un secondo e il
 * collaudo passerebbe da dieci secondi a dieci minuti. La guardia sull'orologio di sistema
 * evita il congelamento eterno se il contesto è sospeso e `currentTime` non avanza.
 */
export function attendi(ctx, ms) {
  const fine = ctx.currentTime + ms / 1000;
  const limite = performance.now() + ms * 3 + 400;
  while (ctx.currentTime < fine && performance.now() < limite) { /* attesa attiva */ }
}

/**
 * Contesto audio pronto, oppure null.
 *
 * I browser non fanno partire l'audio senza un gesto: `resume()` su un contesto bloccato
 * non fallisce, resta PENDENTE per sempre. Si corre contro un timer e si prende atto,
 * invece di lasciare la pagina su «Eseguo…».
 */
export async function contestoPronto(t) {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) { t.ok('audio disponibile in questo browser', false, 'Web Audio assente'); return null; }
  const ctx = new Ctor();
  await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
  if (ctx.state !== 'running') {
    t.ok('prove audio eseguite', false,
      'il browser tiene l\'audio sospeso finché non tocchi la pagina: premi «Rifai le prove audio»');
    await ctx.close().catch(() => {});
    return null;
  }
  return ctx;
}
