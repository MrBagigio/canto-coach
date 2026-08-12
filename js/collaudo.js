// Banco di collaudo — prove 0–4 dell'AVVIO.
//
// L'ordine è quello del documento e non è casuale: prima si misura se il motore SEGUE una
// voce, poi si costruiscono le schermate. Se sbaglia l'ottava su una voce grave o non sente
// un mugolato piano, non c'è nessun esercizio che valga la pena scrivere.
//
// Il motore è quello dell'accordatore (`js/pitch.js`, copiato byte per byte da
// ukulele-coach): l'AVVIO dice che per la parte che conta non serve nessuna DSP nuova,
// e queste prove servono a verificarlo o a smentirlo con dei numeri.
//
// Ogni gruppo stampa MISURE oltre ai giudizi. Un numero nascosto dentro una prova verde
// non si legge mai, e quando un giorno il margine si assottiglia non se ne accorge nessuno.

import { Rilevatore, centesimi, nota, hzDaMidi } from './pitch.js';
import {
  TIMBRI, armonicheVoce, armonicheStrumento, banco, attendi, contestoPronto, rmsDiParziali, dbfs,
} from './banco.js';
import { scomponi, retta, calo, PASSO_MASSIMO_MS } from './vibrato.js';
import * as audio from './audio.js';
import * as esercizi from './esercizi.js';
import * as melodie from './melodie.js';
import * as ripasso from './ripasso.js';
import * as percorso from './percorso.js';
import { nome as nomeIt, MIDI_MIN, MIDI_MAX } from './teoria.js';

const gruppi = [];

function gruppo(nome, fn) { gruppi.push({ nome, prove: [], fn }); }

function contestoPer(g) {
  return {
    nome: g.nome,
    asincrono: null,
    ok(titolo, condizione, dettaglio = '') {
      g.prove.push({ titolo, esito: !!condizione, dettaglio: condizione ? '' : dettaglio });
    },
    /** Una MISURA, non un giudizio: passa sempre e stampa il numero. */
    misura(titolo, testo) { g.prove.push({ titolo, esito: true, dettaglio: String(testo), misura: true }); },
    uguale(titolo, avuto, atteso) {
      const e = JSON.stringify(avuto) === JSON.stringify(atteso);
      g.prove.push({ titolo, esito: e, dettaglio: e ? '' : `avuto ${JSON.stringify(avuto)}, atteso ${JSON.stringify(atteso)}` });
    },
  };
}

// ── Attrezzi comuni ──────────────────────────────────────────────────────────

const NOTE = {
  'Sol2': 98.00, 'La2': 110.00, 'Si2': 123.47, 'Do3': 130.81, 'Re3': 146.83,
  'Mi3': 164.81, 'Sol3': 196.00, 'La3': 220.00, 'Do4': 261.63, 'Mi4': 329.63,
  'La4': 440.00, 'Do5': 523.25, 'Mi2': 82.41, 'La1': 55.00, 'Do6': 1046.50,
};

/**
 * Accende il banco, aspetta che la finestra sia piena, legge N volte e restituisce tutto.
 *
 * L'attesa non è scaramanzia: l'analizzatore restituisce una finestra di 4096 campioni
 * (93 ms) e finché non si è riempita di segnale vero contiene ancora il silenzio di prima.
 * Le letture sono distanziate perché altrimenti sono lo stesso identico buffer letto N
 * volte, e una mediana su tre copie dello stesso numero non è una mediana.
 */
function misuraSuBanco(ctx, parziali, opzioni = {}, { letture = 5, attesaMs = 300, passoMs = 30 } = {}) {
  const b = banco(ctx, parziali, opzioni);
  attendi(ctx, attesaMs);
  const r = new Rilevatore(b.an);
  const lette = [];
  let ultima = null;
  for (let i = 0; i < letture; i += 1) {
    const l = r.leggi();
    ultima = l;
    if (l.hz) lette.push(l.hz);
    attendi(ctx, passoMs);
  }
  // Candidato grossolano dell'HPS, preso a parte: serve per attribuire un eventuale errore
  // d'ottava allo stadio giusto. Senza, si sa solo che ha sbagliato, non dove.
  const sp = new Float32Array(b.an.frequencyBinCount);
  b.an.getFloatFrequencyData(sp);
  const grosso = r._hps(sp);
  b.chiudi();
  const ord = [...lette].sort((a, c) => a - c);
  return {
    hz: ord.length ? ord[Math.floor(ord.length / 2)] : null,
    quante: lette.length,
    su: letture,
    grosso,
    rms: ultima ? ultima.rms : 0,
    livello: ultima ? ultima.livello : 0,
    soglia: ultima ? ultima.soglia : 0,
    chiarezza: ultima ? ultima.chiarezza : 0,
  };
}

/** Rilevatore su un analizzatore finto: per le prove che riguardano solo la logica. */
const rilevatoreFinto = () => new Rilevatore({
  context: { sampleRate: 44100 }, fftSize: 4096, frequencyBinCount: 2048,
});

// ── PROVA 0 — il rilevatore segue la tua voce? ───────────────────────────────
//
// «Sopra ~20 centesimi su una nota tenuta non si costruisce niente»: è la prova che tiene
// in piedi tutto il prodotto. Il motore misura ±3 centesimi su una corda; qui si guarda
// cosa gli fa una voce, che è la stessa domanda con un timbro molto più cattivo.

const SOGLIA_PROVA_0 = 20;

/**
 * Una voce vera, non una serie armonica perfetta.
 *
 * La prima esecuzione di questa prova ha dato 0,0 centesimi di errore su tutti e ventuno i
 * casi: tre timbri, sette altezze, zero. Non era un motore straordinario, era un banco
 * bugiardo — una somma di sinusoidi a frequenze esattamente proporzionali È periodica al
 * campione, e l'autocorrelazione la aggancia esatta. È la trappola scritta nell'AVVIO
 * («il banco gentile mente»), vista in diretta.
 *
 * Una voce, anche tenendo ferma una nota, sbanda di qualche centesimo e ha una parte
 * soffiata che periodica non è. Sono questi due numeri a decidere se il rilevatore serve.
 */
const VOCE_VERA = { jitterCent: 8, jitterHz: 30, soffioDb: -18 };

gruppo('Prova 0 — il rilevatore segue la voce (nota tenuta)', (t) => {
  t.asincrono = async () => {
    const ctx = await contestoPronto(t);
    if (!ctx) return;
    try {
      const altezze = ['Sol2', 'Do3', 'La3', 'Do4', 'La4'];
      const errori = [];
      const puliti = [];
      for (const vocale of ['hum', 'a', 'i']) {
        for (const nome of altezze) {
          const hz = NOTE[nome];
          const parziali = armonicheVoce(hz, vocale);

          const pulito = misuraSuBanco(ctx, parziali, { dbfs: -22 });
          puliti.push({ vocale, nome, scarto: pulito.hz ? centesimi(pulito.hz, hz) : null });

          const m = misuraSuBanco(ctx, parziali, { dbfs: -22, ...VOCE_VERA });
          if (!m.hz) {
            t.ok(`${TIMBRI[vocale].nome} su ${nome}: letto`, false,
              `nessuna lettura su ${m.su} (chiarezza ${m.chiarezza.toFixed(2)}, rms ${m.rms.toFixed(4)}, HPS grosso ${m.grosso ? m.grosso.toFixed(0) : '—'} Hz)`);
            continue;
          }
          const scarto = centesimi(m.hz, hz);
          errori.push({ vocale, nome, scarto, hz: m.hz, grosso: m.grosso, quante: m.quante, su: m.su });
          t.ok(`${TIMBRI[vocale].nome} su ${nome}: entro ${SOGLIA_PROVA_0} centesimi`,
            Math.abs(scarto) <= SOGLIA_PROVA_0,
            `${scarto.toFixed(1)} cent — letto ${m.hz.toFixed(2)} Hz invece di ${hz} (HPS grosso ${m.grosso ? m.grosso.toFixed(0) : '—'} Hz, ${m.quante}/${m.su} letture)`);
        }
      }
      if (errori.length) {
        const ass = errori.map((e) => Math.abs(e.scarto));
        const peggiore = errori[ass.indexOf(Math.max(...ass))];
        t.misura('voce con jitter ±8 cent e soffio a −18 dB · errore su nota tenuta',
          `mediano ${[...ass].sort((a, b) => a - b)[Math.floor(ass.length / 2)].toFixed(1)} cent · peggiore ${Math.max(...ass).toFixed(1)} cent (${peggiore.vocale} su ${peggiore.nome})`);
        for (const v of ['hum', 'a', 'i']) {
          const suoi = errori.filter((e) => e.vocale === v);
          if (suoi.length) {
            t.misura(`${TIMBRI[v].nome}: errore per altezza`,
              suoi.map((e) => `${e.nome} ${e.scarto >= 0 ? '+' : ''}${e.scarto.toFixed(1)}${e.quante < e.su ? `(${e.quante}/${e.su})` : ''}`).join(' · '));
          }
        }
      }
      const assP = puliti.filter((p) => p.scarto !== null).map((p) => Math.abs(p.scarto));
      t.misura('lo stesso banco SENZA jitter né soffio (quanto mente il banco gentile)',
        assP.length
          ? `errore peggiore ${Math.max(...assP).toFixed(1)} cent su ${assP.length} casi — ecco perché il numero che conta è quello sopra`
          : 'nessuna lettura');
    } finally { await ctx.close().catch(() => {}); }
  };
});

// ── PROVA 1 — sbaglia l'ottava sulla voce grave? ─────────────────────────────
//
// «Un errore d'ottava è l'app che ti dice che sei stonato di dodici semitoni.»
// La fondamentale è attenuata di 12 dB per simulare il taglio dei bassi di un microfono
// di telefono: su voce maschile a 98 Hz la seconda armonica diventa il picco più forte
// dello spettro, ed è lì che un rilevatore che cerca il massimo si perde.

gruppo('Prova 1 — l\'ottava sulla voce grave, con la fondamentale attenuata', (t) => {
  t.asincrono = async () => {
    const ctx = await contestoPronto(t);
    if (!ctx) return;
    try {
      const casi = ['Sol2', 'La2', 'Si2', 'Do3'];

      // Prima di tutto: la trappola è ARMATA? Se con la fondamentale attenuata resta lei
      // il picco più forte dello spettro, questa prova non sta provando l'errore d'ottava,
      // sta provando un caso facile con un nome minaccioso.
      for (const vocale of ['hum', 'a']) {
        for (const attenua of [0, 12, 18]) {
          const p = armonicheVoce(98, vocale, { fondamentaleDb: attenua });
          const forte = p.reduce((a, b) => (b[1] > a[1] ? b : a));
          const dbH1 = 20 * Math.log10(p[0][1] / forte[1]);
          t.misura(`${TIMBRI[vocale].nome} a 98 Hz, fondamentale −${attenua} dB`,
            `il picco è la ${Math.round(forte[0] / 98)}ª armonica (${forte[0].toFixed(0)} Hz); la fondamentale sta ${dbH1.toFixed(1)} dB sotto di lei${dbH1 < -3 ? ' → trappola armata' : ' → trappola NON armata'}`);
        }
      }

      for (const attenua of [0, 6, 12, 18]) {
        const esiti = [];
        for (const vocale of ['hum', 'a']) {
          for (const nome of casi) {
            const hz = NOTE[nome];
            const parziali = armonicheVoce(hz, vocale, { fondamentaleDb: attenua });
            const m = misuraSuBanco(ctx, parziali, { dbfs: -22 });
            const rapporto = m.hz ? m.hz / hz : null;
            esiti.push({ vocale, nome, hz, letto: m.hz, rapporto, grosso: m.grosso });
            if (!m.hz) {
              t.ok(`−${attenua} dB · ${TIMBRI[vocale].nome} ${nome}: letto`, false,
                `MUTO: nessuna lettura su ${m.su} — chiarezza ${m.chiarezza.toFixed(2)} contro soglia 0,55, HPS grosso ${m.grosso ? m.grosso.toFixed(0) : '—'} Hz invece di ${hz} (rms ${m.rms.toFixed(3)})`);
              continue;
            }
            const scarto = centesimi(m.hz, hz);
            // Il giudizio è «è la nota giusta», non «entro 3 centesimi»: qui si sta
            // cercando un errore da 1200 centesimi, non la precisione.
            t.ok(`−${attenua} dB · ${TIMBRI[vocale].nome} ${nome}: nota giusta`,
              Math.abs(scarto) < 50,
              `${scarto.toFixed(0)} cent = ×${rapporto.toFixed(3)} (letto ${m.hz.toFixed(1)} Hz, HPS grosso ${m.grosso ? m.grosso.toFixed(0) : '—'} Hz)`);
          }
        }
        const sbagliati = esiti.filter((e) => e.rapporto === null || Math.abs(1200 * Math.log2(e.rapporto)) >= 50);
        t.misura(`fondamentale −${attenua} dB: quante note sbagliate`,
          `${sbagliati.length} su ${esiti.length}${sbagliati.length ? ` — ${sbagliati.map((e) => `${e.nome}/${e.vocale}→${e.letto ? `${e.letto.toFixed(0)}Hz` : 'muto'}`).join(', ')}` : ''}`);
      }

      // E il caso completo: voce grave, microfono che taglia i bassi, jitter e soffio
      // addosso. È la condizione in cui l'app verrà davvero usata.
      for (const vocale of ['hum', 'a']) {
        for (const nome of ['Sol2', 'Do3']) {
          const hz = NOTE[nome];
          const m = misuraSuBanco(ctx, armonicheVoce(hz, vocale, { fondamentaleDb: 12 }),
            { dbfs: -22, ...VOCE_VERA });
          t.ok(`voce vera, −12 dB · ${TIMBRI[vocale].nome} ${nome}: nota giusta`,
            m.hz !== null && Math.abs(centesimi(m.hz, hz)) < 50,
            m.hz
              ? `${centesimi(m.hz, hz).toFixed(0)} cent (letto ${m.hz.toFixed(1)} Hz)`
              : `MUTO: chiarezza ${m.chiarezza.toFixed(2)}, HPS grosso ${m.grosso ? m.grosso.toFixed(0) : '—'} Hz`);
        }
      }
    } finally { await ctx.close().catch(() => {}); }
  };
});

// ── Diagnosi — quanti armonici deve sommare l'HPS ────────────────────────────
//
// La prova 1 ha trovato il difetto e ha detto anche dov'è: sulle vocali aperte in voce
// grave, il candidato grossolano esce a ESATTAMENTE il doppio della frequenza vera
// (248 invece di 123,5 · 194 invece di 98 · 258 invece di 131). Poi l'autocorrelazione,
// che cerca solo entro ±35% attorno al candidato, non può più tornare all'ottava giusta:
// si aggrappa a un periodo che non c'è, la chiarezza crolla sotto 0,55 e l'app dice
// «non ti sento» a uno che sta cantando forte.
//
// Il perché è aritmetico. Il punteggio di un candidato somma i suoi primi 4 armonici,
// quindi arriva solo fino a 4·f. Su una «a» a 123 Hz la prima formante sta a 730, cioè
// sulla SESTA armonica: il candidato vero non la vede, il candidato all'ottava sopra sì
// (per lui è la terza). Vince chi guarda più lontano, non chi ha ragione.
//
// Quattro armonici erano tarati su un ukulele, dove la banda parte da 240 Hz e la quarta
// armonica sta già a 960. Sulla voce quel numero è semplicemente troppo corto. Qui non
// lo si sceglie a naso: si spazzola e si guarda dove il vincitore diventa quello giusto
// e ci resta.

const ARMONICI_SCELTI = 12;

function spazzolaArmonici(ctx, parziali, opzioni, hzVero, ks, grigliaCaselle = false) {
  const b = banco(ctx, parziali, opzioni);
  attendi(ctx, 300);
  const r = new Rilevatore(b.an);
  r.grigliaCaselle = grigliaCaselle;
  const sp = new Float32Array(b.an.frequencyBinCount);
  b.an.getFloatFrequencyData(sp);
  const out = ks.map((k) => {
    r.armonici = k;
    const hz = r._hps(sp);
    return { k, hz, rapporto: hz ? hz / hzVero : null };
  });
  b.chiudi();
  return out;
}

/**
 * Il candidato grossolano è «buono» se il vero cade DENTRO la finestra in cui
 * l'autocorrelazione andrà a cercare, cioè ±35% attorno al candidato.
 *
 * Non «entro tot centesimi»: a questo stadio la precisione non serve e pretenderla
 * inventerebbe difetti. Il primo tentativo chiedeva 60 centesimi e bocciava un candidato
 * a 75,4 Hz per un Mi2 di 82,41 — che è semplicemente la casella accanto, e da lì
 * l'autocorrelazione arriva benissimo alla nota. Quello che il candidato NON deve fare è
 * uscire dalla finestra: se sbaglia l'ottava, lo stadio fine non può più tornare indietro
 * ed è esattamente il difetto che stiamo cercando.
 */
const dentroLaFinestra = (x) => x.rapporto !== null && x.rapporto > 1 / 1.35 && x.rapporto < 1.35;

gruppo('Diagnosi — quanti armonici deve sommare l\'HPS', (t) => {
  t.asincrono = async () => {
    const ctx = await contestoPronto(t);
    if (!ctx) return;
    try {
      const ks = [4, 6, 8, 10, 12, 14, 16];
      const casi = [
        ['«a» Si2, il caso che era muto', armonicheVoce(NOTE['Si2'], 'a'), NOTE['Si2']],
        ['«a» Sol2 con la fondamentale a −18 dB', armonicheVoce(NOTE['Sol2'], 'a', { fondamentaleDb: 18 }), NOTE['Sol2']],
        ['«a» Do3 con la fondamentale a −18 dB', armonicheVoce(NOTE['Do3'], 'a', { fondamentaleDb: 18 }), NOTE['Do3']],
        ['«i» Do3', armonicheVoce(NOTE['Do3'], 'i'), NOTE['Do3']],
        ['mugolato Sol2 con la fondamentale a −18 dB', armonicheVoce(NOTE['Sol2'], 'hum', { fondamentaleDb: 18 }), NOTE['Sol2']],
        ['«a» La4 (voce acuta)', armonicheVoce(NOTE['La4'], 'a'), NOTE['La4']],
        // I due casi da NON rompere: sono la memoria dell'accordatore. Il peso doppio sulla
        // fondamentale nacque proprio perché su un suono quasi puro i candidati f, f/2 e
        // f/3 pareggiavano e vinceva il più basso — Do4 letto 87 Hz.
        ['Do4 PURO (l\'errore f/3 dell\'ukulele)', [[NOTE['Do4'], 1]], NOTE['Do4']],
        ['La4 PURO', [[NOTE['La4'], 1]], NOTE['La4']],
        ['corda di ukulele (Do4 pizzicato)', armonicheStrumento(NOTE['Do4'], { B: 1e-5, parziali: 4, pendenza: 6 }), NOTE['Do4']],
        ['corda grave di chitarra (Mi2)', armonicheStrumento(NOTE['Mi2'], { B: 2e-5, parziali: 14, pendenza: 5 }), NOTE['Mi2']],
      ];
      const tabella = [];
      for (const [nome, parziali, hzVero] of casi) {
        const righe = spazzolaArmonici(ctx, parziali, { dbfs: -22 }, hzVero, ks);
        tabella.push({ nome, righe });
        t.misura(`${nome} — candidato / vero, al variare degli armonici sommati`,
          righe.map((x) => `K${x.k}:${x.rapporto ? `×${x.rapporto.toFixed(2)}` : '—'}`).join(' '));
      }
      // La scelta: il K più piccolo che azzecca TUTTI i casi, con margine di due passi.
      const perK = ks.map((k) => ({
        k,
        sbagliati: tabella.filter((c) => !dentroLaFinestra(c.righe.find((x) => x.k === k))).map((c) => c.nome),
      }));
      t.misura('quanti casi sbaglia, per ogni K',
        perK.map((p) => `K${p.k}: ${p.sbagliati.length}`).join(' · '));
      const primoPieno = perK.find((p) => p.sbagliati.length === 0);
      t.misura('il più piccolo K che li azzecca tutti',
        primoPieno ? `K=${primoPieno.k} (scelto ${ARMONICI_SCELTI})` : 'nessuno: il difetto non è il numero di armonici');
      t.ok(`con K=${ARMONICI_SCELTI} nessun caso sbaglia l'ottava`,
        perK.find((p) => p.k === ARMONICI_SCELTI) && perK.find((p) => p.k === ARMONICI_SCELTI).sbagliati.length === 0,
        `sbagliano ancora: ${(perK.find((p) => p.k === ARMONICI_SCELTI) || { sbagliati: [] }).sbagliati.join(', ')}`);
      // RED per costruzione: col numero di prima il difetto DEVE ricomparire, altrimenti
      // questa modifica è inerte e la si sta tenendo per fede.
      const conQuattro = perK.find((p) => p.k === 4);
      t.ok('con K=4 (il valore dell\'ukulele) il difetto si rivede',
        conQuattro && conQuattro.sbagliati.length > 0,
        'nessun caso sbaglia nemmeno con 4 armonici: allora il difetto non era questo');

      // L'altra metà della correzione: la griglia dei candidati. Con il passo grosso —
      // cioè cercando SOLO sulle caselle della FFT, che è quello che faceva prima — il
      // caso «a» su Si2 deve tornare a sbagliare l'ottava a qualunque K, perché 123,47 Hz
      // cade fra due caselle e il pettine non ci si allinea. Se non torna a sbagliare,
      // la griglia logaritmica non serve e va tolta.
      const caselle = 1200 * Math.log2(1 + (44100 / 4096) / NOTE['Si2']); // una casella a quell'altezza
      const grosso = spazzolaArmonici(ctx, armonicheVoce(NOTE['Si2'], 'a'), { dbfs: -22 }, NOTE['Si2'], ks, true);
      t.misura(`«a» Si2 cercando solo sulle caselle della FFT (a quell'altezza una casella vale ${caselle.toFixed(0)} centesimi)`,
        grosso.map((x) => `K${x.k}:${x.rapporto ? `×${x.rapporto.toFixed(2)}` : '—'}`).join(' '));
      t.ok('con la griglia grossa il difetto dell\'ottava si rivede',
        grosso.some((x) => !dentroLaFinestra(x)),
        'nemmeno cercando sulle sole caselle sbaglia: allora la griglia fine non serve');

      const fine = spazzolaArmonici(ctx, armonicheVoce(NOTE['Si2'], 'a'), { dbfs: -22 }, NOTE['Si2'], [ARMONICI_SCELTI], false);
      t.ok('e con la griglia fine sparisce', dentroLaFinestra(fine[0]),
        `×${fine[0].rapporto ? fine[0].rapporto.toFixed(2) : '—'}`);
    } finally { await ctx.close().catch(() => {}); }
  };
});

// ── Diagnosi — dove mettere il pavimento della soglia ────────────────────────
//
// Il pavimento assoluto di pitch.js vale 0,006 di RMS, cioè −44,4 dBFS, e nessuna stanza
// lo abbassa: la parte adattiva può solo ALZARE la soglia. Quel numero è nato su una corda
// pizzicata, che è forte; un mugolato a bocca chiusa sta parecchi dB più giù, ed è il modo
// in cui questa app viene usata di più (sul divano, in macchina, senza svegliare nessuno).
//
// Qui non si sposta un numero perché «sembra basso». Si misurano le DUE POPOLAZIONI che la
// soglia deve separare — un mugolato piano, e una stanza senza nessuno che canta — e si
// guarda se esiste un valore che le separa davvero. Se non esiste, il difetto non è il
// numero: è che non c'è abbastanza informazione, e allora si dichiara il limite.
//
// La misura si fa una volta sola, a SARACINESCA APERTA (soglia praticamente zero), e poi
// le soglie candidate si valutano con l'aritmetica su quei numeri. Così spazzolare venti
// combinazioni costa quanto misurarne una.

const RMS_MINIMO_SCELTO = 0.0008;
const SOPRA_SCELTO = 2.0;
const RMS_MINIMO_UKULELE = 0.006;
const SOPRA_UKULELE = 3.2;

const STANZE = [
  ['cameretta di notte', -65],
  ['stanza normale', -55],
  ['con una ventola', -48],
  ['stanza rumorosa', -40],
];

gruppo('Diagnosi — dove mettere il pavimento della soglia', (t) => {
  t.asincrono = async () => {
    const ctx = await contestoPronto(t);
    if (!ctx) return;
    try {
      const hz = NOTE['Do3'];
      const parziali = armonicheVoce(hz, 'hum');
      const livelli = [-60, -55, -50, -45, -42, -40, -37, -34, -30];
      const aperto = (r) => { r.rmsMinimo = 1e-9; r.sopraIlRumore = 0; };

      const dati = [];
      for (const [stanza, rumoreDbfs] of STANZE) {
        // ① la stanza da sola: quanto fa di RMS, e — la domanda che conta — riesce a
        //    produrre una lettura di altezza credibile? Se il rumore non passa mai il
        //    cancello della chiarezza, il cancello sull'RMS è una ridondanza e può stare
        //    molto più in basso.
        const vuota = banco(ctx, parziali, { dbfs: -140, rumoreDbfs, ...VOCE_VERA });
        attendi(ctx, 300);
        const rv = new Rilevatore(vuota.an);
        aperto(rv);
        let rumoreRms = 0;
        let inventate = 0;
        let chiarezzaMax = 0;
        for (let i = 0; i < 10; i += 1) {
          const l = rv.leggi();
          rumoreRms = Math.max(rumoreRms, l.rms);
          chiarezzaMax = Math.max(chiarezzaMax, l.chiarezza);
          if (l.hz) inventate += 1;
          attendi(ctx, 25);
        }
        vuota.chiudi();

        // ② la voce, livello per livello, sempre a saracinesca aperta.
        const punti = [];
        for (const db of livelli) {
          const b = banco(ctx, parziali, { dbfs: db, rumoreDbfs, ...VOCE_VERA });
          attendi(ctx, 300);
          const r = new Rilevatore(b.an);
          aperto(r);
          let visti = 0;
          let rms = 0;
          let chiarezza = 0;
          for (let i = 0; i < 6; i += 1) {
            const l = r.leggi();
            rms = Math.max(rms, l.rms);
            chiarezza = Math.max(chiarezza, l.chiarezza);
            if (l.hz && Math.abs(centesimi(l.hz, hz)) < 50) visti += 1;
            attendi(ctx, 25);
          }
          b.chiudi();
          punti.push({ db, rms, chiarezza, visti });
        }
        dati.push({ stanza, rumoreDbfs, rumoreRms, inventate, chiarezzaMax, punti });
        t.misura(`${stanza} (${rumoreDbfs} dBFS) · la stanza da sola`,
          `rms ${rumoreRms.toFixed(4)} · chiarezza massima ${chiarezzaMax.toFixed(2)} contro il cancello 0,55 · note inventate ${inventate}/10`);
        t.misura(`${stanza} · il mugolato, senza nessuna soglia sull'RMS`,
          punti.map((p) => `${p.db}dB:${p.visti}/6`).join(' '));
      }

      // Il cancello della chiarezza da solo: se il rumore non lo passa MAI, allora la
      // soglia sull'RMS non sta difendendo da niente, sta solo rendendo sorda l'app.
      t.ok('il rumore di stanza, da solo, non produce mai una lettura di altezza',
        dati.every((d) => d.inventate === 0),
        dati.filter((d) => d.inventate).map((d) => `${d.stanza}: ${d.inventate}/10`).join(', '));

      // ③ la spazzolata. Per ogni combinazione si guarda il livello più basso a cui la
      //    voce viene sentita, in ogni stanza.
      const combinazioni = [];
      for (const rmsMin of [0.006, 0.003, 0.0015, 0.0008, 0.0004]) {
        for (const sopra of [3.2, 2.5, 2.0]) {
          const righe = dati.map((d) => {
            const soglia = Math.min(0.05, Math.max(rmsMin, d.rumoreRms * sopra));
            const primo = d.punti.find((p) => p.rms >= soglia && p.visti >= 3);
            const falsi = d.rumoreRms >= soglia ? d.inventate : 0;
            return { stanza: d.stanza, minimo: primo ? primo.db : null, falsi };
          });
          combinazioni.push({ rmsMin, sopra, righe });
        }
      }
      for (const c of combinazioni) {
        t.misura(`pavimento ${c.rmsMin} (${dbfs(c.rmsMin).toFixed(0)} dBFS) · fattore ${c.sopra}`,
          c.righe.map((r) => `${r.stanza}: ${r.minimo !== null ? `${r.minimo} dBFS` : 'MAI'}`).join(' · '));
      }

      // La scelta: il pavimento più basso che non fa inventare niente. Il fattore sopra il
      // rumore invece NON si può abbassare a piacere — vedi la misura qui sotto, è fisica.
      const scelta = combinazioni.find((c) => c.rmsMin === RMS_MINIMO_SCELTO && c.sopra === SOPRA_SCELTO);
      const vecchia = combinazioni.find((c) => c.rmsMin === RMS_MINIMO_UKULELE && c.sopra === SOPRA_UKULELE);
      t.ok('la combinazione scelta non fa inventare note in nessuna stanza',
        scelta && scelta.righe.every((r) => r.falsi === 0),
        scelta ? scelta.righe.filter((r) => r.falsi).map((r) => r.stanza).join(', ') : 'combinazione non spazzolata');
      // Il guadagno, stanza per stanza, contro i numeri ereditati dall'accordatore. Se un
      // giorno diventa zero, questa modifica non serve più a niente e va tolta.
      t.ok('la nuova soglia sente più piano della vecchia in OGNI stanza',
        scelta && vecchia && scelta.righe.every((r, i) => r.minimo !== null
          && vecchia.righe[i].minimo !== null && r.minimo <= vecchia.righe[i].minimo),
        'in qualche stanza non guadagna niente');
      t.misura('guadagno contro i numeri dell\'accordatore (0,006 · 3,2)',
        scelta && vecchia
          ? scelta.righe.map((r, i) => `${r.stanza}: ${vecchia.righe[i].minimo} → ${r.minimo} dBFS`).join(' · ')
          : '—');
      t.misura('quanto deve stare la voce sopra il rumore della stanza, per forza',
        `con fattore ${SOPRA_SCELTO} servono ${(20 * Math.log10(Math.sqrt(SOPRA_SCELTO ** 2 - 1))).toFixed(1)} dB di voce sopra il rumore: sotto quello, la somma voce+rumore non arriva alla soglia nemmeno in teoria. È fisica del microfono, non una scelta.`);
    } finally { await ctx.close().catch(() => {}); }
  };
});

// ── PROVA 2 — un mugolato piano supera la soglia? ────────────────────────────
//
// «Se un mugolato tranquillo viene dichiarato silenzio, l'app è sorda proprio nel modo in
// cui vuoi usarla.» La soglia adattiva di pitch.js sta un fattore 3,2 sopra il rumore
// misurato, ma ha anche un MINIMO ASSOLUTO fisso: la parte adattiva può solo alzarla.
// Questa prova serve a stabilire dove sta davvero il confine, in dBFS.

gruppo('Prova 2 — il livello: dove comincia a sentire', (t) => {
  t.asincrono = async () => {
    const ctx = await contestoPronto(t);
    if (!ctx) return;
    try {
      const hz = NOTE['Do3'];
      const parziali = armonicheVoce(hz, 'hum');
      const livelli = [-60, -55, -50, -45, -42, -40, -35, -30];

      for (const [stanza, rumoreDbfs] of [['stanza silenziosa', null], ['con una ventola (−48 dBFS)', -48]]) {
        const sentiti = [];
        for (const db of livelli) {
          const b = banco(ctx, parziali, { dbfs: db, rumoreDbfs });
          const r = new Rilevatore(b.an);
          // Prima si lascia tarare il pavimento sul rumore della stanza, senza voce: è
          // esattamente quello che succede all'app nei secondi prima che tu canti.
          b.silenzia();
          attendi(ctx, 300);
          for (let i = 0; i < 120; i += 1) r.leggi();
          const sogliaStanza = r.soglia();
          b.riaccendi(db);
          attendi(ctx, 300);
          let visto = 0;
          let ultima = null;
          for (let i = 0; i < 6; i += 1) { const l = r.leggi(); ultima = l; if (l.hz) visto += 1; attendi(ctx, 25); }
          b.chiudi();
          sentiti.push({ db, visto, rms: ultima.rms, soglia: sogliaStanza, livello: ultima.livello });
        }
        const primo = sentiti.find((s) => s.visto >= 3);
        t.misura(`${stanza}: da che livello sente il mugolato`,
          primo
            ? `da ${primo.db} dBFS in su (soglia della stanza ${dbfs(primo.soglia).toFixed(1)} dBFS)`
            : `MAI, fino a ${livelli[livelli.length - 1]} dBFS`);
        t.misura(`${stanza}: dettaglio`,
          sentiti.map((s) => `${s.db}dB→${s.visto}/6`).join(' · '));
        // Un mugolato tranquillo di una persona che studia sul divano sta attorno ai
        // −45/−40 dBFS su un microfono di telefono. Se lì è muto, l'app è sorda dove serve.
        const a40 = sentiti.find((s) => s.db === -40);
        t.ok(`${stanza}: un mugolato a −40 dBFS viene sentito`, a40 && a40.visto >= 3,
          a40 ? `${a40.visto}/6 letture (rms ${a40.rms.toFixed(4)} contro soglia ${a40.soglia.toFixed(4)})` : 'non provato');
      }

      // Il minimo assoluto è un numero fisso dentro pitch.js: nessuna stanza, per quanto
      // silenziosa, lo abbassa. È il tetto vero della sensibilità dell'app.
      const muto = rilevatoreFinto();
      for (let i = 0; i < 300; i += 1) muto._aggiornaPavimento(0.000001);
      t.misura('minimo assoluto della soglia (nessuna stanza lo abbassa)',
        `${muto.soglia().toFixed(4)} di RMS = ${dbfs(muto.soglia()).toFixed(1)} dBFS`);

      // E deve TACERE sul solo rumore: un coach che inventa una nota è peggio di niente.
      const soloRumore = banco(ctx, armonicheVoce(300, 'hum'), { dbfs: -120, rumoreDbfs: -26 });
      attendi(ctx, 300);
      const r2 = new Rilevatore(soloRumore.an);
      let parlato = 0;
      for (let i = 0; i < 8; i += 1) { if (r2.leggi().hz) parlato += 1; attendi(ctx, 25); }
      soloRumore.chiudi();
      t.ok('sul solo rumore di stanza non dichiara nessuna nota', parlato === 0,
        `ha inventato una nota in ${parlato} letture su 8`);
    } finally { await ctx.close().catch(() => {}); }
  };
});

// ── PROVA 3 — vibrato: si misura o si appiattisce? ───────────────────────────

gruppo('Prova 3a — lo scompositore, su serie di cui conosco la verità', (t) => {
  // Prima senza audio: se lo scompositore sbaglia su una sinusoide costruita a mano, non
  // ha senso interrogarlo su una voce. E qui la verità è nota a meno di zero.
  const dt = 25;
  const serie = (n, { media = 0, deriva = 0, hz = 0, amp = 0, rumore = 0, seme = 1 }) => {
    let s = seme;
    const caso = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; };
    return Array.from({ length: n }, (_, i) => {
      const tt = (i * dt) / 1000;
      return media + deriva * tt + amp * Math.sin(2 * Math.PI * hz * tt) + rumore * caso();
    });
  };

  const v = scomponi(serie(120, { media: -8, deriva: -4, hz: 5.5, amp: 50 }), dt);
  t.ok('trova la frequenza del vibrato (5,5 Hz)', Math.abs(v.hz - 5.5) < 0.3, `${v.hz && v.hz.toFixed(2)} Hz`);
  t.ok('trova l\'ampiezza del vibrato (±50 cent)', Math.abs(v.ampiezza - 50) < 6, `${v.ampiezza.toFixed(1)} cent`);
  // `media` è la media della serie, e una serie che CALA ha una media più bassa del punto
  // di partenza: su 3 s a −4 cent/s valgono −6 centesimi di scarto, che non sono
  // stonatura ma calo. Il primo tentativo di questa prova pretendeva −8 e falliva: la
  // sbagliata era la prova, non il codice. Sono due numeri diversi e servono entrambi —
  // `intercetta` è «come sei partito», `media` è «com'è andata in media».
  t.ok('l\'intonazione di partenza è quella vera (−8 cent)', Math.abs(v.intercetta - (-8)) < 2,
    `${v.intercetta.toFixed(1)} cent`);
  t.ok('la media della serie tiene conto del calo (−8 meno metà di 4×3 s)',
    Math.abs(v.media - (-13.95)) < 2, `${v.media.toFixed(1)} cent`);
  t.ok('trova il calo (−4 cent/s)', Math.abs(v.deriva - (-4)) < 0.6, `${v.deriva.toFixed(2)} cent/s`);
  t.misura('serie nota: 5,5 Hz · ±50 cent · parte da −8 · calo −4 cent/s',
    `letti ${v.hz.toFixed(2)} Hz · ±${v.ampiezza.toFixed(1)} cent · parte da ${v.intercetta.toFixed(1)} · media ${v.media.toFixed(1)} · calo ${v.deriva.toFixed(2)} cent/s · confidenza ${v.confidenza.toFixed(2)}`);

  for (const hz of [4.0, 5.0, 6.0, 7.0]) {
    const x = scomponi(serie(120, { hz, amp: 40 }), dt);
    t.ok(`vibrato a ${hz} Hz riconosciuto`, x.hz && Math.abs(x.hz - hz) < 0.3, `${x.hz ? x.hz.toFixed(2) : 'nessuno'}`);
  }

  // Una voce ferma NON deve ricevere un vibrato inventato, e una che balla a caso non
  // deve essere lodata per il controllo: sono i due verdetti opposti dell'esercizio.
  const ferma = scomponi(serie(120, { media: 3, rumore: 4 }), dt);
  t.ok('una voce ferma non riceve un vibrato inventato', ferma.hz === null,
    `ha dichiarato ${ferma.hz && ferma.hz.toFixed(2)} Hz con confidenza ${ferma.confidenza.toFixed(2)}`);
  t.misura('voce ferma con ±2 cent di tremolio', `fermezza ${ferma.fermezza.toFixed(1)} cent · confidenza ${ferma.confidenza.toFixed(2)}`);

  const instabile = scomponi(serie(120, { rumore: 90, seme: 7 }), dt);
  t.ok('un\'oscillazione non periodica è instabilità, non vibrato', instabile.hz === null,
    `ha dichiarato ${instabile.hz && instabile.hz.toFixed(2)} Hz (confidenza ${instabile.confidenza.toFixed(2)})`);

  // Una nota troppo corta si DICHIARA non misurabile invece di dare un numero a caso.
  const corta = scomponi(serie(10, { hz: 5.5, amp: 50 }), dt);
  t.ok('mezzo secondo di nota non basta, e lo dice', !corta.misurabile && corta.hz === null, corta.motivo);

  // Il calo, dai 0,5 s in poi come vuole l'AVVIO. Il valore vero è pendenza × durata:
  // −6 cent/s per i 4,475 s che restano dopo aver tolto l'attacco = −26,9 centesimi.
  const c = calo(serie(200, { media: 0, deriva: -6, hz: 5.5, amp: 40 }), dt);
  const vero = -6 * c.durata;
  // La tolleranza non si sceglie: si MISURA. Un vibrato che non finisce con un numero
  // intero di periodi inclina un po' la retta anche su una nota che non cala affatto, e
  // quello è il rumore di fondo della misura. Il primo tentativo pretendeva ±2 e falliva
  // per 0,15: una soglia scelta a occhio che bocciava un codice giusto.
  const senzaCalo = calo(serie(200, { media: 0, deriva: 0, hz: 5.5, amp: 40 }), dt);
  const incertezza = Math.abs(senzaCalo.calo);
  t.misura('quanto inclina la retta il solo vibrato, su una nota che NON cala',
    `${incertezza.toFixed(1)} cent su ${senzaCalo.durata.toFixed(2)} s: è l'incertezza della misura del calo`);
  t.ok(`il calo torna con la pendenza vera (−6 cent/s × ${c.durata.toFixed(2)} s = ${vero.toFixed(1)})`,
    c && Math.abs(c.calo - vero) <= incertezza + 0.5, c ? `${c.calo.toFixed(1)} cent` : 'non calcolabile');
  t.misura('calo su nota tenuta di 5 s con deriva −6 cent/s e vibrato ±40',
    c ? `dalla retta ${c.calo.toFixed(1)} cent su ${c.durata.toFixed(2)} s · dalle due finestre ${c.caloFinestre.toFixed(1)} cent` : '—');
  // Il motivo per cui il numero buono viene dalla retta e non dalle due finestre. Se un
  // giorno questa differenza sparisce, la scelta non è più giustificata da niente.
  t.ok('le due finestre sbagliano più della retta quando c\'è il vibrato',
    c && Math.abs(c.caloFinestre - vero) > Math.abs(c.calo - vero),
    c ? `finestre ${c.caloFinestre.toFixed(1)}, retta ${c.calo.toFixed(1)}, vero ${vero.toFixed(1)}` : '');
  t.ok('la retta su una serie piatta ha pendenza zero', Math.abs(retta([5, 5, 5, 5], 25).pendenza) < 1e-9);
});

gruppo('Prova 3b — la mediana di pitch.js appiattisce il vibrato? NO', (t) => {
  // Il sospetto ③ dell'AVVIO era che `_stabilizza` — mediana su 5 letture, cioè 125 ms a
  // 25 ms di cadenza contro i 182 di un periodo a 5,5 Hz — spianasse il vibrato.
  //
  // È SBAGLIATO, e vale la pena aver misurato invece di aver dedotto: quella funzione non
  // restituisce la mediana, restituisce la lettura com'è. La mediana la usa solo come
  // metro per buttare via il singolo campione impazzito, e solo oltre il 12% di scarto —
  // che in centesimi fa 196, cioè quasi due semitoni. Un vibrato cantato (±20…100) le
  // passa attraverso intatto, e infatti qui esce al 100%.
  //
  // Quello che il vibrato lo attenua davvero è un'altra cosa: la FINESTRA di analisi.
  // Ogni lettura è una media su ~60 ms di segnale, e 60 ms sono un terzo di un periodo a
  // 5,5 Hz. Il numero sta nella prova 3c, misurato sull'audio: ±44,9 su ±50, cioè il 90%.
  const dt = 25;
  const passaggio = (ampCent, hzV) => {
    const r = rilevatoreFinto();
    const base = 220;
    const dentro = [];
    const fuori = [];
    for (let i = 0; i < 200; i += 1) {
      const tt = (i * dt) / 1000;
      const cent = ampCent * Math.sin(2 * Math.PI * hzV * tt);
      dentro.push(cent);
      fuori.push(centesimi(r._stabilizza(base * 2 ** (cent / 1200)), base));
    }
    const amp = (serie) => scomponi(serie.slice(20), dt).ampiezza;
    return { prima: amp(dentro), dopo: amp(fuori) };
  };

  for (const hzV of [4.0, 5.5, 7.0]) {
    const { prima, dopo } = passaggio(50, hzV);
    t.ok(`vibrato a ${hzV} Hz: _stabilizza lo lascia passare intero`, dopo / prima > 0.97,
      `±${dopo.toFixed(1)} su ±${prima.toFixed(1)} = ${((dopo / prima) * 100).toFixed(0)}%`);
  }
  t.misura('vibrato cantato: quanto ne resta dopo _stabilizza',
    `il 100%: la mediana interviene solo oltre il 12% di scarto, cioè ±196 centesimi`);

  // RED per costruzione: se la soglia del 12% non esistesse davvero, questa prova non
  // fallirebbe mai e la riga qui sopra sarebbe una rassicurazione senza prova.
  const enorme = passaggio(400, 5.5);
  t.ok('oltre i ±196 centesimi invece interviene, ed è giusto così (quello è un salto, non un vibrato)',
    enorme.dopo / enorme.prima < 0.9,
    `±${enorme.dopo.toFixed(0)} su ±${enorme.prima.toFixed(0)} = ${((enorme.dopo / enorme.prima) * 100).toFixed(0)}%`);
});

gruppo('Prova 3c — vibrato vero, dal banco audio', (t) => {
  t.asincrono = async () => {
    const ctx = await contestoPronto(t);
    if (!ctx) return;
    try {
      const casi = [
        ['La3 · 5,5 Hz · ±50 cent', 'La3', 'hum', 5.5, 50],
        ['La3 · 5,5 Hz · ±50 cent, vocale «a»', 'La3', 'a', 5.5, 50],
        ['Do4 · 6,5 Hz · ±80 cent', 'Do4', 'a', 6.5, 80],
        ['La3 · senza vibrato', 'La3', 'hum', 0, 0],
      ];
      for (const [nome, nomeNota, vocale, vHz, vCent] of casi) {
        const hz = NOTE[nomeNota];
        const b = banco(ctx, armonicheVoce(hz, vocale), {
          dbfs: -22, vibratoHz: vHz, vibratoCent: vCent,
        });
        attendi(ctx, 300);
        const r = new Rilevatore(b.an);
        const cent = [];
        const istanti = [];
        for (let i = 0; i < 100; i += 1) {
          const l = r.leggi();
          istanti.push(ctx.currentTime);
          cent.push(l.hz ? centesimi(l.hz, hz) : null);
          attendi(ctx, 25);
        }
        b.chiudi();
        const buone = cent.filter((x) => x !== null);
        if (buone.length < 40) {
          t.ok(`${nome}: abbastanza letture`, false, `${buone.length} su ${cent.length}`);
          continue;
        }
        // Il passo vero fra due letture si MISURA sull'orologio audio: `attendi(25)` più il
        // tempo di calcolo non fa 25 ms, e una frequenza letta con il passo sbagliato è
        // sbagliata in proporzione.
        const dt = ((istanti[istanti.length - 1] - istanti[0]) / (istanti.length - 1)) * 1000;
        // I buchi si tappano con l'ultimo valore buono: sono pochi e la serie deve restare
        // a passo costante perché l'autocorrelazione abbia senso.
        let ultimo = buone[0];
        const serie = cent.map((x) => { if (x !== null) ultimo = x; return ultimo; }).slice(10);
        const v = scomponi(serie, dt);
        t.misura(`${nome}`,
          `passo ${dt.toFixed(1)} ms · media ${v.media.toFixed(1)} cent · vibrato ${v.hz ? `${v.hz.toFixed(2)} Hz ±${v.ampiezza.toFixed(1)} cent` : 'nessuno'} · fermezza ${v.fermezza.toFixed(1)} · confidenza ${v.confidenza.toFixed(2)} · ${buone.length}/${cent.length} letture${vCent ? ` · ne arriva il ${((v.ampiezza / vCent) * 100).toFixed(0)}% (il resto lo mangia la finestra di analisi, non la mediana)` : ''}`);
        if (vHz > 0) {
          t.ok(`${nome}: l'intonazione MEDIA resta giusta`, Math.abs(v.media) <= 15, `${v.media.toFixed(1)} cent`);
          t.ok(`${nome}: la frequenza del vibrato è riconosciuta`,
            v.hz !== null && Math.abs(v.hz - vHz) < 0.6, v.hz ? `${v.hz.toFixed(2)} Hz invece di ${vHz}` : 'nessun vibrato riconosciuto');
          t.ok(`${nome}: l'ampiezza non è appiattita sotto la metà`,
            v.ampiezza > vCent / 2, `±${v.ampiezza.toFixed(1)} cent invece di ±${vCent}`);
        } else {
          t.ok(`${nome}: su una nota ferma non inventa un vibrato`, v.hz === null,
            `ha dichiarato ${v.hz ? v.hz.toFixed(2) : ''} Hz ±${v.ampiezza.toFixed(1)} cent`);
        }
      }
    } finally { await ctx.close().catch(() => {}); }
  };
});

// ── PROVA 4 — riconosce una nota di piano? ───────────────────────────────────
//
// Il modo ② dell'AVVIO: «canta quello che hai appena suonato». All'app basta riconoscere
// UNA nota, una sorgente alla volta — il caso facile. Ma le corde del pianoforte sono
// rigide: le parziali stanno a n·f·√(1+B·n²) e nei bassi l'ottava parziale cade 27
// centesimi sopra il suo posto. Se sbaglia sulle note gravi, «canta quello che suoni»
// funziona solo al centro della tastiera, e va DETTO invece che scoperto.

gruppo('Prova 4 — la nota che suoni: piano, chitarra, ukulele', (t) => {
  t.asincrono = async () => {
    const ctx = await contestoPronto(t);
    if (!ctx) return;
    try {
      const casi = [
        ['piano · La1 (sotto la banda dichiarata)', NOTE['La1'], { B: 8e-4, parziali: 16, pendenza: 5 }, false],
        ['piano · Mi2', NOTE['Mi2'], { B: 5e-4, parziali: 16, pendenza: 5 }, true],
        ['piano · Sol2', NOTE['Sol2'], { B: 5e-4, parziali: 16, pendenza: 5 }, true],
        ['piano · Do3', NOTE['Do3'], { B: 3e-4, parziali: 14, pendenza: 5 }, true],
        ['piano · Do4', NOTE['Do4'], { B: 1.5e-4, parziali: 12, pendenza: 6 }, true],
        ['piano · La4', NOTE['La4'], { B: 2e-4, parziali: 10, pendenza: 6 }, true],
        ['piano · Do6', NOTE['Do6'], { B: 1e-3, parziali: 5, pendenza: 7 }, true],
        ['chitarra · Mi2', NOTE['Mi2'], { B: 2e-5, parziali: 14, pendenza: 5 }, true],
        ['chitarra · Sol3', NOTE['Sol3'], { B: 2e-5, parziali: 12, pendenza: 5 }, true],
        ['ukulele · Do4', NOTE['Do4'], { B: 1e-5, parziali: 10, pendenza: 6 }, true],
      ];
      const dentro = [];
      for (const [nome, hz, forma, atteso] of casi) {
        const m = misuraSuBanco(ctx, armonicheStrumento(hz, forma), { dbfs: -20 });
        if (!m.hz) {
          t.ok(`${nome}: riconosciuta`, !atteso,
            atteso ? `nessuna lettura su ${m.su} (chiarezza ${m.chiarezza.toFixed(2)})` : '');
          if (!atteso) t.misura(`${nome}`, 'muta, come previsto: sotto i 70 Hz il rilevatore non guarda');
          continue;
        }
        const scarto = centesimi(m.hz, hz);
        const n = nota(m.hz);
        dentro.push({ nome, scarto });
        // Il criterio è «la NOTA è quella», non «entro tot centesimi», e la differenza è
        // una decisione di prodotto: in modo ② quello che si passa al cantante è il
        // semitono temperato più vicino, non la frequenza letta. Con un bersaglio preso
        // alla lettera, i +24 centesimi che il piano si porta dietro nei bassi
        // diventerebbero un bersaglio calante di un quarto di semitono.
        // La prima stesura di questa prova chiedeva «entro 25» e passava con 24,2: una
        // soglia che regge per 0,8 centesimi non è un margine, è una coincidenza.
        t.ok(`${nome}: riconosce la nota giusta`, Math.abs(scarto) < 50,
          `${scarto.toFixed(1)} cent — letto ${m.hz.toFixed(2)} Hz (${n.nome}${n.ottava}) invece di ${hz}`);
      }
      if (dentro.length) {
        t.misura('errore per nota', dentro.map((d) => `${d.nome.replace(' · ', ' ')} ${d.scarto >= 0 ? '+' : ''}${d.scarto.toFixed(1)}`).join(' · '));
        const gravi = dentro.filter((d) => d.nome.startsWith('piano') && Math.abs(d.scarto) > 15);
        t.misura('limite dichiarato del modo «canta quello che suoni»',
          gravi.length
            ? `sul pianoforte sotto i ~150 Hz il rilevatore legge fino a +${Math.max(...gravi.map((d) => d.scarto)).toFixed(0)} centesimi crescente (${gravi.map((d) => d.nome.replace('piano · ', '')).join(', ')}): la corda è rigida e l'altezza che esce è un compromesso fra le parziali stirate. La NOTA resta giusta, il bersaglio da cantare va preso dal semitono temperato.`
            : 'nessuna nota sopra i 15 centesimi di errore');
      }
      // Quanto è stirato davvero il banco: se la stiratura non c'è, la prova non prova nulla.
      const p = armonicheStrumento(NOTE['Mi2'], { B: 5e-4, parziali: 16, pendenza: 5 });
      t.misura('stiratura del banco piano su Mi2 (B=5e-4)',
        [2, 4, 8, 12, 16].filter((n) => p[n - 1]).map((n) => `${n}ª ${centesimi(p[n - 1][0], n * NOTE['Mi2']).toFixed(0)} cent`).join(' · '));
    } finally { await ctx.close().catch(() => {}); }
  };
});

// ── Il banco stesso: che non menta ───────────────────────────────────────────

gruppo('Il banco — i livelli sono quelli dichiarati', (t) => {
  t.asincrono = async () => {
    const ctx = await contestoPronto(t);
    if (!ctx) return;
    try {
      for (const db of [-50, -40, -22]) {
        const b = banco(ctx, armonicheVoce(220, 'hum'), { dbfs: db });
        attendi(ctx, 300);
        const r = new Rilevatore(b.an);
        const l = r.leggi();
        b.chiudi();
        t.ok(`voce chiesta a ${db} dBFS: arriva entro 1,5 dB`, Math.abs(dbfs(l.rms) - db) <= 1.5,
          `misurati ${dbfs(l.rms).toFixed(1)} dBFS`);
      }
      const b = banco(ctx, armonicheVoce(220, 'hum'), { dbfs: -120, rumoreDbfs: -45 });
      attendi(ctx, 300);
      const r = new Rilevatore(b.an);
      const l = r.leggi();
      b.chiudi();
      t.ok('rumore chiesto a −45 dBFS: arriva entro 1,5 dB', Math.abs(dbfs(l.rms) - (-45)) <= 1.5,
        `misurati ${dbfs(l.rms).toFixed(1)} dBFS`);
      t.misura('RMS teorico del mugolato normalizzato', rmsDiParziali(armonicheVoce(220, 'hum')).toFixed(4));
    } finally { await ctx.close().catch(() => {}); }
  };
});

// ── L'ALTERNANZA — la regola su cui sta in piedi tutto ───────────────────────
//
// «L'app non deve suonare mentre misura» (§2 dell'AVVIO). Non è una buona intenzione da
// dichiarare: è un numero da misurare in dB. Nell'ukulele il click del metronomo stava
// dentro la banda delle corde e veniva contato come una pennata dell'utente — l'esercizio
// risultava suonato benissimo a strumento appoggiato sul tavolo. Un programma che emette
// mentre ascolta si dà da solo la risposta che sperava, e la contaminazione ha SEMPRE lo
// stesso segno: fa sembrare che funzioni.
//
// Qui l'alternanza toglie il problema alla radice, ma «toglie» va verificato: si ascolta
// il bus di uscita dell'app e si misura quanto ne esce durante la finestra in cui l'app
// crede di stare misurando la voce.

function rmsDi(an) {
  const buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i += 1) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

gruppo('Alternanza — l\'app tace davvero mentre misura', (t) => {
  t.asincrono = async () => {
    if (!await audio.sblocca()) {
      t.ok('prove audio eseguite', false, 'il browser tiene l\'audio sospeso: premi «Rifai le prove audio»');
      return;
    }
    const c = audio.contesto();
    const an = c.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0;
    audio.uscita().connect(an);
    try {
      const DURATA = 600;
      // La promessa NON si aspetta: `onended` è un evento del ciclo principale e qui si
      // sta per bloccare il ciclo principale con l'attesa attiva sull'orologio audio.
      // L'oscillatore è programmato sull'orologio dell'audio e suona lo stesso.
      audio.daiLaNota(440, { durataMs: DURATA });
      attendi(c, 350);
      const durante = rmsDi(an);
      // Fine nota + coda dell'inviluppo + la guardia che l'app si prende prima di credere
      // al microfono. Da qui in poi, per l'app, tutto quello che si sente sei tu.
      attendi(c, DURATA + 260 + 300 - 350 + 120);
      const dopo = rmsDi(an);
      const distanza = 20 * Math.log10(Math.max(dopo, 1e-9) / Math.max(durante, 1e-9));
      t.misura('uscita dell\'app: mentre suona · mentre misura',
        `${dbfs(durante).toFixed(1)} dBFS · ${dbfs(dopo).toFixed(1)} dBFS = ${distanza.toFixed(0)} dB sotto`);
      t.ok('durante la nota l\'app suona davvero', durante > 0.01, `${dbfs(durante).toFixed(1)} dBFS`);
      t.ok('durante la finestra di misura l\'app è almeno 60 dB più giù',
        distanza <= -60, `${distanza.toFixed(1)} dB`);
      t.ok('e in assoluto è sotto i −80 dBFS', dbfs(dopo) < -80, `${dbfs(dopo).toFixed(1)} dBFS`);

      // `zittisci()` deve spegnere DI COLPO: è quello che succede navigando via durante
      // una scala, e senza, le note restanti suonavano sopra la schermata nuova — un suono
      // orfano dell'app in un'app costruita sull'alternanza.
      audio.daiLaNota(440, { durataMs: 1200 });
      attendi(c, 250);
      const primaDiZittire = rmsDi(an);
      audio.zittisci();
      attendi(c, 150);
      const dopoZittito = rmsDi(an);
      t.ok('prima di zittire la nota suona', primaDiZittire > 0.01, `${dbfs(primaDiZittire).toFixed(1)} dBFS`);
      t.ok('zittisci spegne la nota di colpo', dbfs(dopoZittito) < -60,
        `${dbfs(dopoZittito).toFixed(1)} dBFS`);

      // La nota di riferimento è DAVVERO quella nota, e ha armoniche: una sinusoide pura
      // è difficile da agganciare per l'orecchio, e chi non è allenato ci canta sopra a
      // caso. Questa prova è l'unica cosa che tiene onesta quella decisione di §2.
      audio.daiLaNota(hzDaMidi(57), { durataMs: 900 }); // La3, 220 Hz
      attendi(c, 400);
      const r = new Rilevatore(an);
      const letto = r.leggi();
      const sp = new Float32Array(an.frequencyBinCount);
      an.getFloatFrequencyData(sp);
      const binHz = c.sampleRate / an.fftSize;
      const a = (n) => sp[Math.round((220 * n) / binHz)];
      attendi(c, 900);
      t.ok('la nota di riferimento è quella chiesta', letto.hz && Math.abs(centesimi(letto.hz, 220)) < 10,
        letto.hz ? `${centesimi(letto.hz, 220).toFixed(1)} cent (${letto.hz.toFixed(1)} Hz)` : 'nessuna lettura');
      t.misura('parziali della nota di riferimento, rispetto alla fondamentale',
        [2, 3, 4, 5].map((n) => `${n}ª ${(a(n) - a(1)).toFixed(0)} dB`).join(' · '));
      t.ok('non è una sinusoide: la 2ª e la 3ª parziale ci sono',
        a(2) - a(1) > -30 && a(3) - a(1) > -40,
        `2ª ${(a(2) - a(1)).toFixed(0)} dB, 3ª ${(a(3) - a(1)).toFixed(0)} dB sotto la fondamentale`);
    } finally {
      audio.uscita().disconnect(an);
      audio.chiudi();
    }
  };
});

// ── Gli esercizi: le decisioni, una per una ──────────────────────────────────

gruppo('Esercizi — che nota dare, e a chi', (t) => {
  t.ok('la tolleranza sta molto sopra l\'incertezza dello strumento',
    esercizi.TOLLERANZA >= esercizi.INCERTEZZA_STRUMENTO * 4,
    `${esercizi.TOLLERANZA} contro ${esercizi.INCERTEZZA_STRUMENTO}: sotto un fattore 4 l'app starebbe giudicando il rumore della propria misura e chiamandolo intonazione`);

  // La zona comoda non è tutta l'estensione: gli estremi sono dove si arriva, non dove si sta.
  const baritono = { grave: 43, acuto: 64 };   // Sol2 → Mi4
  const z = esercizi.zonaComoda(baritono);
  t.ok('la zona comoda sta dentro l\'estensione', z.basso > baritono.grave && z.alto < baritono.acuto,
    `${z.basso}–${z.alto} dentro ${baritono.grave}–${baritono.acuto}`);
  t.misura('estensione Sol2→Mi4 (21 semitoni) → zona comoda', `${nomeIt(z.basso)} → ${nomeIt(z.alto)}`);
  const stretta = esercizi.zonaComoda({ grave: 57, acuto: 60 });
  t.ok('su un\'estensione strettissima la zona non si rovescia', stretta.basso <= stretta.alto,
    `${stretta.basso}–${stretta.alto}`);
  t.uguale('senza estensione non si inventa una zona', esercizi.zonaComoda(null), null);

  // Il difetto che questa funzione esiste per evitare: dare un La4 a un baritono, che
  // canta il La3 e si sente dire che ha sbagliato di dodici semitoni.
  for (const caso of [0, 0.17, 0.33, 0.5, 0.66, 0.83, 0.999]) {
    const m = esercizi.notaDaDare(z, caso);
    t.ok(`sorteggio ${caso}: la nota cade nella zona comoda`, m >= z.basso && m <= z.alto,
      `${nomeIt(m)} fuori da ${nomeIt(z.basso)}–${nomeIt(z.alto)}`);
  }
  // Il rilevatore guarda da 70 a 1300 Hz. Una zona che sborda va TAGLIATA sulla banda,
  // non usata com'è: dare una nota che non si sa misurare vorrebbe dire chiedere di
  // cantare e poi dire «non ti sento» per colpa propria.
  const sborda = esercizi.notaDaDare({ basso: 20, alto: MIDI_MIN + 4 }, 0.0);
  t.ok('una zona che sborda in basso viene tagliata sulla banda', sborda >= MIDI_MIN,
    `${nomeIt(sborda)} sotto ${nomeIt(MIDI_MIN)}`);
  const sbordaSu = esercizi.notaDaDare({ basso: MIDI_MAX - 3, alto: 200 }, 0.999);
  t.ok('e lo stesso in alto', sbordaSu <= MIDI_MAX, `${nomeIt(sbordaSu)} sopra ${nomeIt(MIDI_MAX)}`);
  t.misura('la banda in cui l\'app può dare una nota', `${nomeIt(MIDI_MIN)} → ${nomeIt(MIDI_MAX)}`);
  // Fuori del tutto NON si inventa una nota: si dice che non si sa. Il chiamante deve
  // avere qualcosa da mostrare, altrimenti la schermata scriverebbe «canta il Do-1».
  t.uguale('una zona tutta fuori banda non produce una nota inventata',
    esercizi.notaDaDare({ basso: 20, alto: 30 }, 0.5), null);
  const evitando = esercizi.notaDaDare(z, 0.5, { evita: [Math.round((z.basso + z.alto) / 2)] });
  t.ok('la nota di prima non torna subito', Math.abs(evitando - Math.round((z.basso + z.alto) / 2)) >= 2,
    `${nomeIt(evitando)}`);

  const zp = esercizi.zonaDaUnaNota(55);
  t.ok('dalla prima nota cantata esce una zona provvisoria che la contiene',
    zp.basso < 55 && zp.alto > 55 && zp.provvisoria === true, JSON.stringify(zp));
});

/** Una raccolta finta con la forma di quelle vere: serie di centesimi a passo fisso. */
function raccoltaFinta(fn, { n = 200, dtMs = 25, dentro = 1 } = {}) {
  return { serie: Array.from({ length: n }, (_, i) => fn((i * dtMs) / 1000, i)), dtMs, dentro };
}

gruppo('Esercizi — cosa dice di quello che ha sentito', (t) => {
  // Caso deterministico: un banco che cambia a ogni esecuzione non è un banco.
  const semino = () => { let s = 12345; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; }; };
  // Una voce ferma non è una riga dritta: ha un tremolio piccolo e SENZA regolarità.
  // Il primo tentativo di questa prova usava una sinusoide di ±4 centesimi a 4,8 Hz —
  // che è un vibrato piccolo, non una voce ferma, e infatti veniva riconosciuto come tale.
  const caso1 = semino();
  const ferma = raccoltaFinta(() => 3 * caso1());
  const v1 = esercizi.giudicaNotaTenuta(ferma);
  t.ok('una nota tenuta bene viene promossa', v1.promosso, `${v1.titolo} — ${v1.righe.join(' · ')}`);

  // Il calo è il difetto più comune e quello di cui da soli non ci si accorge: deve
  // essere riconosciuto ANCHE quando la media resta dentro tolleranza, che è il caso
  // tipico (si parte sopra, si finisce sotto, e in media sembra tutto a posto).
  const cala = raccoltaFinta((s) => 30 - 14 * s);
  const v2 = esercizi.giudicaNotaTenuta(cala);
  t.ok('un calo viene visto anche se la media resta dentro tolleranza',
    !v2.promosso && /calat/i.test(v2.titolo),
    `${v2.titolo} (media ${(30 - 14 * 2.5).toFixed(0)} centesimi, dentro i ${esercizi.TOLLERANZA})`);

  // ⚠️ La frase che si contraddiceva da sola, vista guidando l'app: «voce ferma,
  // oscillazione ±135 centesimi». `scomponi` lo sapeva già («oscillazione non periodica»),
  // era il verdetto a non ascoltarlo.
  const caso2 = semino();
  let x = 0;
  const balla = esercizi.giudicaNotaTenuta(raccoltaFinta(() => { x = x * 0.85 + 90 * caso2(); return x; }));
  t.ok('una nota che balla NON viene chiamata «voce ferma»',
    !/voce ferma/.test(balla.righe.join(' ')), balla.righe.join(' · '));
  t.ok('e non viene promossa', !balla.promosso, balla.titolo);
  t.ok('una nota davvero ferma sì', /voce ferma/.test(v1.righe.join(' ')), v1.righe.join(' · '));

  // I primi 400 ms sono l'attacco e non entrano nella tenuta: senza questo taglio, una
  // partenza da un'altra nota gonfia l'oscillazione e la nota tenuta meglio del mondo
  // risulta instabile. È successo davvero, guidando l'app.
  const partenzaAltrove = raccoltaFinta((s) => (s < 0.35 ? -600 : 3));
  const conTaglio = esercizi.giudicaNotaTenuta(partenzaAltrove);
  t.ok('una partenza da un\'altra nota non fa bocciare la tenuta', conTaglio.promosso,
    `${conTaglio.titolo} — ${conTaglio.righe.join(' · ')}`);

  const sotto = esercizi.giudicaNotaTenuta(raccoltaFinta(() => -60));
  t.ok('stare sotto ma fermi è un verdetto diverso dal calare',
    !sotto.promosso && /sotto/i.test(sotto.titolo) && !/calat/i.test(sotto.titolo), sotto.titolo);

  const poco = esercizi.giudicaNotaTenuta({ ...ferma, dentro: 0.2 });
  t.ok('se non ha sentito abbastanza NON giudica la voce', !poco.promosso && /sentito/i.test(poco.titolo),
    poco.titolo);
  t.ok('e lo dice come un problema di microfono, non di voce', /telefono|forte/i.test(poco.dettaglio), poco.dettaglio);

  // ⚠️ Il difetto che il collaudo non poteva vedere e la guida in pagina sì: se la scheda
  // finisce in secondo piano il browser strozza `setInterval` da 25 ms a 1000, l'app
  // riceve quaranta volte meno letture, e `scomponi` — senza abbastanza punti per periodo
  // — restituisce «nessun vibrato». Che è indistinguibile da «voce ferma», e veniva
  // scritto a schermo esattamente così, a uno che magari stava facendo un vibrato
  // perfetto. È il difetto numero uno di questa famiglia: dichiarare ciò che non si misura.
  const conVibrato = (dtMs) => raccoltaFinta((s) => 50 * Math.sin(2 * Math.PI * 5.5 * s), { n: Math.round(5000 / dtMs), dtMs });
  const fitto = esercizi.giudicaNotaTenuta(conVibrato(25));
  const rado = esercizi.giudicaNotaTenuta(conVibrato(1000 / 3));
  t.ok('a cadenza normale il vibrato viene visto', /vibrato 5[.,]/.test(fitto.righe.join(' ')),
    fitto.righe.join(' · '));
  t.ok('a cadenza strozzata NON scrive «voce ferma»', !/voce ferma/.test(rado.righe.join(' ')),
    rado.righe.join(' · '));
  t.ok('e dice invece che il vibrato non l\'ha misurato', /non misurato/.test(rado.righe.join(' ')),
    rado.righe.join(' · '));
  t.misura('passo di lettura massimo per vedere un vibrato',
    `${PASSO_MASSIMO_MS.toFixed(0)} ms — ricavato dalla banda: tre letture per periodo a 9 Hz`);
  t.ok('ma l\'intonazione media la dice lo stesso, perché quella la sa',
    /intonazione media/.test(rado.righe.join(' ')), rado.righe.join(' · '));

  // Attacco: chi scivola dentro da sotto ha un problema di attacco anche se la sua media
  // finale è perfetta — anzi, soprattutto allora. Per questo si confronta l'inizio con la
  // parte stabile della STESSA nota e non con il bersaglio.
  const scivola = esercizi.giudicaAttacco(raccoltaFinta((s) => (s < 0.35 ? -90 + 250 * s : 0)));
  t.ok('lo scivolamento da sotto viene visto', !scivola.promosso && /sotto/i.test(scivola.titolo), scivola.titolo);
  const pulito = esercizi.giudicaAttacco(raccoltaFinta(() => 5));
  t.ok('un attacco pulito viene promosso', pulito.promosso, pulito.titolo);
  const scivolaEBene = esercizi.giudicaAttacco(raccoltaFinta((s) => (s < 0.35 ? -90 + 250 * s : 0)));
  t.ok('e resta bocciato anche se poi la nota è perfettamente intonata', !scivolaEBene.promosso,
    'altrimenti l\'esercizio starebbe misurando l\'intonazione, che è già misurata altrove');

  // Intervalli: conta la DISTANZA, non l'intonazione assoluta.
  const quintaStorta = esercizi.giudicaIntervallo({ centDiPartenza: -40, centDiArrivo: 660, semitoni: 7 });
  t.ok('una quinta esatta partita calante è comunque una quinta esatta', quintaStorta.promosso,
    `${quintaStorta.titolo} — ${quintaStorta.righe.join('')}`);
  const seiSemitoni = esercizi.giudicaIntervallo({ centDiPartenza: 0, centDiArrivo: 600, semitoni: 7 });
  t.ok('un intervallo sbagliato di un semitono si chiama con il suo nome',
    !seiSemitoni.promosso && /sbagliat/i.test(seiSemitoni.titolo), seiSemitoni.titolo);
  const stretta = esercizi.giudicaIntervallo({ centDiPartenza: 0, centDiArrivo: 640, semitoni: 7 });
  t.ok('una quinta stretta di 60 centesimi non è "sbagliata", è stretta',
    !stretta.promosso && /strett/i.test(stretta.titolo), stretta.titolo);

  // Fiato: secondi DENTRO tolleranza, non secondi di rumore.
  const sirena = esercizi.giudicaFiato(raccoltaFinta((s) => -20 * s, { n: 800 }));
  const tenuta = esercizi.giudicaFiato(raccoltaFinta(() => 10, { n: 800 }));
  t.misura('venti secondi di nota: una che scivola via · una tenuta',
    `${sirena.valore.toFixed(1)} s · ${tenuta.valore.toFixed(1)} s`);
  t.ok('una nota che scivola via non conta come fiato', sirena.valore < tenuta.valore / 2,
    `${sirena.valore.toFixed(1)} contro ${tenuta.valore.toFixed(1)}`);

  // notaPresa: chi non arriva a un acuto canta l'ottava sotto senza accorgersene.
  t.ok('una nota cantata un\'ottava sotto NON conta come presa',
    !esercizi.notaPresa(raccoltaFinta(() => -1200)).presa, 'l\'app attribuirebbe un\'estensione che non c\'è');
  t.ok('e lo dice chiamandola ottava', /ottava/.test(esercizi.notaPresa(raccoltaFinta(() => -1200)).motivo || ''), '');
  t.ok('una nota cantata un po\' stonata conta come presa',
    esercizi.notaPresa(raccoltaFinta(() => 60)).presa, 'l\'estensione non è un esame di intonazione');
  t.ok('se non l\'ha sentita non conta come presa',
    !esercizi.notaPresa({ ...raccoltaFinta(() => 0), dentro: 0.2 }).presa, '');
});

gruppo('Estensione — la macchina a stati', (t) => {
  // Attenzione al conteggio, che è la cosa su cui questa prova ha già sbagliato una volta:
  // il PRIMO giro chiede la nota di partenza stessa, quindi cinque «presa» arrivano a
  // 57−4 e non a 57−5. Sbagliava la prova, non la macchina.
  let s = esercizi.estensioneInizio(57);           // La3
  t.uguale('si comincia scendendo', s.verso, 'giu');
  t.uguale('e la prima nota chiesta è quella di partenza', s.corrente, 57);
  for (let i = 0; i < 5; i += 1) s = esercizi.estensionePasso(s, 'presa');
  t.uguale('cinque note prese in giù (57, 56, 55, 54, 53) abbassano il grave a 53', s.grave, 53);
  s = esercizi.estensionePasso(s, 'no');
  t.uguale('il primo "non ci arrivo" gira in su', s.verso, 'su');
  t.uguale('e riparte da sopra la nota di partenza, non da dove si era arrivati', s.corrente, 58);
  for (let i = 0; i < 7; i += 1) s = esercizi.estensionePasso(s, 'presa');
  t.uguale('sette note prese in su alzano l\'acuto', s.acuto, 64);
  s = esercizi.estensionePasso(s, 'no');
  t.ok('il secondo "non ci arrivo" chiude l\'esercizio', s.finito, JSON.stringify(s));
  const r = esercizi.estensioneRiassunto(s);
  t.uguale('il riassunto conta i semitoni giusti (53→64)', r.semitoni, 11);
  t.ok('e la dichiara attendibile', r.attendibile, r.testo);
  t.misura('esempio di esercizio completo', r.testo);

  // ⚠️ Il caso trovato guidando l'app: «non ci arrivo» al primo colpo, due volte, e l'app
  // salvava un'estensione di ZERO semitoni — poi usata per decidere ogni nota successiva.
  // Un'app che ti fa cantare per sempre lo stesso La3, e per giunta convinta di sapere
  // qualcosa di te.
  let z = esercizi.estensioneInizio(57);
  z = esercizi.estensionePasso(z, 'no');
  z = esercizi.estensionePasso(z, 'no');
  const rz = esercizi.estensioneRiassunto(z);
  t.uguale('due rifiuti di fila chiudono l\'esercizio', z.finito, true);
  t.ok('e il risultato viene dichiarato NON attendibile', !rz.attendibile, rz.testo);
  t.ok('sotto la terza minore niente è attendibile',
    !esercizi.estensioneRiassunto({ grave: 57, acuto: 59 }).attendibile
    && esercizi.estensioneRiassunto({ grave: 57, acuto: 60 }).attendibile,
    `soglia ${esercizi.ESTENSIONE_MINIMA} semitoni`);

  // Il fondo della banda NON è «non ci arrivi»: è «qui non ti so misurare». Sono due frasi
  // molto diverse per chi le riceve, e la seconda è l'unica vera.
  let b = esercizi.estensioneInizio(MIDI_MIN + 1);
  b = esercizi.estensionePasso(b, 'presa');
  b = esercizi.estensionePasso(b, 'presa');
  t.ok('arrivati al fondo della banda si cambia verso e si spiega perché',
    b.verso === 'su' && /non ti so misurare/.test(b.motivoFine), b.motivoFine || '(nessun motivo dato)');
  t.ok('e non si dice mai che non ci arrivi', !/non ci arrivi\b/.test(b.motivoFine.replace('non è che non ci arrivi', '')), b.motivoFine);
});

// ── Melodie e scale — generate, e ritagliate dal microfono ───────────────────

gruppo('Melodie — generate, mai copiate', (t) => {
  // Il motivo per cui questo file esiste: una sequenza di accordi non è protetta (e infatti
  // le altre tre app hanno una libreria di giri), ma una MELODIA sì — è proprio quello che
  // il diritto d'autore protegge in una canzone. Generarla è l'unica delle tre vie pulite
  // che non richiede né un catalogo né il lavoro dell'utente.
  const tonica = 55; // Sol3
  for (const seme of [1, 7, 42, 1234, 99999]) {
    const m = melodie.melodiaGenerata(tonica, { passi: 6, seme, ambito: 8 });
    t.ok(`seme ${seme}: parte e finisce sulla tonica`, m[0] === tonica && m[m.length - 1] === tonica,
      m.map(nomeIt).join(' '));
    t.ok(`seme ${seme}: non esce dall'ambito chiesto`, m.every((x) => x >= tonica && x <= tonica + 14),
      m.map(nomeIt).join(' '));
    const salti = m.slice(1).map((x, i) => Math.abs(x - m[i]));
    t.ok(`seme ${seme}: nessun salto più largo di una quinta`, Math.max(...salti) <= melodie.SALTO_MASSIMO_SEMITONI,
      `salto massimo ${Math.max(...salti)} semitoni in ${m.map(nomeIt).join(' ')}`);
    // ⚠️ Due difetti visti guidando l'app, non leggendo: una melodia con due note UGUALI
    // attaccate (che il microfono non può distinguere da una nota lunga: l'esercizio ne
    // conterebbe una come mancata, bocciando chi ha fatto giusto) e un salto di tritono
    // Si3→Fa4, l'intervallo più difficile da intonare che esista.
    t.ok(`seme ${seme}: mai due note uguali di fila`, salti.every((s) => s > 0),
      m.map(nomeIt).join(' '));
    t.ok(`seme ${seme}: mai un tritono`, salti.every((s) => s !== 6), m.map(nomeIt).join(' '));
  }
  t.misura('cinque melodie generate', [1, 7, 42, 1234, 99999]
    .map((s) => melodie.melodiaGenerata(55, { passi: 6, seme: s, ambito: 8 }).map(nomeIt).join(' '))
    .join(' | '));
  // ⚠️ «Sol La Sol La Sol»: formalmente a posto e completamente inutile. Una melodia che
  // fa avanti e indietro fra due note non insegna niente e non si riconosce.
  const andirivieni = (m) => m.slice(2).filter((x, i) => x === m[i]).length;
  for (const seme of [1, 7, 42, 1234, 99999, 5, 61]) {
    const m = melodie.melodiaGenerata(55, { passi: 6, seme, ambito: 8 });
    t.ok(`seme ${seme}: non fa l'andirivieni fra due note sole`,
      andirivieni(m) <= 1 && new Set(m).size >= 3, m.map(nomeIt).join(' '));
  }
  const diverse = new Set([1, 7, 42, 1234, 99999, 5, 61]
    .map((s) => melodie.melodiaGenerata(55, { seme: s }).join(',')));
  t.ok('semi diversi danno melodie per lo più diverse', diverse.size >= 5,
    `${diverse.size} melodie distinte su 7 semi`);
  t.uguale('lo stesso seme dà la stessa melodia',
    melodie.melodiaGenerata(tonica, { seme: 7 }), melodie.melodiaGenerata(tonica, { seme: 7 }));
  t.ok('semi diversi danno melodie diverse',
    JSON.stringify(melodie.melodiaGenerata(tonica, { seme: 7 })) !== JSON.stringify(melodie.melodiaGenerata(tonica, { seme: 8 })));

  const scala = melodie.scalaAgilita(60);
  t.uguale('la scala di agilità sale e ridiscende sulla stessa nota',
    scala, [60, 62, 64, 65, 67, 65, 64, 62, 60]);
  t.uguale('l\'arpeggio è tonica terza quinta ottava e ritorno',
    melodie.arpeggio(60), [60, 64, 67, 72, 67, 64, 60]);
  t.uguale('i gradi funzionano anche sotto la tonica', melodie.gradoDi(60, -1), 59);
});

gruppo('Melodie — ritagliare le note da una linea continua', (t) => {
  const dt = 25;
  // Una scala cantata: note tenute, con un portamento in mezzo e un respiro (silenzio).
  const linea = [];
  const attese = [60, 62, 64, 62, 60];
  attese.forEach((m, i) => {
    if (i === 2) for (let k = 0; k < 4; k += 1) linea.push(null);        // un respiro
    if (i > 0) for (let k = 0; k < 3; k += 1) linea.push(attese[i - 1] + ((m - attese[i - 1]) * (k + 1)) / 4); // portamento
    for (let k = 0; k < 16; k += 1) linea.push(m + 0.05 * Math.sin(k));  // 400 ms di nota
  });
  const note = melodie.segmentaNote(linea, dt);
  t.uguale('ritaglia esattamente le note cantate', note.map((n) => Math.round(n.midi)), attese);
  t.misura('durate ritagliate', note.map((n) => `${n.durataMs.toFixed(0)} ms`).join(' · '));

  // ⚠️ Il caso che rende necessario tenere i buchi: due note UGUALI separate da un respiro.
  // Tappando il silenzio con l'ultimo valore buono diventerebbero una nota sola, e in una
  // scala che sale e ridiscende succede a ogni giro.
  const conRespiro = [...Array(16).fill(60), ...Array(6).fill(null), ...Array(16).fill(60)];
  t.uguale('due note uguali separate da un respiro restano due',
    melodie.segmentaNote(conRespiro, dt).length, 2);
  const senzaBuchi = [...Array(16).fill(60), ...Array(6).fill(60), ...Array(16).fill(60)];
  t.uguale('mentre senza il respiro è giustamente una sola',
    melodie.segmentaNote(senzaBuchi, dt).length, 1);

  // Il confronto salta avanti: una nota mancata non deve far risultare sbagliate tutte le
  // successive, che è quello che succede allineando a coppie fisse.
  const cantate = [60, 64, 62, 60].map((m, i) => ({ midi: m, daMs: i * 500, durataMs: 400 }));
  const c = melodie.confrontaSequenza(cantate, [60, 62, 64, 62, 60]);
  t.ok('una nota saltata non trascina con sé le successive', c.prese >= 3,
    `${c.prese} su ${c.su}: ${c.esiti.map((e) => (e.cantata ? '·' : '✕')).join('')}`);
  const tutte = melodie.confrontaSequenza(
    [60, 62, 64, 62, 60].map((m, i) => ({ midi: m + 0.2, daMs: i * 500, durataMs: 400 })), [60, 62, 64, 62, 60],
  );
  t.uguale('una melodia cantata giusta le prende tutte', tutte.prese, 5);
  t.ok('e ne misura lo scarto medio', Math.abs(tutte.scartoMedio - 20) < 1, `${tutte.scartoMedio.toFixed(0)} centesimi`);

  const trasportata = melodie.confrontaSequenza(
    [60, 62, 64, 62, 60].map((m, i) => ({ midi: m + 3, daMs: i * 500, durataMs: 400 })), [60, 62, 64, 62, 60],
  );
  t.uguale('una melodia trasportata di tre semitoni NON conta come presa', trasportata.prese, 0);
});

// ── Passaggio di registro ────────────────────────────────────────────────────

gruppo('Passaggio di registro — trovarlo, o dire che non si vede', (t) => {
  // Un glissando finto: livello e brillantezza che scendono piano, e un GRADINO netto a
  // un certo punto. È quello che fa una voce quando cambia registro.
  const glissando = ({ salto = null, rumore = 0.15, semi = 14, seme = 3, dbSalto = -6, brSalto = -0.6 } = {}) => {
    const r = melodie.caso(seme);
    const fuori = [];
    for (let i = 0; i < semi; i += 1) {
      const dopo = salto !== null && i >= salto;
      for (let k = 0; k < 6; k += 1) {
        fuori.push({
          midi: 52 + i + (r() - 0.5) * 0.4,
          dbfs: -20 - i * 0.15 + (dopo ? dbSalto : 0) + (r() - 0.5) * rumore,
          brillantezza: 3.2 - i * 0.02 + (dopo ? brSalto : 0) + (r() - 0.5) * rumore * 0.1,
        });
      }
    }
    return fuori;
  };

  const con = esercizi.trovaPassaggio(glissando({ salto: 8 }));
  t.ok('trova il gradino dov\'è', con.trovato && con.midi === 60, JSON.stringify({ trovato: con.trovato, midi: con.midi }));
  t.misura('gradino trovato', con.trovato ? `${nomeIt(con.midi)}: ${con.dDb.toFixed(1)} dB, timbro ${con.dBr.toFixed(2)}, ${(con.punteggio / 2).toFixed(1)}× il passo tipico` : con.motivo);

  // E — la parte che conta di più — su una voce SENZA un gradino netto non deve inventarne
  // uno. Un'app che indica sempre un punto ha ragione per caso una volta su dodici.
  const senza = esercizi.trovaPassaggio(glissando({ salto: null }));
  t.ok('su un glissando liscio NON inventa un passaggio', !senza.trovato, JSON.stringify(senza.midi));
  t.misura('glissando liscio', senza.motivo);

  // ⚠️ Il difetto trovato guidando l'app: su una salita PERFETTAMENTE liscia il passo
  // tipico tende a zero, il punteggio è un rapporto, e qualunque bricciolo diventa «dieci
  // volte il tipico». L'app ha dichiarato un passaggio con un gradino di −0,0 dB — il
  // nulla presentato come una scoperta.
  const lisciaDavvero = esercizi.trovaPassaggio(glissando({ salto: null, rumore: 0 }));
  t.ok('e nemmeno su una salita perfettamente liscia, dove il passo tipico è zero',
    !lisciaDavvero.trovato,
    `ha dichiarato ${lisciaDavvero.midi ? nomeIt(lisciaDavvero.midi) : ''} con ${lisciaDavvero.dDb?.toFixed(1)} dB`);
  t.misura('salita perfettamente liscia', lisciaDavvero.motivo);
  t.misura('pavimenti sotto cui non è un passaggio ma un microfono',
    `${esercizi.DB_MINIMO} dB di livello · ${esercizi.TIMBRO_MINIMO} di timbro`);

  // E un gradino piccolo ma NETTO resta comunque non dichiarabile: la nettezza da sola non
  // basta se la cosa è più piccola di quanto la stanza sappia fare da sé.
  const gradinetto = esercizi.trovaPassaggio(glissando({ salto: 8, rumore: 0.02, dbSalto: -0.5, brSalto: -0.02 }));
  t.ok('un gradino piccolissimo non viene dichiarato, per quanto netto sia',
    !gradinetto.trovato, `${gradinetto.dDb?.toFixed(2)} dB`);

  const corto = esercizi.trovaPassaggio(glissando({ salto: 4, semi: 5 }));
  t.ok('un glissando troppo corto viene dichiarato tale', !corto.trovato && /semitoni/.test(corto.motivo), corto.motivo);

  const v = esercizi.giudicaPassaggio(senza);
  t.ok('e «non trovato» non è un fallimento dell\'utente', v.promosso && /non vuol dire che non ce l'hai/i.test(v.dettaglio), v.dettaglio.slice(0, 60));
});

// ── Agilità e melodia: i verdetti ────────────────────────────────────────────

gruppo('Agilità e melodia — i due criteri devono valere insieme', (t) => {
  const seq = [60, 62, 64, 65, 67, 65, 64, 62, 60];
  const cantate = (scarto, passoMs) => seq.map((m, i) => ({ midi: m + scarto, daMs: i * passoMs, durataMs: passoMs * 0.8 }));
  const attesi = seq.length * 500;

  const bene = esercizi.giudicaAgilita(melodie.confrontaSequenza(cantate(0.1, 500), seq), { msAttesi: attesi });
  t.ok('tutte prese e a tempo: promossa', bene.promosso, `${bene.titolo} — ${bene.righe.join(' · ')}`);

  const lenta = esercizi.giudicaAgilita(melodie.confrontaSequenza(cantate(0.1, 900), seq), { msAttesi: attesi });
  t.ok('tutte prese ma lenta: NON promossa', !lenta.promosso, lenta.titolo);
  t.ok('e lo dice che il problema è il tempo, non le note', /lenta/i.test(lenta.titolo), lenta.titolo);

  const bucata = esercizi.giudicaAgilita(
    melodie.confrontaSequenza(cantate(0.1, 500).filter((_, i) => i !== 3), seq), { msAttesi: attesi },
  );
  t.ok('una nota mancata: NON promossa', !bucata.promosso, bucata.titolo);
  t.ok('e il consiglio è rallentare, non accelerare', /più lenta/i.test(bucata.dettaglio), bucata.dettaglio.slice(0, 80));

  // Una melodia cantata giusta ma tutta traslata è un difetto DIVERSO dallo stonare, e
  // merita di essere chiamato con il suo nome.
  const mel = [60, 62, 64, 62, 60];
  const traslata = melodie.confrontaSequenza(
    mel.map((m, i) => ({ midi: m + 0.55, daMs: i * 500, durataMs: 400 })), mel,
  );
  const vm = esercizi.giudicaMelodia(traslata);
  t.ok('una melodia giusta ma trasportata viene presa tutta', vm.promosso, vm.titolo);
  t.ok('e le si dice che l\'ha trasportata', /trasportata/i.test(vm.dettaglio), vm.dettaglio);
});

// ── Le misure che mentivano sui bordi ────────────────────────────────────────

gruppo('Fiato — il silenzio non è fiato', (t) => {
  // ⚠️ Il difetto: `serie` tappa i buchi con l'ultimo valore buono (serve al vibrato, che
  // vuole un passo costante), e il fiato la leggeva. Una nota da 5 secondi seguita da 27
  // di silenzio misurava 32 secondi: l'ultimo valore restava «dentro tolleranza» fino a
  // fine finestra. Il cantante sintetico cantava tutta la finestra — il difetto dormiva.
  const dt = 25;
  const nota5s = Array.from({ length: 200 }, () => 5);
  const silenzio27s = Array.from({ length: 1080 }, () => null);
  const tappata = [...nota5s, ...Array.from({ length: 1080 }, () => 5)]; // com'era: buchi tappati

  const giusto = esercizi.giudicaFiato({ serieBuchi: [...nota5s, ...silenzio27s], dtMs: dt });
  t.ok('cinque secondi di nota e ventisette di silenzio misurano ~5 secondi',
    Math.abs(giusto.valore - 5) < 0.3, `${giusto.valore.toFixed(1)} s`);
  // RED per costruzione: sulla serie tappata il difetto DEVE ricomparire.
  const bugia = esercizi.giudicaFiato({ serie: tappata, dtMs: dt });
  t.ok('sulla serie coi buchi tappati il difetto si rivede (32 secondi)',
    bugia.valore > 30, `${bugia.valore.toFixed(1)} s`);
  t.misura('stessa voce, due letture', `coi buchi ${giusto.valore.toFixed(1)} s · tappata ${bugia.valore.toFixed(1)} s`);

  // Un buco in MEZZO azzera la corsa come una stonatura: riprendere fiato interrompe la
  // nota, ed è giusto che il conteggio riparta.
  const conRespiro = esercizi.giudicaFiato({
    serieBuchi: [...nota5s, null, null, null, null, ...nota5s], dtMs: dt,
  });
  t.ok('un respiro in mezzo azzera la corsa: due tratti da 5 valgono 5, non 10',
    Math.abs(conRespiro.valore - 5) < 0.3, `${conRespiro.valore.toFixed(1)} s`);
});

gruppo('Intervalli — le due note si ritagliano, non si spacca il tempo a metà', (t) => {
  // ⚠️ Il difetto: mediana sulle due metà TEMPORALI. Chi teneva la prima nota 5 secondi e
  // la seconda 1 aveva la «seconda metà» ancora dentro la prima nota: a una quinta esatta
  // l'app diceva «intervallo stretto». Qui la scena è ricostruita e si mostrano le due
  // letture fianco a fianco.
  const dt = 25;
  const partenza = 57;                       // La3
  const lunga = Array.from({ length: 200 }, () => partenza + 0.02);   // 5 s di La3
  const respiro = Array.from({ length: 8 }, () => null);
  const corta = Array.from({ length: 40 }, () => partenza + 7 + 0.02); // 1 s di Mi4
  const serieMidi = [...lunga, ...respiro, ...corta];

  const note = melodie.segmentaNote(serieMidi, dt, { minMs: 250 });
  t.uguale('si ritagliano due note', note.length, 2);
  const vNuovo = esercizi.giudicaIntervallo({
    centDiPartenza: (note[0].midi - partenza) * 100,
    centDiArrivo: (note[1].midi - partenza) * 100,
    semitoni: 7,
  });
  t.ok('la quinta esatta con la prima nota lunga viene promossa', vNuovo.promosso,
    `${vNuovo.titolo} — ${vNuovo.righe.join('')}`);

  // RED per costruzione: il vecchio metodo sulla stessa scena DEVE sbagliare.
  const tappa = serieMidi.map((v, i) => { let u = serieMidi.slice(0, i + 1).filter(Boolean).pop(); return (u - partenza) * 100; });
  const meta = Math.floor(tappa.length / 2);
  const mediana = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const vVecchio = esercizi.giudicaIntervallo({
    centDiPartenza: mediana(tappa.slice(0, meta)), centDiArrivo: mediana(tappa.slice(meta)), semitoni: 7,
  });
  t.ok('col metodo delle due metà il difetto si rivede', !vVecchio.promosso,
    `${vVecchio.titolo} — se questa prova un giorno passa, il metodo vecchio non era il problema`);
  t.misura('stessa quinta, due metodi',
    `ritaglio: ${vNuovo.titolo} · due metà: ${vVecchio.titolo}`);
});

gruppo('Livello — la barra non dice «non ti sento» a chi viene sentito', (t) => {
  const r = rilevatoreFinto();
  // ⚠️ Il fondo scala era −60 dBFS ma la soglia sente da −62: una nota UDITA mostrava
  // barra vuota, cioè il disegno contraddiceva la misura. La barra esiste per distinguere
  // «suono troppo piano» da «non capisce cosa suono»: se mente ai bordi non serve a niente.
  const pavimento = 0.0008;                        // il minimo assoluto della soglia
  t.ok('al pavimento della soglia la barra mostra già qualcosa',
    r.livello(pavimento) > 0.05, `livello ${r.livello(pavimento).toFixed(3)} a ${dbfs(pavimento).toFixed(1)} dBFS`);
  t.ok('e cresce monotona da lì in su',
    r.livello(0.0008) < r.livello(0.003) && r.livello(0.003) < r.livello(0.05));
  t.uguale('il silenzio assoluto resta a zero', r.livello(0), 0);
});

// ── Unità di misura e doppi tagli ────────────────────────────────────────────

gruppo('Melodie — l\'ambito si chiede in semitoni, non in gradi', (t) => {
  // ⚠️ Le due unità si somigliano abbastanza da scambiarle senza che niente esploda, ed è
  // successo: la zona comoda è in SEMITONI, l'ambito di `melodiaGenerata` in GRADI, e il
  // grado 8 della maggiore sta a QUATTORDICI semitoni dalla tonica. Con una zona comoda di
  // 8 semitoni la melodia chiedeva note sei semitoni sopra dove arrivi — l'esatto
  // contrario della promessa «le note te le do dove ci arrivi».
  t.uguale('8 semitoni contengono 4 gradi della maggiore (il 5° sta a 9)', melodie.gradiInSemitoni(8), 4);
  t.uguale('12 semitoni contengono 7 gradi (l\'ottava giusta)', melodie.gradiInSemitoni(12), 7);
  t.uguale('7 semitoni: 4 gradi (la quinta ci sta appena)', melodie.gradiInSemitoni(7), 4);
  t.uguale('2 semitoni: 1 grado', melodie.gradiInSemitoni(2), 1);
  t.misura('il vecchio scambio, in numeri',
    `zona comoda di 8 semitoni → ambito 8 GRADI → nota più alta possibile a +${melodie.gradoDi(0, 8)} semitoni`);

  const tonica = 55;
  const zonaSemitoni = 8;
  for (const seme of [1, 7, 42, 1234, 99999]) {
    const m = melodie.melodiaGenerata(tonica, { passi: 6, seme, ambito: melodie.gradiInSemitoni(zonaSemitoni) });
    t.ok(`seme ${seme}: con la conversione la melodia resta negli 8 semitoni della zona`,
      m.every((x) => x - tonica <= zonaSemitoni), m.map(nomeIt).join(' '));
  }
  // RED per costruzione: con lo scambio di prima almeno un seme DEVE sbordare.
  const sborda = [1, 7, 42, 1234, 99999].some((seme) => melodie
    .melodiaGenerata(tonica, { passi: 6, seme, ambito: zonaSemitoni })
    .some((x) => x - tonica > zonaSemitoni));
  t.ok('passando i semitoni come gradi (com\'era) qualche melodia sborda davvero',
    sborda, 'se nessuna sborda, la conversione non stava correggendo niente');
});

gruppo('Nota tenuta — l\'attacco si taglia una volta sola', (t) => {
  // ⚠️ `giudicaNotaTenuta` toglie i primi 400 ms (l'attacco), e `calo()` per conto suo ne
  // toglieva altri 500 — è pensato per serie intere. Due funzioni che si proteggono dallo
  // stesso difetto si sommano in un difetto nuovo: quasi un secondo di nota buttato, e la
  // durata dichiarata a schermo più corta del vero.
  const dt = 25;
  const cinqueSec = raccoltaFinta((s) => -10 * s, { n: 200, dtMs: dt });   // cala 10 cent/s
  const v = esercizi.giudicaNotaTenuta(cinqueSec);
  const riga = v.righe.find((r) => / in [\d.]+ s/.test(r)) || '';
  const durata = parseFloat((riga.match(/in ([\d.]+) s/) || [])[1]);
  t.ok('su 5 s di nota, la finestra del calo copre ~4,6 s (5 meno il solo attacco)',
    durata >= 4.4, `${durata} s — con il doppio taglio erano 4,1`);
  t.misura('durata dichiarata del calo su 5 s di voce', `${durata} s`);
  // E il calo riportato deve corrispondere alla pendenza vera sulla finestra vera.
  const cent = parseFloat((riga.match(/(−|\+)?([\d.]+) centesimi/) || [])[2]);
  t.ok('il calo riportato torna con pendenza × durata',
    Math.abs(cent - 10 * durata) < 4, `${cent} contro ${(10 * durata).toFixed(1)}`);
});

gruppo('Estensione — non dichiara note mai cantate', (t) => {
  // ⚠️ `grave` e `acuto` partivano già uguali alla nota di partenza PRIMA che fosse
  // cantata: chi falliva subito la prima nota in giù si trovava un «grave» mai cantato
  // dentro il risultato. La forma numero uno di questa famiglia — dichiarare ciò che non
  // si misura — vestita da inizializzazione innocua.
  let s = esercizi.estensioneInizio(57);
  t.uguale('prima di qualunque nota, il grave non esiste', s.grave, null);
  t.uguale('e nemmeno l\'acuto', s.acuto, null);

  // Fallisce la prima in giù, poi prende 58 e 59 salendo: il grave DEVE essere 58.
  s = esercizi.estensionePasso(s, 'no');
  t.uguale('fallita la prima, si riparte in su dalla nota sopra la partenza', s.corrente, 58);
  s = esercizi.estensionePasso(s, 'presa');
  s = esercizi.estensionePasso(s, 'presa');
  s = esercizi.estensionePasso(s, 'no');
  const r = esercizi.estensioneRiassunto(s);
  t.uguale('il grave è la prima nota DAVVERO presa (58), non la partenza mai cantata (57)',
    r.grave, 58);
  t.uguale('e l\'acuto è 59', r.acuto, 59);

  // Nessuna nota presa in assoluto: il riassunto lo dice, senza inventare numeri.
  let z = esercizi.estensioneInizio(57);
  z = esercizi.estensionePasso(z, 'no');
  z = esercizi.estensionePasso(z, 'no');
  const rz = esercizi.estensioneRiassunto(z);
  t.ok('zero note prese = «nessuna nota presa», non un intervallo inventato',
    rz.grave === null && !rz.attendibile && /nessuna/.test(rz.testo), rz.testo);

  // E la prima nota presa allarga ENTRAMBI i confini, qualunque sia il verso.
  let p = esercizi.estensioneInizio(57);
  p = esercizi.estensionePasso(p, 'presa');
  t.ok('la prima nota presa è insieme grave e acuto provvisori', p.grave === 57 && p.acuto === 57,
    JSON.stringify({ grave: p.grave, acuto: p.acuto }));
});

gruppo('Vibrato — anche la serie corta dichiara di non aver misurato', (t) => {
  // ⚠️ Il ramo «serie troppo corta» di `scomponi` non marcava `vibratoMisurabile: false`:
  // chi controllava quel campo non vedeva il caso e scriveva «voce ferma ±0» su una misura
  // mai fatta. Stesso buco della cadenza strozzata, porta diversa.
  const corto = scomponi([1, 2, 1, 2, 1], 25);
  t.uguale('serie corta: vibratoMisurabile è false, non undefined', corto.vibratoMisurabile, false);
  const vCorto = esercizi.giudicaNotaTenuta({ serie: Array.from({ length: 30 }, () => 3), dtMs: 25, dentro: 1 });
  t.ok('e il verdetto su una nota cortissima non scrive «voce ferma»',
    !/voce ferma/.test(vCorto.righe.join(' ')), vCorto.righe.join(' · '));
});

// ── Ripetizione spaziata ─────────────────────────────────────────────────────

gruppo('Ripasso — sbagliare riporta indietro, azzeccare dirada', (t) => {
  const ORA = 1000000;
  const GIORNO = 24 * 3600 * 1000;
  let s = ripasso.schedaNuova('int-7');
  t.uguale('una scheda nuova è dovuta subito', s.quando, 0);
  s = ripasso.rispondi(s, true, ORA);
  t.uguale('azzeccata una volta: domani', s.quando - ORA, 1 * GIORNO);
  s = ripasso.rispondi(s, true, ORA);
  t.uguale('due volte: fra tre giorni', s.quando - ORA, 3 * GIORNO);
  s = ripasso.rispondi(s, true, ORA);
  t.uguale('tre volte: fra una settimana', s.quando - ORA, 7 * GIORNO);
  s = ripasso.rispondi(s, false, ORA);
  t.uguale('sbagliata: si torna al primo gradino, cioè adesso', s.quando - ORA, 0);
  t.uguale('ma le viste restano contate', s.viste, 4);

  const schede = [
    { id: 'a', gradino: 3, quando: ORA - 5000, viste: 3, giuste: 3 },
    { id: 'b', gradino: 0, quando: ORA - 90000, viste: 1, giuste: 0 },
    { id: 'c', gradino: 2, quando: ORA + GIORNO, viste: 2, giuste: 2 },
    { id: 'd', gradino: 0, quando: 0, viste: 0, giuste: 0 },
  ];
  // ⚠️ Il difetto trovato qui: una scheda MAI vista ha `quando: 0`, quindi risultava la
  // più in ritardo di tutte e passava davanti a ogni ripasso vero. Il file dichiarava
  // «prima le scadute, poi le nuove» e il codice faceva l'opposto. Un ripasso scaduto ha
  // una fretta che una scheda nuova non ha: sta per essere dimenticato.
  t.uguale('si rivede prima quella più in ritardo, non quella mai vista',
    ripasso.prossima(schede, ORA).id, 'b');
  t.uguale('una scheda mai vista non conta come «da rivedere»',
    ripasso.daRivedere(schede, ORA).map((x) => x.id), ['b', 'a']);
  t.uguale('e quando non ce n\'è nessuna scaduta si insegna qualcosa di NUOVO',
    ripasso.prossima(schede.filter((x) => x.quando > ORA || x.viste === 0), ORA).id, 'd');
  // «Meno consolidato» = gradino più basso: b è al primo gradino, c al secondo, a al terzo.
  t.uguale('finiti anche i nuovi, si torna sul meno consolidato',
    ripasso.prossima(schede.filter((x) => x.viste > 0).map((x) => ({ ...x, quando: ORA + GIORNO })), ORA).id, 'b');
  t.ok('il consolidamento sta fra 0 e 1',
    ripasso.consolidamento(schede) > 0 && ripasso.consolidamento(schede) < 1,
    ripasso.consolidamento(schede).toFixed(2));
  t.uguale('senza schede non si inventa un numero', ripasso.consolidamento([]), 0);
});

// ── Il percorso ──────────────────────────────────────────────────────────────

gruppo('Percorso — i criteri d\'uscita sono misurati, non spuntati', (t) => {
  const vuoto = { sessioni: [], estensione: null, schede: [] };
  const o = percorso.oggi(vuoto);
  t.uguale('da zero, il primo gradino è la nota tenuta', o.prossimo.id, 'nota');
  t.uguale('e non è fatto niente', o.fatti, 0);

  // Il criterio è «di fila», non «almeno una volta»: venti tentativi di cui uno riuscito
  // non sono un gradino superato, e la differenza la può vedere solo l'app.
  const unaSola = { ...vuoto, sessioni: [{ esercizio: 'nota-tenuta', promosso: true }, { esercizio: 'nota-tenuta', promosso: false }] };
  t.uguale('una buona e una no: il gradino non è fatto', percorso.oggi(unaSola).prossimo.id, 'nota');
  const dueDiFila = { ...vuoto, sessioni: [{ esercizio: 'nota-tenuta', promosso: true }, { esercizio: 'nota-tenuta', promosso: true }, { esercizio: 'nota-tenuta', promosso: false }] };
  t.uguale('due buone di fila (le più recenti): fatto', percorso.oggi(dueDiFila).prossimo.id, 'estensione');

  const conEstensione = { ...dueDiFila, estensione: { grave: 48, acuto: 64, quando: 1 } };
  t.uguale('con l\'estensione misurata si passa al passaggio', percorso.oggi(conEstensione).prossimo.id, 'passaggio');
  const conPassaggio = { ...conEstensione, sessioni: [{ esercizio: 'passaggio', trovato: false }, ...conEstensione.sessioni] };
  t.uguale('e «non trovato» chiude comunque il gradino: è una risposta',
    percorso.oggi(conPassaggio).prossimo.id, 'attacco');

  const tuttiIGradini = percorso.GRADINI;
  t.ok('ogni gradino ha una rotta, un obiettivo e un criterio',
    tuttiIGradini.every((g) => g.rotta && g.obiettivo && typeof g.criterio === 'function'),
    tuttiIGradini.filter((g) => !g.rotta || !g.obiettivo).map((g) => g.id).join(', '));
  t.misura('i gradini del percorso', `${tuttiIGradini.length}: ${tuttiIGradini.map((g) => g.titolo).join(' · ')}`);

  // Il fiato chiede 12 secondi: sotto non basta, e il numero non è una pagella ma un
  // bersaglio che si sposta.
  const fiatoCorto = { ...vuoto, sessioni: [{ esercizio: 'fiato', secondi: 9 }] };
  const fiatoLungo = { ...vuoto, sessioni: [{ esercizio: 'fiato', secondi: 13 }] };
  t.ok('nove secondi di fiato non chiudono il gradino',
    !percorso.stato(fiatoCorto).find((g) => g.id === 'fiato').fatto);
  t.ok('tredici sì', percorso.stato(fiatoLungo).find((g) => g.id === 'fiato').fatto);
});

// ── esecuzione ───────────────────────────────────────────────────────────────

export async function esegui(suRisultato) {
  let totali = 0;
  let falliti = 0;
  for (const g of gruppi) {
    g.prove.length = 0;
    const t = contestoPer(g);
    try {
      g.fn(t);
      if (t.asincrono) await t.asincrono();
    } catch (e) {
      g.prove.push({ titolo: 'il gruppo è esploso', esito: false, dettaglio: String(e && e.stack ? e.stack : e) });
    }
    const suoiFalliti = g.prove.filter((p) => !p.esito).length;
    totali += g.prove.length;
    falliti += suoiFalliti;
    if (suRisultato) suRisultato(g, suoiFalliti);
  }
  return { totali, falliti, gruppi };
}

export { gruppi };
