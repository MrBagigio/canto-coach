// Il microfono: apertura, ciclo di lettura, e la raccolta di una nota tenuta.
//
// Una cosa sola che non è ovvia: i tre interruttori di getUserMedia vanno SPENTI.
// Il controllo automatico del guadagno alza il piano e abbassa il forte, quindi rovina la
// misura del livello (e l'esercizio del fiato, che sul livello si regge); la soppressione
// del rumore è un filtro adattivo che sulla voce tenuta può fare cose strane; la
// cancellazione dell'eco esiste per la telefonata e qui non serve a niente.
// Non tutti i telefoni obbediscono: `stato()` dice cosa è stato davvero applicato, così
// `prova-zero.html` può dirlo invece di lasciarlo credere.

import { Rilevatore, centesimi } from './pitch.js';

const PASSO_MS = 25;

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
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume().catch(() => {});
    const sorgente = this.ctx.createMediaStreamSource(this.flusso);
    this.analizzatore = this.ctx.createAnalyser();
    this.analizzatore.fftSize = 4096;
    this.analizzatore.smoothingTimeConstant = 0;
    sorgente.connect(this.analizzatore);
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
  raccogli(bersaglioHz, ms, suLettura = null) {
    return new Promise((risolvi) => {
      const grezze = [];
      const inizio = performance.now();
      clearInterval(this.giro);
      this.giro = setInterval(() => {
        const l = this.rilevatore.leggi();
        const t = performance.now() - inizio;
        this.ultima = l;
        grezze.push({ t, hz: l.hz, rms: l.rms, livello: l.livello, silenzio: l.silenzio });
        if (suLettura) suLettura(l, t / ms);
        if (t >= ms) {
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
      grezze,
      dtMs: dt,
      riferimento,
      dentro: grezze.length ? conNota.length / grezze.length : 0,
    };
  }

  ferma() { clearInterval(this.giro); this.giro = null; }

  chiudi() {
    this.ferma();
    if (this.flusso) this.flusso.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.flusso = null; this.ctx = null; this.analizzatore = null; this.rilevatore = null;
  }
}

export { PASSO_MS };
