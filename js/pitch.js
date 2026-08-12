// Rilevamento dell'altezza per l'accordatore.
//
// Due stadi, perché uno solo non basta sul telefono:
//   1. GROSSO — spettro dell'AnalyserNode + prodotto armonico (HPS). Individua la
//      fondamentale a ±6 Hz e, soprattutto, NON scambia il secondo armonico per la nota:
//      l'errore d'ottava è il modo classico in cui un accordatore fa accordare
//      benissimo la corda sbagliata.
//   2. FINE — autocorrelazione normalizzata in una finestra STRETTA attorno al candidato,
//      con interpolazione parabolica. Costa poco perché cerca solo lì, e dà la
//      risoluzione in centesimi che serve davvero (1 centesimo su La4 = 0,25 Hz).
//
// La FFT la fa il browser: la parte cara è già pagata.

const DB_MIN = -100;
const HZ_MIN = 70;      // sotto: rumore di stanza / bassi
const HZ_MAX = 1300;    // sopra: armonici, fischi
// Quanti armonici somma il pettine dell'HPS, e con che passo si cercano i candidati.
// Non sono gusti: il primo deve arrivare oltre la prima formante (700–800 Hz) anche per
// la voce più grave della banda — 800/70 ≈ 11 — e il secondo deve essere abbastanza fitto
// da non lasciare un candidato a mezza strada fra due, cioè molto sotto la larghezza di
// una casella alle frequenze basse (10,8 Hz a 98 Hz sono 180 centesimi). Entrambi sono
// scelti misurando: vedi il gruppo «Diagnosi» del collaudo.
const ARMONICI_HPS = 12;
const PASSO_CENT = 20;

// Soglie di livello. I due estremi non sono gusti: sotto il minimo assoluto c'è il
// rumore elettrico del convertitore anche a stanza muta, sopra il massimo una soglia
// così alta renderebbe l'accordatore sordo invece che prudente.
// I due numeri qui sotto arrivano dall'accordatore, dove erano tarati su una corda
// pizzicata — che è forte. Un mugolato a bocca chiusa sta 15–20 dB più giù, ed è il modo
// in cui questa app viene usata di più. Rifatti misurando le due popolazioni che la soglia
// deve separare (vedi il gruppo «Diagnosi — dove mettere il pavimento» del collaudo):
//
//   ① una stanza SENZA nessuno che canta non produce MAI una lettura di altezza: la
//      chiarezza dell'autocorrelazione sul rumore misura 0,06–0,08 contro un cancello a
//      0,55, in tutte e quattro le stanze provate (da −65 a −40 dBFS di rumore). Il vero
//      guardiano è quello, non la soglia sull'RMS. Una soglia alta non stava difendendo
//      da niente: stava solo rendendo l'app sorda.
//   ② il rilevatore legge il mugolato quando sta 3–5 dB sopra il rumore della stanza,
//      mentre un fattore 3,2 ne pretendeva 9,7. Sette dB buttati via per una difesa che
//      non serviva. Con il fattore 2,0 la richiesta scende a 4,8 dB, che è quello che
//      serve davvero.
//
// Guadagno misurato sul banco, livello più basso di mugolato riconosciuto:
//   cameretta di notte  −42 → −60 dBFS      con una ventola  −37 → −42 dBFS
//   stanza normale      −42 → −50 dBFS      stanza rumorosa  −30 → −34 dBFS
//
// ⚠️ Questi valori NON vanno riportati nell'ukulele e nella chitarra senza rimisurare lì:
// una corda pizzicata ha un decadimento lungo, e un pavimento più basso significa
// continuare a inseguire una corda che si sta spegnendo.
const RMS_MINIMO = 0.0008;      // ≈ −62 dBFS
const RMS_MASSIMO = 0.05;       // ≈ −26 dBFS
const SOPRA_IL_RUMORE = 2.0;    // ≈ +4,8 dB di voce sopra il rumore misurato
// Fondo scala della barra: DEVE stare sotto il pavimento della soglia (−62 dBFS), non
// sopra. Con il fondo a −60, un mugolato a −61 che l'app sentiva benissimo mostrava barra
// vuota: il disegno diceva «non ti sento» mentre la misura funzionava — e la barra esiste
// proprio per distinguere «suono troppo piano» da «non capisce cosa suono».
const LIVELLO_DB_MIN = -70;
const LIVELLO_DB_MAX = -12;     // oltre: forte, e vicino a saturare
// Finestra su cui si cerca il rumore di fondo: 20 blocchi da 10 letture. Il ciclo
// dell'accordatore gira ogni 25 ms, quindi sono 5 secondi — più lunghi di una pennata,
// che è il requisito che conta.
const LETTURE_PER_BLOCCO = 10;
const BLOCCHI = 20;

export class Rilevatore {
  constructor(analyser) {
    this.analyser = analyser;
    this.sr = analyser.context.sampleRate;
    this.tempo = new Float32Array(analyser.fftSize);
    this.spettro = new Float32Array(analyser.frequencyBinCount);
    this.storico = [];
    this.sogliaRms = RMS_MINIMO;
    this.sogliaChiarezza = 0.55;
    // I due numeri dell'HPS. Sono proprietà e non costanti murate perché il banco di
    // collaudo li deve poter spazzolare: il valore giusto si sceglie guardando quale
    // candidato vince al variare del numero, non a naso. Vedi `_hps`.
    this.armonici = ARMONICI_HPS;
    this.passoCent = PASSO_CENT;
    this.grigliaCaselle = false;
    // Anche i tre numeri della soglia stanno qui e non murati nel corpo di `soglia()`:
    // il pavimento giusto per una voce che canticchia non è quello di una corda pizzicata,
    // e la differenza si sceglie spazzolando i valori sulle due popolazioni (mugolato
    // piano / solo rumore), non decidendola.
    this.rmsMinimo = RMS_MINIMO;
    this.rmsMassimo = RMS_MASSIMO;
    this.sopraIlRumore = SOPRA_IL_RUMORE;
    // Stima del rumore della stanza. Parte da "non lo so ancora": finché non lo sa, si
    // comporta esattamente come prima.
    this.pavimento = null;
    this._blocchi = [];
    this._minBlocco = Infinity;
    this._nelBlocco = 0;
  }

  /**
   * La soglia sotto la quale si dichiara silenzio, ADATTATA alla stanza.
   *
   * Prima era un numero fisso, 0,006 di RMS — circa −44 dBFS — e il numero fisso era il
   * difetto, non il valore. Sbagliava in tutte e due le direzioni:
   *
   *   in una stanza silenziosa, con una pennata leggera o il telefono lontano, il segnale
   *     non arrivava a 0,006 e l'app diceva "silenzio" a chi stava suonando davvero;
   *   in una stanza con una ventola o il traffico, il RUMORE arrivava a 0,006 e l'app
   *     provava a misurare l'altezza del nulla.
   *
   * Adesso la soglia sta un fattore fisso SOPRA il rumore misurato. Due limiti la
   * tengono onesta: non scende mai sotto il minimo assoluto (in una stanza perfettamente
   * silenziosa il pavimento tende a zero, e una soglia a zero accetterebbe qualunque
   * fruscio), e non sale mai sopra il massimo (una stanza molto rumorosa renderebbe
   * l'accordatore sordo invece che prudente — meglio provarci e sbagliare in modo
   * visibile che tacere).
   */
  soglia(pavimento = this.pavimento) {
    if (pavimento === null) return this.rmsMinimo;
    return Math.min(this.rmsMassimo, Math.max(this.rmsMinimo, pavimento * this.sopraIlRumore));
  }

  /**
   * Aggiorna la stima del rumore di fondo. Si chiama SOLO sui fotogrammi in cui non è
   * stata riconosciuta nessuna nota, e quella condizione è la cosa importante di tutta
   * questa storia — più della formula qui dentro.
   *
   * Il primo tentativo aggiornava il pavimento a ogni lettura, e sembrava ragionevole.
   * Non lo è: una corda pizzicata si spegne piano, per secondi, e un pavimento nutrito
   * anche mentre la corda suona finisce per inseguire la corda. La soglia sta un fattore
   * sopra il pavimento, quindi finisce sopra il segnale, e l'app dichiara silenzio su una
   * nota che si sente ancora benissimo. Misurato sullo stesso decadimento: dichiarata
   * muta in 123 letture su 160 aggiornando sempre, contro 68 aggiornando solo quando non
   * c'è nota — e quelle 68 sono esattamente le letture in cui il segnale era sceso sotto
   * il minimo assoluto, cioè lo stesso identico comportamento della soglia fissa di
   * prima. Un pavimento del rumore va misurato sul rumore, non sul suono.
   *
   * Dentro quel vincolo, la formula è il MINIMO su una finestra invece del minimo
   * istantaneo: così un singolo fotogramma tranquillo in mezzo al rumore non abbassa la
   * stima, e un ronzio che dura più della finestra la alza — come deve, perché quello è
   * davvero il rumore della stanza.
   *
   * La finestra si conta in LETTURE, non in secondi, e non è una scorciatoia: il ciclo
   * dell'accordatore gira a cadenza fissa (25 ms), quindi contare le letture è contare
   * il tempo, e per giunta rende la cosa riproducibile sul banco di collaudo, dove non
   * c'è nessun orologio da aspettare.
   */
  _aggiornaPavimento(rms) {
    this._minBlocco = Math.min(this._minBlocco, rms);
    this._nelBlocco += 1;
    if (this._nelBlocco >= LETTURE_PER_BLOCCO) {
      this._blocchi.push(this._minBlocco);
      if (this._blocchi.length > BLOCCHI) this._blocchi.shift();
      this._minBlocco = Infinity;
      this._nelBlocco = 0;
    }
    // Finché non c'è nemmeno un blocco chiuso non si inventa una stima: `soglia()`
    // restituisce il minimo assoluto, cioè esattamente il comportamento di prima.
    this.pavimento = this._blocchi.length ? Math.min(...this._blocchi) : null;
  }

  /**
   * Quanto forte sta arrivando il segnale, da 0 a 1, per la barra del livello.
   *
   * Serve a rispondere alla domanda che l'app non permetteva di farsi: "non mi sente
   * perché suono piano, o perché non capisce quello che suono?" Sono due problemi con
   * due rimedi opposti, e senza questo numero erano indistinguibili.
   */
  livello(rms) {
    const dB = 20 * Math.log10(Math.max(rms, 1e-7));
    return Math.max(0, Math.min(1, (dB - LIVELLO_DB_MIN) / (LIVELLO_DB_MAX - LIVELLO_DB_MIN)));
  }

  /** @returns {{hz:number|null, chiarezza:number, rms:number, livello:number, soglia:number, silenzio:boolean}} */
  leggi() {
    const { analyser, tempo, spettro } = this;
    analyser.getFloatTimeDomainData(tempo);

    let somma = 0;
    let media = 0;
    for (let i = 0; i < tempo.length; i += 1) media += tempo[i];
    media /= tempo.length;
    for (let i = 0; i < tempo.length; i += 1) {
      const v = tempo[i] - media;
      tempo[i] = v;
      somma += v * v;
    }
    const rms = Math.sqrt(somma / tempo.length);
    const soglia = this.soglia();
    const livello = this.livello(rms);
    // Il pavimento si aggiorna solo dove NON c'è una nota: ogni `return` senza `hz` passa
    // di qui, quello con `hz` no. Vedi `_aggiornaPavimento` per il motivo.
    const senzaNota = (esito) => { this._aggiornaPavimento(rms); return esito; };

    if (rms < soglia) {
      this.storico.length = 0;
      return senzaNota({ hz: null, chiarezza: 0, rms, livello, soglia, silenzio: true });
    }

    analyser.getFloatFrequencyData(spettro);
    const grezzo = this._hps(spettro);
    if (!grezzo) return senzaNota({ hz: null, chiarezza: 0, rms, livello, soglia, silenzio: false });

    const fine = this._autocorrelazione(grezzo);
    if (!fine || fine.chiarezza < this.sogliaChiarezza) {
      return senzaNota({ hz: null, chiarezza: fine ? fine.chiarezza : 0, rms, livello, soglia, silenzio: false });
    }

    const stabile = this._stabilizza(fine.hz);
    return { hz: stabile, chiarezza: fine.chiarezza, rms, livello, soglia, silenzio: false };
  }

  /**
   * Candidato grossolano: massimo del prodotto armonico dello spettro.
   *
   * La fondamentale pesa DOPPIO, e non è un dettaglio estetico. Con tutti gli armonici
   * a peso uguale, su un suono quasi puro (diapason, nota di riferimento, armonico
   * naturale) i candidati f, f/2, f/3 e f/4 ottengono lo stesso punteggio — in ognuno
   * c'è un solo termine vero e tre a fondo scala — e vince il più basso: misurato
   * 87 Hz su un Do4 di 261,63. Contando due volte la casella della presunta
   * fondamentale, il candidato che ha davvero energia nel proprio bin vince.
   *
   * I CANDIDATI NON SONO LE CASELLE DELLA FFT, e non è un raffinamento: è la correzione
   * di un difetto misurato. Provando il rilevatore su una voce che canta «a» su un Si2
   * (123,47 Hz) il candidato usciva a 248 Hz — l'ottava sopra — e ci restava con
   * QUALUNQUE numero di armonici sommati. Il motivo è che 123,47 non cade su una casella:
   * a 44,1 kHz con finestra 4096 le caselle valgono 10,77 Hz e la nota sta a metà fra la
   * 11ª e la 12ª. Un pettine piantato sulla casella 11 cerca i suoi armonici a
   * 118, 237, 355… mentre quelli veri stanno a 123, 247, 370: al sesto armonico è sbagliato
   * di una casella piena e non trova più niente. Il pettine dell'ottava sopra invece si
   * allineava per fortuna, e vinceva. Cercando su una griglia LOGARITMICA di 20 centesimi
   * e leggendo lo spettro interpolato fra le caselle, il pettine sta sempre dove deve, e
   * per giunta costa meno: 180 candidati invece di 115, ma senza il difetto.
   *
   * Il numero di armonici sommati (`this.armonici`) è l'altro pezzo dello stesso difetto:
   * quattro bastavano su un ukulele, che parte da 240 Hz, ma su una voce grave la prima
   * formante — dove sta l'energia — è la sesta o la settima armonica, e un candidato che
   * arriva solo alla quarta non la vede mentre quello all'ottava sopra sì.
   */
  _hps(db) {
    const binHz = this.sr / this.analyser.fftSize;
    const val = (j) => {
      const v = db[j];
      return Number.isFinite(v) ? Math.max(DB_MIN, v) : DB_MIN;
    };
    // Lettura dello spettro a una frequenza qualunque, interpolando fra le due caselle
    // vicine: è quello che permette al pettine di stare su frequenze che non sono caselle.
    const valHz = (hz) => {
      const x = hz / binHz;
      const i = Math.floor(x);
      if (i < 1 || i + 1 >= db.length) return DB_MIN;
      const f = x - i;
      return val(i) * (1 - f) + val(i + 1) * f;
    };
    // La griglia dei candidati. Quella vera è logaritmica; quella sulle sole caselle della
    // FFT esiste solo perché il collaudo possa rimettere il difetto al suo posto e vederlo
    // ricomparire — un fix che non si sa far fallire non si sa nemmeno se funziona.
    const candidati = [];
    if (this.grigliaCaselle) {
      for (let i = Math.max(1, Math.floor(HZ_MIN / binHz)); i * binHz <= HZ_MAX; i += 1) candidati.push(i * binHz);
    } else {
      const passo = 2 ** (this.passoCent / 1200);
      for (let hz = HZ_MIN; hz <= HZ_MAX; hz *= passo) candidati.push(hz);
    }
    let migliore = -Infinity;
    let vincitore = -1;
    for (const hz of candidati) {
      let punteggio = valHz(hz);                    // peso doppio: qui e nel ciclo sotto
      for (let k = 1; k <= this.armonici; k += 1) {
        const f = hz * k;
        if (f > this.sr / 2) break;
        punteggio += valHz(f);
      }
      if (punteggio > migliore) { migliore = punteggio; vincitore = hz; }
    }
    return vincitore > 0 ? vincitore : null;
  }

  /** Raffinamento: correlazione normalizzata nei dintorni del candidato. */
  _autocorrelazione(hzCandidato) {
    const { tempo, sr } = this;
    const lagIdeale = sr / hzCandidato;
    const lagMin = Math.max(8, Math.floor(lagIdeale / 1.35));
    const lagMax = Math.min(Math.floor(sr / HZ_MIN), Math.ceil(lagIdeale * 1.35));
    if (lagMax <= lagMin + 2) return null;

    const finestra = Math.min(2048, tempo.length - lagMax - 1);
    if (finestra < 256) return null;

    let energia0 = 0;
    for (let i = 0; i < finestra; i += 1) energia0 += tempo[i] * tempo[i];
    if (energia0 <= 0) return null;

    const curva = new Float32Array(lagMax - lagMin + 1);
    let miglioreVal = -Infinity;
    let miglioreLag = -1;
    for (let lag = lagMin; lag <= lagMax; lag += 1) {
      let cross = 0;
      let energia = 0;
      for (let i = 0; i < finestra; i += 1) {
        const b = tempo[i + lag];
        cross += tempo[i] * b;
        energia += b * b;
      }
      const norm = energia > 0 ? cross / Math.sqrt(energia0 * energia) : 0;
      curva[lag - lagMin] = norm;
      if (norm > miglioreVal) { miglioreVal = norm; miglioreLag = lag; }
    }
    if (miglioreLag < 0) return null;

    // Qui NON c'è un controllo di sotto-ottava, e non per dimenticanza: la finestra di
    // ricerca è ±35% attorno al candidato, quindi il doppio del periodo cade sempre
    // fuori e un controllo del genere non potrebbe mai scattare — sarebbe una rassicurazione
    // finta. L'errore d'ottava lo previene lo stadio grosso, che guarda tutti gli armonici.

    // Interpolazione parabolica sul picco: senza, la risoluzione è un campione
    // (su La4 a 48 kHz vale ~8 centesimi, cioè un accordatore che mente di poco).
    const i0 = miglioreLag - lagMin;
    let lag = miglioreLag;
    if (i0 > 0 && i0 < curva.length - 1) {
      const y1 = curva[i0 - 1];
      const y2 = curva[i0];
      const y3 = curva[i0 + 1];
      const den = 2 * (2 * y2 - y1 - y3);
      if (den !== 0) lag += (y3 - y1) / den;
    }
    const hz = this.sr / lag;
    if (hz < HZ_MIN || hz > HZ_MAX) return null;
    return { hz, chiarezza: Math.max(0, Math.min(1, miglioreVal)) };
  }

  /** Mediana su 5 letture: uccide il singolo campione impazzito senza aggiungere ritardo percepibile. */
  _stabilizza(hz) {
    this.storico.push(hz);
    if (this.storico.length > 5) this.storico.shift();
    const ord = [...this.storico].sort((a, b) => a - b);
    const mediana = ord[Math.floor(ord.length / 2)];
    // Scarta il salto assurdo (dito che tocca la corda, colpo sulla cassa)
    if (Math.abs(hz - mediana) / mediana > 0.12) return mediana;
    return hz;
  }
}

// ── Note e centesimi ─────────────────────────────────────────────────────────

export const NOMI = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Numero MIDI (frazionario) di una frequenza, dato il La4 di riferimento. */
export function midiDaHz(hz, la4 = 440) {
  return 69 + 12 * Math.log2(hz / la4);
}

export function hzDaMidi(midi, la4 = 440) {
  return la4 * 2 ** ((midi - 69) / 12);
}

/** Nota più vicina + scarto in centesimi. */
export function nota(hz, la4 = 440) {
  const m = midiDaHz(hz, la4);
  const intero = Math.round(m);
  return {
    midi: intero,
    nome: NOMI[((intero % 12) + 12) % 12],
    ottava: Math.floor(intero / 12) - 1,
    centesimi: (m - intero) * 100,
  };
}

/** Centesimi fra la lettura e una frequenza bersaglio. */
export function centesimi(hz, bersaglio) {
  return 1200 * Math.log2(hz / bersaglio);
}

// ── Le due decisioni dell'accordatore ────────────────────────────────────────
//
// Stanno qui, fuori dalla vista e senza DOM, perché sono le due che hanno sbagliato:
// una funzione pura si può mettere sotto collaudo, un ramo dentro un ciclo di disegno no.

/**
 * Cosa mostrare, dato lo stato del microfono.
 *
 * Il caso che è sfuggito è il terzo: né una nota né silenzio, ma RUMORE — la corda che
 * ronza mentre giri la chiave. L'azzeramento stava dentro il ramo del silenzio, quindi
 * lì il display restava congelato sull'ultima misura e continuava a dire "A POSTO"
 * all'infinito, mentre non stava misurando niente.
 *
 * @returns {'misura'|'tenuta'|'azzera-silenzio'|'azzera-rumore'}
 */
export function decisioneDisplay({ hz, silenzio, ultimaDa, tenutaMs }) {
  if (hz) return 'misura';
  if (ultimaDa !== null && ultimaDa < tenutaMs) return 'tenuta';
  return silenzio ? 'azzera-silenzio' : 'azzera-rumore';
}

/**
 * Quanti millisecondi, nell'ultima finestra, la corda è stata dentro tolleranza.
 *
 * Serve al posto di "ininterrottamente per 700 ms", che sembrava ragionevole ed era
 * quasi irraggiungibile: una corda di nylon pizzicata parte crescente e cala mentre
 * si spegne, quindi attraversa la soglia più volte in un secondo. Bastava un singolo
 * campione fuori e il conteggio ripartiva da zero — la corda non veniva mai dichiarata
 * accordata, e il passo del percorso non si chiudeva mai.
 *
 * Qui invece si SOMMA il tempo passato dentro nell'ultima finestra: gli attraversamenti
 * non azzerano niente, e una corda davvero intonata accumula in fretta.
 *
 * @param {Array<{t:number, dentro:boolean}>} campioni potato sul posto
 * @returns {number} millisecondi dentro tolleranza
 */
export function msDentroFinestra(campioni, ora, durataFinestra) {
  while (campioni.length && ora - campioni[0].t > durataFinestra) campioni.shift();
  let totale = 0;
  for (let i = 1; i < campioni.length; i += 1) {
    if (campioni[i - 1].dentro) totale += campioni[i].t - campioni[i - 1].t;
  }
  return totale;
}

/**
 * Se togliere la spunta a una corda già dichiarata accordata.
 *
 * Prima non si toglieva mai: bastava che una corda fosse stata a posto una volta e
 * restava verde anche calata di mezzo semitono, fino a dichiarare "tutte a posto" su
 * uno strumento scordato. La soglia per uscire è più larga di quella per entrare,
 * altrimenti sul confine la spunta lampeggerebbe.
 */
export function spuntaDaTogliere({ giaFatta, scarto, tolleranzaUscita, aggancio = 200 }) {
  if (!giaFatta) return false;
  // Oltre un certo scarto non è più quella corda che sta suonando: è un'altra, presa
  // per questa dal riconoscimento automatico mentre giravi la sua chiave. Toglierle la
  // spunta sarebbe punire la corda sbagliata — ed è il motivo per cui, accordando la
  // quarta, ogni tanto ne saltava via una già fatta.
  if (Math.abs(scarto) > aggancio) return false;
  return Math.abs(scarto) > tolleranzaUscita;
}
