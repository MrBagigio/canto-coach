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

import { Rilevatore, centesimi, nota } from './pitch.js';
import {
  TIMBRI, armonicheVoce, armonicheStrumento, banco, attendi, contestoPronto, rmsDiParziali, dbfs,
} from './banco.js';
import { scomponi, retta, calo } from './vibrato.js';

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
