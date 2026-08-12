// Il microfono: apertura, ciclo di lettura, e la raccolta di una nota tenuta.
//
// Una cosa sola che non è ovvia: i tre interruttori di getUserMedia vanno SPENTI.
// Il controllo automatico del guadagno alza il piano e abbassa il forte, quindi rovina la
// misura del livello (e l'esercizio del fiato, che sul livello si regge); la soppressione
// del rumore è un filtro adattivo che sulla voce tenuta può fare cose strane; la
// cancellazione dell'eco esiste per la telefonata e qui non serve a niente.
// Non tutti i telefoni obbediscono: `stato()` dice cosa è stato davvero applicato, così
// `prova-zero.html` può dirlo invece di lasciarlo credere.

import { Rilevatore, centesimi, midiDaHz } from './pitch.js';
import * as audio from './audio.js';

const PASSO_MS = 25;
const dbfs = (rms) => 20 * Math.log10(Math.max(rms, 1e-9));

export class Ascolto {
  constructor() {
    this.ctx = null;
    this.flusso = null;
    this.analizzatore = null;
    this.rilevatore = null;
    this.giro = null;
    this.ultima = null;
  }

  async apri() {
    if (this.flusso) return this.stato();
    this.flusso = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    // Il contesto è QUELLO dell'app, non uno nuovo: su iPhone un secondo contesto creato
    // fuori da un gesto resta sospeso per sempre — analizzatore a zero, app sorda, nessun
    // errore. Vedi il commento su `contesto()` in audio.js. Qui si prova comunque a
    // sbloccarlo, ma la ripresa che CONTA è quella dentro i gestori dei pulsanti.
    this.ctx = audio.contesto();
    await audio.sblocca();
    this._sorgente = this.ctx.createMediaStreamSource(this.flusso);
    this.analizzatore = this.ctx.createAnalyser();
    this.analizzatore.fftSize = 4096;
    this.analizzatore.smoothingTimeConstant = 0;
    this._sorgente.connect(this.analizzatore);
    this.rilevatore = new Rilevatore(this.analizzatore);
    return this.stato();
  }

  stato() {
    const t = this.flusso && this.flusso.getAudioTracks()[0];
    const s = t && t.getSettings ? t.getSettings() : {};
    return {
      aperto: !!this.flusso,
      campionamento: this.ctx ? this.ctx.sampleRate : null,
      guadagnoAuto: s.autoGainControl,
      soppressione: s.noiseSuppression,
      microfono: t ? t.label : null,
    };
  }

  /** Il pavimento del rumore riparte da zero: la stanza di dieci minuti fa non è questa. */
  dimenticaLaStanza() {
    if (this.analizzatore) this.rilevatore = new Rilevatore(this.analizzatore);
  }

  /**
   * Ascolta per `ms`, chiamando `suLettura` a ogni giro (per la barra del livello).
   *
   * @param {number|null} bersaglioHz frequenza rispetto a cui contare i centesimi
   * @returns {Promise<{serie:number[], grezze:object[], dtMs:number, dentro:number}>}
   *   `serie` sono i centesimi (con i buchi tappati dall'ultimo valore buono, perché
   *   l'autocorrelazione del vibrato vuole un passo costante), `dentro` è la frazione di
   *   letture in cui una nota c'era davvero.
   */
  raccogli(bersaglioHz, ms, suLettura = null, { conTimbro = false, fermaDopoSilenzioMs = 0 } = {}) {
    return new Promise((risolvi) => {
      const grezze = [];
      const inizio = performance.now();
      let ultimaVoceT = null;
      clearInterval(this.giro);
      this.giro = setInterval(() => {
        const l = this.rilevatore.leggi();
        const t = performance.now() - inizio;
        this.ultima = l;
        grezze.push({
          t, hz: l.hz, rms: l.rms, livello: l.livello, silenzio: l.silenzio,
          brillantezza: conTimbro && l.hz ? this._brillantezza(l.hz) : null,
        });
        if (l.hz) ultimaVoceT = t;
        if (suLettura) suLettura(l, t / ms);
        // Chiusura anticipata sul silenzio: serve al fiato, dove la finestra è di 32
        // secondi. Senza, chi molla la nota dopo otto resta a fissare lo schermo per
        // altri ventiquattro — e un esercizio che ti fa aspettare il nulla è un esercizio
        // che non rifai. Scatta solo DOPO aver sentito una voce: il silenzio prima che tu
        // parta è attesa, non fine.
        const finita = fermaDopoSilenzioMs > 0 && ultimaVoceT !== null
          && t - ultimaVoceT >= fermaDopoSilenzioMs;
        if (t >= ms || finita) {
          clearInterval(this.giro);
          this.giro = null;
          risolvi(this._impacchetta(grezze, bersaglioHz));
        }
      }, PASSO_MS);
    });
  }

  /**
   * Ascolta finché non arriva una nota stabile, o finché scade il tempo.
   *
   * «Stabile» si conta in MILLISECONDI, non in numero di letture, e la differenza è un
   * difetto vero trovato guidando l'app: un browser che tiene la pagina in secondo piano
   * strozza `setInterval` da 25 ms a 1000, quindi «venti letture» passa da mezzo secondo
   * a venti secondi e l'app dice «non ti ho sentito» a uno che sta cantando benissimo.
   * È la stessa lezione che nell'ukulele era costata il conteggio delle battute su
   * requestAnimationFrame: si conta il tempo, non i giri del ciclo.
   */
  aspettaUnaNota(msMassimi = 6000, suLettura = null, msStabile = 500) {
    return new Promise((risolvi) => {
      const inizio = performance.now();
      let stabileDa = null;
      let ultimoHz = null;
      clearInterval(this.giro);
      this.giro = setInterval(() => {
        const l = this.rilevatore.leggi();
        const ora = performance.now();
        this.ultima = l;
        if (suLettura) suLettura(l);
        if (l.hz) {
          // Il primo istante di una nota cantata è ancora un glissando: si aspetta che
          // stia ferma entro un semitono, non che esista.
          if (ultimoHz && Math.abs(centesimi(l.hz, ultimoHz)) < 100) {
            if (stabileDa === null) stabileDa = ora;
          } else stabileDa = null;
          ultimoHz = l.hz;
        } else { stabileDa = null; ultimoHz = null; }
        if (stabileDa !== null && ora - stabileDa >= msStabile) {
          clearInterval(this.giro); this.giro = null; risolvi(ultimoHz); return;
        }
        if (ora - inizio > msMassimi) {
          clearInterval(this.giro); this.giro = null; risolvi(null);
        }
      }, PASSO_MS);
    });
  }

  /**
   * Il baricentro dello spettro diviso la fondamentale: quanto è «brillante» il suono.
   *
   * È il numero che vede il cambio di TIMBRO, che è la metà non ovvia del passaggio di
   * registro (l'altra metà è il livello). Diviso per la fondamentale, e non in Hz assoluti,
   * perché altrimenti misurerebbe soprattutto il fatto che stai salendo: un La4 ha il
   * baricentro più in alto di un La3 anche a timbro identico.
   */
  _brillantezza(hz) {
    if (!this._spettro) this._spettro = new Float32Array(this.analizzatore.frequencyBinCount);
    this.analizzatore.getFloatFrequencyData(this._spettro);
    const binHz = this.ctx.sampleRate / this.analizzatore.fftSize;
    const primo = Math.max(1, Math.floor(60 / binHz));
    const ultimo = Math.min(this._spettro.length - 1, Math.ceil(5000 / binHz));
    let peso = 0;
    let somma = 0;
    for (let i = primo; i <= ultimo; i += 1) {
      const db = this._spettro[i];
      if (!Number.isFinite(db) || db < -90) continue;
      const a = 10 ** (db / 20);
      peso += a;
      somma += a * i * binHz;
    }
    return peso > 0 ? (somma / peso) / hz : null;
  }

  _impacchetta(grezze, bersaglioHz) {
    const conNota = grezze.filter((g) => g.hz);
    const riferimento = bersaglioHz || (conNota.length
      ? conNota.map((g) => g.hz).sort((a, b) => a - b)[Math.floor(conNota.length / 2)]
      : null);
    let ultimo = null;
    const serie = [];
    for (const g of grezze) {
      if (g.hz && riferimento) ultimo = centesimi(g.hz, riferimento);
      if (ultimo !== null) serie.push(ultimo);
    }
    const dt = grezze.length > 1 ? (grezze[grezze.length - 1].t - grezze[0].t) / (grezze.length - 1) : PASSO_MS;
    return {
      serie,
      // La stessa serie ma CON i buchi, come null. La differenza non è un dettaglio:
      // `serie` tappa i buchi con l'ultimo valore buono perché l'autocorrelazione del
      // vibrato vuole un passo costante — ma una misura di DURATA letta sulla serie
      // tappata conta il silenzio come nota. È successo: il fiato di una nota da 5
      // secondi seguita da 27 di silenzio usciva 32, perché l'ultimo valore restava
      // "dentro tolleranza" fino a fine finestra. Chi misura durate legge QUESTA.
      serieBuchi: grezze.map((g) => (g.hz && riferimento ? centesimi(g.hz, riferimento) : null)),
      grezze,
      dtMs: dt,
      riferimento,
      dentro: grezze.length ? conNota.length / grezze.length : 0,
      // Le altezze in numero MIDI, per gli esercizi a più note (scale, melodie), e le
      // letture complete per quello del passaggio di registro. La serie in centesimi non
      // basta lì: serve sapere DOVE stavi, non solo quanto eri distante dal bersaglio.
      // Con i BUCHI dentro, come `null`: fra una nota e l'altra di una scala il microfono
      // non sente niente, e tapparli con l'ultimo valore buono unirebbe due note uguali in
      // una sola. Qui il silenzio è un'informazione, non un guasto da nascondere.
      serieMidi: grezze.map((g) => (g.hz ? midiDaHz(g.hz) : null)),
      letture: conNota.map((g) => ({
        tMs: g.t, midi: midiDaHz(g.hz), dbfs: dbfs(g.rms), brillantezza: g.brillantezza,
      })),
    };
  }

  ferma() { clearInterval(this.giro); this.giro = null; }

  chiudi() {
    this.ferma();
    if (this.flusso) this.flusso.getTracks().forEach((t) => t.stop());
    // Il contesto NON si chiude: è quello condiviso dell'app, e chiuderlo qui
    // ammutolirebbe anche la nota di riferimento. Si stacca solo il proprio ramo.
    if (this._sorgente) { try { this._sorgente.disconnect(); } catch { /* già staccata */ } }
    this.flusso = null; this._sorgente = null; this.analizzatore = null; this.rilevatore = null;
  }
}

export { PASSO_MS };
