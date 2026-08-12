// L'app: navigazione e schermate.
//
// Un motore solo per tutti gli esercizi (`giro()`), perché sono tutti la stessa cosa con
// parametri diversi: l'app dà una nota → TACE → tu canti → l'app misura → dice cosa ha
// misurato. L'alternanza non è una scelta di interfaccia, è la ragione per cui la misura
// è onesta (§0 dell'AVVIO), e sta scritta in un posto solo così non può divergere fra una
// schermata e l'altra.

import * as audio from './audio.js';
import * as store from './store.js';
import { Ascolto } from './ascolto.js';
import { nome, hz, midiVicino, INTERVALLI, MIDI_MIN, MIDI_MAX } from './teoria.js';
import {
  TOLLERANZA, zonaComoda, zonaDaUnaNota, notaDaDare, notaPresa,
  giudicaNotaTenuta, giudicaAttacco, giudicaIntervallo, giudicaFiato,
  giudicaAgilita, giudicaMelodia, trovaPassaggio, giudicaPassaggio,
  estensioneInizio, estensionePasso, estensioneRiassunto,
} from './esercizi.js';
import { scalaAgilita, melodiaGenerata, segmentaNote, confrontaSequenza } from './melodie.js';
import { rispondi, prossima, daRivedere, consolidamento } from './ripasso.js';
import { oggi } from './percorso.js';

const app = document.getElementById('app');
let ascolto = null;
let pulizia = null;

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Quanto si aspetta dopo che la nota di riferimento è finita, prima di credere al
 * microfono.
 *
 * Non è prudenza generica: l'analizzatore restituisce una finestra di 4096 campioni, cioè
 * 93 ms di passato. Cominciare a misurare nell'istante in cui l'oscillatore si ferma vuol
 * dire misurare una finestra che contiene ancora la nota dell'app, uscita
 * dall'altoparlante e rientrata nel microfono — e l'app si darebbe da sola la risposta.
 * 300 ms sono la coda dell'inviluppo più una finestra piena più il volo nell'aria.
 */
const DOPO_LA_NOTA_MS = 300;

// ── attrezzi di disegno ──────────────────────────────────────────────────────

function el(tag, className, testo) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (testo != null) e.textContent = testo;
  return e;
}

function schermata(titolo, sottotitolo) {
  app.replaceChildren();
  const h = el('header', 'testa');
  const b = el('button', 'indietro', '‹ indietro');
  b.addEventListener('click', () => { location.hash = '#/'; });
  h.appendChild(b);
  h.appendChild(el('h1', null, titolo));
  if (sottotitolo) h.appendChild(el('p', 'dim', sottotitolo));
  app.appendChild(h);
  const corpo = el('div', 'corpo');
  app.appendChild(corpo);
  return corpo;
}

/** L'ago dei centesimi: la cosa che si guarda mentre si canta. */
function quadrante() {
  const d = el('div', 'quadrante');
  d.innerHTML = `
    <div class="scala">
      <span class="zona"></span>
      <i class="ago"></i>
      <span class="tacca sx">−50</span><span class="tacca c">0</span><span class="tacca dx">+50</span>
    </div>
    <div class="lettura">—</div>
    <div class="livello"><i></i><u></u></div>`;
  const ago = d.querySelector('.ago');
  const lettura = d.querySelector('.lettura');
  const barra = d.querySelector('.livello i');
  const tacca = d.querySelector('.livello u');
  // La stessa scala della barra (definita in pitch.js): la tacca della soglia deve stare
  // sulla scala VERA, non su una inventata qui — altrimenti barra e tacca si contraddicono.
  const posDb = (db) => Math.max(0, Math.min(1, (db - (-70)) / (-12 - (-70))));
  return {
    nodo: d,
    aggiorna(l, bersaglioHz) {
      barra.style.width = `${(l.livello * 100).toFixed(0)}%`;
      // La tacca della soglia: se la barra la supera, l'app ti sente. Risponde alla
      // domanda «non mi sente perché suono piano o perché non capisce?» senza parole.
      tacca.style.left = `${(posDb(20 * Math.log10(Math.max(l.soglia, 1e-9))) * 100).toFixed(0)}%`;
      if (!l.hz || !bersaglioHz) {
        ago.style.opacity = '0.25';
        lettura.textContent = l.silenzio ? 'non ti sento' : '…';
        lettura.className = 'lettura dim';
        return;
      }
      const cent = 1200 * Math.log2(l.hz / bersaglioHz);
      const x = Math.max(-1, Math.min(1, cent / 100));
      ago.style.opacity = '1';
      ago.style.left = `${(50 + x * 50).toFixed(1)}%`;
      lettura.textContent = `${cent >= 0 ? '+' : '−'}${Math.abs(cent).toFixed(0)}`;
      lettura.className = `lettura ${Math.abs(cent) <= TOLLERANZA ? 'dentro' : 'fuori'}`;
    },
    spegni() { ago.style.opacity = '0.25'; lettura.textContent = '—'; lettura.className = 'lettura dim'; barra.style.width = '0'; },
  };
}

function cartaVerdetto(v) {
  const d = el('div', `verdetto ${v.promosso ? 'si' : 'no'}`);
  d.appendChild(el('b', null, v.titolo));
  if (v.dettaglio) d.appendChild(el('p', null, v.dettaglio));
  const ul = el('ul', 'misure');
  v.righe.forEach((r) => ul.appendChild(el('li', null, r)));
  d.appendChild(ul);
  return d;
}

// ── il microfono, una volta sola ─────────────────────────────────────────────

async function preparaMicrofono(dove) {
  if (ascolto && ascolto.flusso) return true;
  ascolto = new Ascolto();
  try {
    await audio.sblocca();
    const s = await ascolto.apri();
    if (s.guadagnoAuto) {
      const avviso = el('div', 'avviso');
      avviso.textContent = 'Il telefono tiene acceso il guadagno automatico: alza il piano e abbassa il forte da solo. L\'intonazione si misura lo stesso, il livello no.';
      dove.appendChild(avviso);
    }
    return true;
  } catch (e) {
    const err = el('div', 'verdetto no');
    err.appendChild(el('b', null, 'Il microfono non si è aperto'));
    err.appendChild(el('p', null, `${e.name || e}. Serve il permesso del microfono, e una pagina in https (o localhost).`));
    dove.appendChild(err);
    return false;
  }
}

// ── il motore degli esercizi ─────────────────────────────────────────────────

/**
 * Un giro: dai la nota, taci, misura, giudica.
 *
 * @param {object} cfg
 * @param {number[]} cfg.note           le note che l'app suona, in MIDI
 * @param {number} cfg.bersaglio        la nota che devi cantare, in MIDI
 * @param {number} cfg.ascoltaMs        quanto si misura
 * @param {string} cfg.invito           cosa c'è scritto mentre canti
 * @param {function} cfg.giudica        (raccolta) => verdetto
 */
async function giro(cfg, ui) {
  // La ripresa del contesto sta QUI, dentro il gesto: su iPhone un contesto sospeso si
  // sblocca solo da un gestore di tocco, e ogni giro parte da un tocco sul pulsante.
  await audio.sblocca();
  ui.stato.textContent = cfg.note.length > 1 ? 'ascolta le note…' : 'ascolta la nota…';
  ui.stato.className = 'stato ascolta';
  ui.quadrante.spegni();
  await audio.daiLeNote(cfg.note.map(hz), { durataMs: cfg.durataNotaMs || 1500 });

  // L'app tace. Da qui in poi qualunque suono nel microfono è tuo.
  await pausa(DOPO_LA_NOTA_MS);
  ascolto.dimenticaLaStanza();
  if (cfg.suInizioMisura) cfg.suInizioMisura();

  ui.stato.textContent = cfg.invito;
  ui.stato.className = 'stato canta';
  const bersaglioHz = hz(cfg.bersaglio);
  const raccolta = await ascolto.raccogli(bersaglioHz, cfg.ascoltaMs, (l, avanzamento) => {
    ui.quadrante.aggiorna(l, bersaglioHz);
    ui.progresso.style.width = `${Math.min(100, avanzamento * 100).toFixed(0)}%`;
  }, cfg.opzioniAscolto || {});
  ui.progresso.style.width = '0';
  ui.stato.textContent = '';
  ui.stato.className = 'stato';
  ui.quadrante.spegni();
  return { raccolta, verdetto: cfg.giudica(raccolta) };
}

/**
 * Una nota da dare, oppure una spiegazione al posto suo.
 *
 * `notaDaDare` restituisce null quando la zona comoda sta tutta fuori dalla banda che il
 * rilevatore guarda. Senza questa guardia la schermata scriverebbe «canta il Do-1» —
 * `nome(null)` non esplode, produce una nota che non esiste, ed è il tipo di difetto che
 * non dà nessun errore in console.
 */
function notaOppureSpiega(zona, ui, opzioni = {}) {
  const m = notaDaDare(zona, Math.random(), opzioni);
  if (m === null) {
    ui.esiti.prepend(cartaVerdetto({
      titolo: 'Non so darti una nota lì',
      promosso: false,
      righe: [`il rilevatore guarda da ${nome(MIDI_MIN)} a ${nome(MIDI_MAX)}`],
      dettaglio: 'La zona in cui dovrei darti le note sta fuori da quella che so misurare. Rifai l\'estensione: probabilmente è rimasto un numero vecchio.',
    }));
    ui.pulsante.disabled = false;
    return null;
  }
  return m;
}

/** L'impalcatura comune a tutti gli esercizi: quadrante, stato, pulsante, verdetti. */
function palco(corpo, testoPulsante) {
  const q = quadrante();
  const stato = el('div', 'stato');
  const progresso = el('div', 'progresso');
  const barra = el('div', 'progresso-fuori');
  barra.appendChild(progresso);
  const pulsante = el('button', 'principale', testoPulsante);
  const esiti = el('div', 'esiti');
  corpo.append(q.nodo, stato, barra, pulsante, esiti);
  return { quadrante: q, stato, progresso, pulsante, esiti };
}

// ── schermata: la tua nota / nota tenuta ─────────────────────────────────────

async function vistaNotaTenuta() {
  const corpo = schermata('Nota tenuta', 'L\'app dà la nota, poi tace. Tu la tieni ferma. Si misura quanto ci stai vicino e se cali.');
  if (!await preparaMicrofono(corpo)) return;
  const ui = palco(corpo, 'Dammi una nota');

  let zona = zonaComoda(store.leggi().estensione) || store.leggi().zonaProvvisoria;
  const date = [];

  if (!zona) {
    // Partenza a freddo: l'app non sa niente di te. L'unica cosa onesta è chiedertelo
    // cantando, invece di indovinare da una tabella di tipi vocali.
    ui.pulsante.textContent = 'Canta una nota qualunque';
    ui.stato.textContent = '';
    corpo.insertBefore(nota(`Prima volta: non so ancora dove sta comoda la tua voce, e darti una nota a caso vorrebbe dire darti quella di un altro. Mugola o canta una nota qualunque, quella che ti viene senza sforzo.`), ui.quadrante.nodo);
    ui.pulsante.addEventListener('click', async function primaVolta() {
      ui.pulsante.disabled = true;
      await audio.sblocca();                // iPhone: il contesto si sblocca solo qui
      ui.stato.textContent = 'canta…';
      ui.stato.className = 'stato canta';
      ascolto.dimenticaLaStanza();
      const trovata = await ascolto.aspettaUnaNota(8000, (l) => ui.quadrante.aggiorna(l, l.hz));
      ui.stato.className = 'stato';
      if (!trovata) {
        ui.stato.textContent = 'Non ti ho sentito. Riprova più vicino al telefono.';
        ui.pulsante.disabled = false;
        return;
      }
      zona = zonaDaUnaNota(midiVicino(trovata));
      store.salvaZonaProvvisoria(zona);
      ui.esiti.prepend(cartaVerdetto({
        titolo: `Hai cantato un ${nome(midiVicino(trovata))}`,
        promosso: true,
        dettaglio: 'Da qui parto: ti darò note lì attorno. Quando farai l\'esercizio dell\'estensione questa stima verrà sostituita da quella vera.',
        righe: [`${trovata.toFixed(1)} Hz`],
      }));
      ui.pulsante.removeEventListener('click', primaVolta);
      ui.pulsante.textContent = 'Dammi una nota';
      ui.pulsante.disabled = false;
      ui.pulsante.addEventListener('click', tondo);
    });
  } else {
    ui.pulsante.addEventListener('click', tondo);
  }

  async function tondo() {
    ui.pulsante.disabled = true;
    const m = notaOppureSpiega(zona, ui, { evita: date.slice(-2) });
    if (m === null) return;
    date.push(m);
    const r = await giro({
      note: [m],
      bersaglio: m,
      ascoltaMs: 5000,
      invito: `tieni il ${nome(m)}`,
      giudica: (racc) => giudicaNotaTenuta(racc),
    }, ui);
    ui.esiti.prepend(cartaVerdetto(r.verdetto));
    store.salvaSessione({ esercizio: 'nota-tenuta', nota: m, promosso: r.verdetto.promosso });
    ui.pulsante.disabled = false;
    ui.pulsante.textContent = 'Un\'altra';
  }
}

function nota(testo) {
  const p = el('p', 'dim spiega', testo);
  return p;
}

// ── schermata: estensione ────────────────────────────────────────────────────

async function vistaEstensione() {
  const corpo = schermata('La tua estensione',
    'Per gradi, in giù e poi in su. Si chiede la più grave e la più acuta COMODE — non le più estreme: misurarla spingendo fa male alla voce, e il numero serve a essere confrontato con sé stesso, non con quello di un altro.');
  if (!await preparaMicrofono(corpo)) return;
  const ui = palco(corpo, 'Comincia');

  const vecchia = store.leggi().estensione;
  if (vecchia) {
    corpo.insertBefore(nota(`L'ultima volta: ${estensioneRiassunto(vecchia).testo}. Cambia con la giornata — con il sonno, con l'ora, con un raffreddore — quindi rifarla non è ripetersi.`), ui.quadrante.nodo);
  }

  const partenza = (() => {
    const z = zonaComoda(vecchia) || store.leggi().zonaProvvisoria;
    return z ? Math.round((z.basso + z.alto) / 2) : 57; // La3, se non so proprio niente
  })();

  let stato = estensioneInizio(partenza);
  const nonCiArrivo = el('button', 'secondario', 'Non ci arrivo comodo');
  nonCiArrivo.style.display = 'none';
  ui.pulsante.after(nonCiArrivo);

  const mostra = () => {
    ui.stato.textContent = '';
    const r = estensioneRiassunto(stato);
    ui.esiti.replaceChildren(cartaVerdetto({
      titolo: r.testo,
      promosso: true,
      dettaglio: stato.finito
        ? `${stato.motivoFine} Rifalla fra qualche giorno: è normale che cambi.`
        : `Adesso ${stato.verso === 'giu' ? 'scendiamo' : 'saliamo'}. Ferma appena senti sforzo.`,
      righe: [`più grave comoda ${nome(stato.grave)}`, `più acuta comoda ${nome(stato.acuto)}`],
    }));
  };

  async function passo(esito) {
    stato = estensionePasso(stato, esito);
    if (stato.finito) {
      const r = estensioneRiassunto(stato);
      nonCiArrivo.style.display = 'none';
      ui.pulsante.textContent = 'Rifalla';
      ui.pulsante.disabled = false;
      // Un'estensione degenere NON si salva. Quel numero decide tutte le note che l'app
      // darà da qui in avanti: salvare «La3 → La3» vorrebbe dire un'app che ti fa cantare
      // per sempre la stessa nota, e per giunta convinta di sapere qualcosa di te.
      if (!r.attendibile) {
        ui.esiti.replaceChildren(cartaVerdetto({
          titolo: 'Non ho misurato niente di utile',
          promosso: false,
          righe: [r.testo],
          dettaglio: 'Sono usciti meno di tre semitoni, e non è un\'estensione: o le note che ti davo erano nel posto sbagliato, o il microfono non ti ha sentito. Non lo salvo. Rifacciamo partendo da una nota che ti viene comoda.',
        }));
        return;
      }
      store.salvaEstensione(stato.grave, stato.acuto, Date.now());
      store.salvaSessione({ esercizio: 'estensione', ...r });
      mostra();
      return;
    }
    mostra();
    await tondo();
  }

  async function tondo() {
    ui.pulsante.disabled = true;
    // Il pulsante compare solo QUANDO tocca a te, non mentre l'app sta ancora suonando:
    // premuto durante la nota faceva partire il giro dopo sopra quello in corso, e si
    // sentivano due note insieme — che in un'app costruita sull'alternanza è proprio la
    // cosa che non deve succedere.
    nonCiArrivo.style.display = 'none';
    const m = stato.corrente;
    const r = await giro({
      note: [m],
      bersaglio: m,
      ascoltaMs: 3000,
      durataNotaMs: 1300,
      invito: `canta il ${nome(m)}`,
      suInizioMisura: () => { nonCiArrivo.style.display = 'block'; },
      giudica: (racc) => giudicaNotaTenuta(racc),
    }, ui);
    // La misura conferma, ma il giudice resta chi canta: «non ci arrivo comodo» è un
    // pulsante ed è il segnale principale. Qui si controlla solo che quella nota sia
    // uscita davvero — chi non arriva a un acuto spesso canta l'ottava sotto senza
    // accorgersene, e senza questo controllo l'app gli darebbe un'estensione che non ha.
    const p = notaPresa(r.raccolta);
    if (!p.presa && p.motivo) ui.esiti.prepend(nota(`${nome(m)}: ${p.motivo}.`));
    await passo(p.presa ? 'presa' : 'no');
  }

  ui.pulsante.addEventListener('click', async () => {
    if (stato.finito) stato = estensioneInizio(partenza);
    mostra();
    await tondo();
  });
  nonCiArrivo.addEventListener('click', async () => {
    ascolto.ferma();
    nonCiArrivo.style.display = 'none';
    await passo('no');
  });
  mostra();
}

// ── schermata: attacco ───────────────────────────────────────────────────────

async function vistaAttacco() {
  const corpo = schermata('Attacco pulito',
    'Nota data, silenzio, poi tu. Il punto non è l\'intonazione: è se atterri sulla nota o ci scivoli sopra da sotto. Si misurano i primi 150 millisecondi contro il resto della TUA nota.');
  if (!await preparaMicrofono(corpo)) return;
  const ui = palco(corpo, 'Dammi una nota');
  const zona = zonaComoda(store.leggi().estensione) || store.leggi().zonaProvvisoria || { basso: 55, alto: 64 };
  const date = [];

  ui.pulsante.addEventListener('click', async () => {
    ui.pulsante.disabled = true;
    const m = notaOppureSpiega(zona, ui, { evita: date.slice(-2) });
    if (m === null) return;
    date.push(m);
    const r = await giro({
      note: [m],
      bersaglio: m,
      ascoltaMs: 2500,
      invito: `attacca il ${nome(m)}`,
      giudica: (racc) => giudicaAttacco(racc),
    }, ui);
    ui.esiti.prepend(cartaVerdetto(r.verdetto));
    store.salvaSessione({ esercizio: 'attacco', nota: m, promosso: r.verdetto.promosso });
    ui.pulsante.disabled = false;
    ui.pulsante.textContent = 'Un\'altra';
  });
}

// ── schermata: intervalli ────────────────────────────────────────────────────

async function vistaIntervalli() {
  const corpo = schermata('Intervalli',
    'L\'app dà la nota di partenza, poi tace. Tu canti prima quella e poi quella a distanza chiesta. Si misura la DISTANZA che hai cantato, non l\'intonazione assoluta: se parti dieci centesimi sotto e fai una quinta esatta, la quinta è esatta.');
  if (!await preparaMicrofono(corpo)) return;
  const ui = palco(corpo, 'Dammi un intervallo');
  const zona = zonaComoda(store.leggi().estensione) || store.leggi().zonaProvvisoria || { basso: 55, alto: 64 };

  ui.pulsante.addEventListener('click', async () => {
    ui.pulsante.disabled = true;
    await audio.sblocca();
    const facili = INTERVALLI.filter((i) => i.facilita <= 3);
    const scelto = facili[Math.floor(Math.random() * facili.length)];
    const partenza = notaOppureSpiega({ basso: zona.basso, alto: Math.max(zona.basso, zona.alto - scelto.semitoni) }, ui);
    if (partenza === null) return;
    const arrivo = partenza + scelto.semitoni;

    ui.stato.textContent = 'ascolta la nota di partenza…';
    ui.stato.className = 'stato ascolta';
    await audio.daiLaNota(hz(partenza), { durataMs: 1500 });
    await pausa(DOPO_LA_NOTA_MS);
    ascolto.dimenticaLaStanza();

    ui.stato.textContent = `canta il ${nome(partenza)}, poi sali di una ${scelto.nome}`;
    ui.stato.className = 'stato canta';
    const racc = await ascolto.raccogli(hz(partenza), 7000, (l, a) => {
      ui.quadrante.aggiorna(l, hz(partenza));
      ui.progresso.style.width = `${Math.min(100, a * 100).toFixed(0)}%`;
    });
    ui.progresso.style.width = '0';
    ui.stato.textContent = '';
    ui.stato.className = 'stato';
    ui.quadrante.spegni();

    // Le due note si RITAGLIANO, non si divide il tempo a metà. La prima stesura spaccava
    // la serie in due e prendeva la mediana di ciascuna metà: bastava tenere la prima nota
    // più a lungo della seconda e la "seconda metà" cadeva ancora dentro la prima nota —
    // a chi cantava una quinta esatta l'app diceva «intervallo stretto». Le note le trova
    // `segmentaNote`, che è fatto apposta e sta sotto collaudo; si prendono la prima e
    // l'ultima, così un glissando di passaggio in mezzo non conta come nota.
    const note = segmentaNote(racc.serieMidi, racc.dtMs, { minMs: 250 });
    const v = (note.length < 2)
      ? {
        titolo: 'Non ho sentito due note distinte',
        righe: [`note riconosciute: ${note.length}`],
        promosso: false,
        dettaglio: 'Servono due note tenute, una dopo l\'altra — un respiro in mezzo va benissimo.',
      }
      : giudicaIntervallo({
        centDiPartenza: (note[0].midi - partenza) * 100,
        centDiArrivo: (note[note.length - 1].midi - partenza) * 100,
        semitoni: scelto.semitoni,
      });
    ui.esiti.prepend(cartaVerdetto(v));
    store.salvaSessione({ esercizio: 'intervalli', intervallo: scelto.nome, promosso: v.promosso });
    ui.pulsante.disabled = false;
    ui.pulsante.textContent = 'Un altro';
    ui.esiti.prepend(nota(`Era: ${nome(partenza)} → ${nome(arrivo)}, ${scelto.nome}.`));
  });
}

// ── schermata: fiato ─────────────────────────────────────────────────────────

async function vistaFiato() {
  const corpo = schermata('Fiato',
    'Una nota sola, tenuta il più a lungo possibile. Non conta quanto fai rumore: conta quanti secondi resti DENTRO tolleranza. Una nota da venti secondi che scivola via non è fiato, è una sirena.');
  if (!await preparaMicrofono(corpo)) return;
  const ui = palco(corpo, 'Dammi la nota');
  const zona = zonaComoda(store.leggi().estensione) || store.leggi().zonaProvvisoria || { basso: 55, alto: 64 };
  const storico = store.sessioniDi('fiato');
  if (storico.length) {
    corpo.insertBefore(nota(`Il tuo record finora: ${Math.max(...storico.map((s) => s.secondi || 0)).toFixed(1)} secondi. Da principiante si sta fra 8 e 12, da allenati fra 20 e 30.`), ui.quadrante.nodo);
  }

  ui.pulsante.addEventListener('click', async () => {
    ui.pulsante.disabled = true;
    const m = notaOppureSpiega(zona, ui);
    if (m === null) return;
    const r = await giro({
      note: [m],
      bersaglio: m,
      ascoltaMs: 32000,
      // Quando molli la nota, tre secondi di silenzio chiudono la misura: nessuno deve
      // fissare lo schermo per la coda di una finestra da 32 secondi.
      opzioniAscolto: { fermaDopoSilenzioMs: 3000 },
      invito: `tieni il ${nome(m)} finché ce la fai`,
      giudica: (racc) => giudicaFiato(racc),
    }, ui);
    ui.esiti.prepend(cartaVerdetto(r.verdetto));
    store.salvaSessione({ esercizio: 'fiato', nota: m, secondi: r.verdetto.valore });
    ui.pulsante.disabled = false;
    ui.pulsante.textContent = 'Ancora';
  });
}

// ── schermata: passaggio di registro ─────────────────────────────────────────

async function vistaPassaggio() {
  const corpo = schermata('Il tuo passaggio',
    'Un glissando LENTO in salita, su «u» o a bocca chiusa, dalla nota più comoda verso l\'alto. Non spingere e non cercare l\'acuto: l\'esercizio è salire piano e uniformi. E non spostare il telefono mentre sali, altrimenti quello che cambia è la distanza, non la tua voce.');
  if (!await preparaMicrofono(corpo)) return;
  const ui = palco(corpo, 'Comincia il glissando');
  const zona = zonaComoda(store.leggi().estensione) || store.leggi().zonaProvvisoria || { basso: 52, alto: 64 };

  ui.pulsante.addEventListener('click', async () => {
    ui.pulsante.disabled = true;
    await audio.sblocca();
    const partenza = Math.round(zona.basso);
    ui.stato.textContent = 'ascolta la nota di partenza…';
    ui.stato.className = 'stato ascolta';
    await audio.daiLaNota(hz(partenza), { durataMs: 1400 });
    await pausa(DOPO_LA_NOTA_MS);
    ascolto.dimenticaLaStanza();

    ui.stato.textContent = `parti dal ${nome(partenza)} e sali piano, senza fermarti`;
    ui.stato.className = 'stato canta';
    const racc = await ascolto.raccogli(hz(partenza), 10000, (l, a) => {
      ui.quadrante.aggiorna(l, l.hz);
      ui.progresso.style.width = `${Math.min(100, a * 100).toFixed(0)}%`;
    }, { conTimbro: true });
    ui.progresso.style.width = '0';
    ui.stato.textContent = '';
    ui.stato.className = 'stato';
    ui.quadrante.spegni();

    const esito = trovaPassaggio(racc.letture);
    const v = giudicaPassaggio(esito);
    ui.esiti.prepend(cartaVerdetto(v));
    if (esito.punti && esito.punti.length) {
      ui.esiti.prepend(nota(`Hai coperto ${esito.punti.length} semitoni, da ${nome(esito.punti[0].midi)} a ${nome(esito.punti[esito.punti.length - 1].midi)}.`));
    }
    store.salvaSessione({ esercizio: 'passaggio', midi: esito.midi || null, trovato: !!esito.trovato, promosso: true });
    ui.pulsante.disabled = false;
    ui.pulsante.textContent = 'Rifallo';
  });
}

// ── schermata: scale e agilità ───────────────────────────────────────────────

async function vistaAgilita() {
  const corpo = schermata('Scale e agilità',
    'Cinque note su e giù, sulla scala maggiore. L\'app le suona, poi tace: tu le ripeti. Ogni volta che la prendi pulita, la volta dopo è più veloce.');
  if (!await preparaMicrofono(corpo)) return;
  const ui = palco(corpo, 'Suonami la scala');
  const zona = zonaComoda(store.leggi().estensione) || store.leggi().zonaProvvisoria || { basso: 52, alto: 62 };
  const fatte = store.sessioniDi('agilita');
  // La velocità riparte da dove eri arrivato, non da capo: il senso dell'esercizio è che
  // il numero salga fra una settimana e l'altra.
  let msPerNota = fatte.length ? Math.max(180, Math.min(700, fatte[0].msPerNota || 520)) : 520;

  ui.pulsante.addEventListener('click', async () => {
    ui.pulsante.disabled = true;
    const tonica = notaOppureSpiega({ basso: zona.basso, alto: Math.max(zona.basso, zona.alto - 7) }, ui);
    if (tonica === null) return;
    const sequenza = scalaAgilita(tonica);
    const r = await giro({
      note: sequenza,
      bersaglio: tonica,
      durataNotaMs: msPerNota,
      ascoltaMs: Math.round(sequenza.length * msPerNota * 1.8) + 1500,
      invito: `ripetila, dal ${nome(tonica)}`,
      giudica: (racc) => giudicaAgilita(
        confrontaSequenza(segmentaNote(racc.serieMidi, racc.dtMs, { minMs: Math.max(70, msPerNota * 0.35) }), sequenza),
        { msAttesi: sequenza.length * msPerNota },
      ),
    }, ui);
    ui.esiti.prepend(cartaVerdetto(r.verdetto));
    ui.esiti.prepend(nota(`Era: ${sequenza.map(nome).join(' ')} — ${(60000 / msPerNota).toFixed(0)} note al minuto.`));
    if (r.verdetto.promosso) msPerNota = Math.max(180, Math.round(msPerNota * 0.85));
    store.salvaSessione({ esercizio: 'agilita', tonica, msPerNota, promosso: r.verdetto.promosso });
    ui.pulsante.disabled = false;
    ui.pulsante.textContent = r.verdetto.promosso ? 'Più veloce' : 'Ancora';
  });
}

// ── schermata: orecchio ──────────────────────────────────────────────────────

function vistaOrecchio() {
  const corpo = schermata('Orecchio',
    'Qui non si canta: si riconosce. L\'app suona due note, tu dici che intervallo era. Quelli che sbagli tornano presto, quelli che azzecchi si diradano.');
  const ui = { esiti: el('div', 'esiti') };
  const domanda = el('div', 'domanda');
  const risposte = el('div', 'risposte');
  const suona = el('button', 'principale', 'Suona le due note');
  corpo.append(domanda, suona, risposte, ui.esiti);

  const usabili = INTERVALLI.filter((i) => i.facilita <= 4);
  const schede = store.schede(usabili.map((i) => `int-${i.semitoni}`));
  const zona = zonaComoda(store.leggi().estensione) || store.leggi().zonaProvvisoria || { basso: 55, alto: 64 };
  let corrente = null;
  let partenza = null;
  let risposto = false;

  const consolidato = consolidamento(schede);
  domanda.appendChild(el('p', 'dim', `Ne conosci ${Math.round(consolidato * 100)}%. ${daRivedere(schede, Date.now()).length} da rivedere adesso.`));

  const mostraRisposte = () => {
    risposte.replaceChildren();
    usabili.forEach((i) => {
      const b = el('button', 'secondario', i.nome);
      b.addEventListener('click', () => {
        if (risposto || !corrente) return;
        risposto = true;
        const giusto = i.semitoni === corrente.semitoni;
        const s = schede.find((x) => x.id === `int-${corrente.semitoni}`);
        store.salvaScheda(rispondi(s, giusto, Date.now()));
        ui.esiti.prepend(cartaVerdetto({
          titolo: giusto ? `Sì: ${corrente.nome}` : `Era una ${corrente.nome}`,
          promosso: giusto,
          righe: [`${nome(partenza)} → ${nome(partenza + corrente.semitoni)}`],
          dettaglio: giusto ? '' : `Hai detto ${i.nome}. Riascoltale: la differenza sta ${Math.abs(i.semitoni - corrente.semitoni) === 1 ? 'in un semitono solo, ed è la più difficile da sentire' : 'in ' + Math.abs(i.semitoni - corrente.semitoni) + ' semitoni'}.`,
        }));
        store.salvaSessione({ esercizio: 'orecchio', intervallo: corrente.nome, promosso: giusto });
        suona.textContent = 'Un altro';
        suana();
      });
      risposte.appendChild(b);
    });
  };
  const suana = () => { risposte.querySelectorAll('button').forEach((b) => { b.disabled = risposto; }); };

  suona.addEventListener('click', async () => {
    await audio.sblocca();
    if (risposto || !corrente) {
      const s = prossima(schede, Date.now());
      corrente = usabili.find((i) => `int-${i.semitoni}` === s.id);
      partenza = notaDaDare({ basso: zona.basso, alto: Math.max(zona.basso, zona.alto - corrente.semitoni) }, Math.random())
        || Math.round(zona.basso);
      risposto = false;
      suana();
    }
    suona.disabled = true;
    // Le due note una dopo l'altra, con una pausa: suonate insieme sarebbero un accordo,
    // e riconoscere un accordo è un altro esercizio.
    await audio.daiLeNote([hz(partenza), hz(partenza + corrente.semitoni)], { durataMs: 900, pausaMs: 90 });
    suona.disabled = false;
    suona.textContent = 'Riascoltale';
  });
  mostraRisposte();
  suana();
}

// ── schermata: canta quello che suoni ────────────────────────────────────────

async function vistaStrumento() {
  const corpo = schermata('Canta quello che suoni',
    'Suona una nota sul tuo strumento — piano, tastiera, chitarra, ukulele, quello che hai. L\'app la riconosce, poi tace, e tu la canti. È il ponte vero fra strumento e voce, e all\'app non cambia niente quale strumento sia.');
  if (!await preparaMicrofono(corpo)) return;
  const ui = palco(corpo, 'Sono pronto: suona');
  corpo.insertBefore(nota('Una nota alla volta, lasciata suonare. L\'app riconosce l\'altezza da 70 a 1300 Hz; sulle corde gravi del pianoforte legge fino a un quarto di semitono crescente — è la rigidità delle corde, non la tua — e per questo il bersaglio da cantare è il semitono temperato più vicino, non la frequenza letta.'), ui.quadrante.nodo);

  ui.pulsante.addEventListener('click', async () => {
    ui.pulsante.disabled = true;
    await audio.sblocca();
    ui.stato.textContent = 'suona una nota…';
    ui.stato.className = 'stato ascolta';
    ascolto.dimenticaLaStanza();
    const trovata = await ascolto.aspettaUnaNota(10000, (l) => ui.quadrante.aggiorna(l, l.hz));
    if (!trovata) {
      ui.stato.className = 'stato';
      ui.stato.textContent = 'Non ho sentito nessuna nota. Riprova più vicino.';
      ui.pulsante.disabled = false;
      return;
    }
    const m = midiVicino(trovata);
    ui.esiti.prepend(nota(`Hai suonato un ${nome(m)} (${trovata.toFixed(1)} Hz, ${centesimiDa(trovata, m)} rispetto al temperato).`));

    await pausa(400);
    ascolto.dimenticaLaStanza();
    ui.stato.textContent = `adesso cantalo: ${nome(m)}`;
    ui.stato.className = 'stato canta';
    const racc = await ascolto.raccogli(hz(m), 4500, (l, a) => {
      ui.quadrante.aggiorna(l, hz(m));
      ui.progresso.style.width = `${Math.min(100, a * 100).toFixed(0)}%`;
    });
    ui.progresso.style.width = '0';
    ui.stato.textContent = '';
    ui.stato.className = 'stato';
    ui.quadrante.spegni();
    const v = giudicaNotaTenuta(racc);
    ui.esiti.prepend(cartaVerdetto(v));
    store.salvaSessione({ esercizio: 'strumento', nota: m, promosso: v.promosso });
    ui.pulsante.disabled = false;
    ui.pulsante.textContent = 'Un\'altra';
  });
}

const centesimiDa = (frequenza, m) => {
  const c = 1200 * Math.log2(frequenza / hz(m));
  return `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(0)} centesimi`;
};

// ── schermata: melodie ───────────────────────────────────────────────────────

async function vistaMelodia() {
  const corpo = schermata('Melodie',
    'L\'app inventa una melodia dentro la tua zona comoda, la suona, poi tace. Tu la ricanti a memoria.');
  if (!await preparaMicrofono(corpo)) return;
  const ui = palco(corpo, 'Inventamene una');
  corpo.insertBefore(nota('Le melodie sono GENERATE, non prese da nessuna canzone: camminano sui gradi di una scala. Non è una limitazione tecnica — una melodia vera ha un autore, e questa app non ha nessun diritto di dartela.'), ui.quadrante.nodo);
  const zona = zonaComoda(store.leggi().estensione) || store.leggi().zonaProvvisoria || { basso: 52, alto: 62 };
  let seme = Math.floor(Math.random() * 100000);

  ui.pulsante.addEventListener('click', async () => {
    ui.pulsante.disabled = true;
    const tonica = notaOppureSpiega({ basso: zona.basso, alto: Math.max(zona.basso, zona.alto - 8) }, ui);
    if (tonica === null) return;
    seme += 1;
    const ambito = Math.max(3, Math.min(8, Math.round(zona.alto - tonica)));
    const melodia = melodiaGenerata(tonica, { passi: 6, seme, ambito });
    const r = await giro({
      note: melodia,
      bersaglio: tonica,
      durataNotaMs: 620,
      ascoltaMs: melodia.length * 900 + 1500,
      invito: 'ricantala',
      giudica: (racc) => giudicaMelodia(
        confrontaSequenza(segmentaNote(racc.serieMidi, racc.dtMs, { minMs: 120 }), melodia),
      ),
    }, ui);
    ui.esiti.prepend(cartaVerdetto(r.verdetto));
    ui.esiti.prepend(nota(`Era: ${melodia.map(nome).join(' ')}.`));
    store.salvaSessione({ esercizio: 'melodia', promosso: r.verdetto.promosso });
    ui.pulsante.disabled = false;
    ui.pulsante.textContent = 'Un\'altra';
  });
}

// ── casa ─────────────────────────────────────────────────────────────────────

function vistaCasa() {
  app.replaceChildren();
  const d = store.leggi();
  const testa = el('header', 'testa casa');
  testa.appendChild(el('p', 'occhiello', 'Canto Coach'));
  testa.appendChild(el('h1', null, 'Cosa facciamo oggi'));
  app.appendChild(testa);

  const corpo = el('div', 'corpo');
  app.appendChild(corpo);

  const e = d.estensione;
  const riquadro = el('div', 'tuoi-numeri');
  if (e) {
    riquadro.appendChild(el('b', null, estensioneRiassunto(e).testo));
    riquadro.appendChild(el('span', null, store.estensioneStantia()
      ? 'misurata più di dieci giorni fa — cambia con la giornata, rifalla'
      : 'la tua estensione misurata'));
  } else if (d.zonaProvvisoria) {
    riquadro.appendChild(el('b', null, `zona provvisoria ${nome(d.zonaProvvisoria.basso)} → ${nome(d.zonaProvvisoria.alto)}`));
    riquadro.appendChild(el('span', null, 'stimata dalla nota che hai cantato: fai l\'estensione per averla vera'));
  } else {
    riquadro.appendChild(el('b', null, 'Non so ancora niente della tua voce'));
    riquadro.appendChild(el('span', null, 'comincia da «Nota tenuta»: ti chiederò di cantare una nota qualunque'));
  }
  corpo.appendChild(riquadro);

  const o = oggi(d);
  if (o.prossimo) {
    const p = el('a', 'carta primo');
    p.href = o.prossimo.rotta;
    p.appendChild(el('i', 'contatore', `${o.fatti} su ${o.totale}`));
    p.appendChild(el('b', null, `Oggi: ${o.prossimo.titolo}`));
    p.appendChild(el('span', null, `${o.prossimo.sotto} — criterio: ${o.prossimo.obiettivo}.`));
    corpo.appendChild(p);
  }

  o.gradini.forEach((x) => {
    const a = el('a', `carta${x.fatto ? ' fatto' : ''}`);
    a.href = x.rotta;
    a.appendChild(el('b', null, `${x.fatto ? '✓ ' : ''}${x.titolo}`));
    a.appendChild(el('span', null, x.sotto));
    if (x.volte) a.appendChild(el('i', 'contatore', `${x.volte} volte`));
    corpo.appendChild(a);
  });

  const info = el('a', 'carta piccola');
  info.href = '#/info';
  info.appendChild(el('b', null, 'Cosa misura e cosa no'));
  info.appendChild(el('span', null, 'i numeri veri di questa app, e le tre cose che non fingerà mai di sapere'));
  corpo.appendChild(info);
}

function vistaInfo() {
  const corpo = schermata('Cosa misura, e cosa no');
  corpo.innerHTML = `
    <h2>Misurato, con i numeri</h2>
    <ul class="misure grande">
      <li>errore su una nota tenuta: <b>3,2 centesimi</b> mediani, 7,5 nel caso peggiore</li>
      <li>tolleranza del giudizio: <b>${TOLLERANZA} centesimi</b> — più di quattro volte l'errore dello strumento, perché quello che si giudica sia la tua voce e non il rumore della misura</li>
      <li>errori d'ottava su voce grave, anche con la fondamentale a −18 dB: <b>zero su otto</b></li>
      <li>mugolato più piano riconosciuto in una stanza silenziosa: <b>−60 dBFS</b></li>
      <li>vibrato: letto <b>5,51 Hz ±44,9</b> dove il vero era 5,5 Hz ±50</li>
    </ul>
    <h2>Quello che NON misura</h2>
    <p class="dim">L'<b>appoggio e il sostegno del fiato</b>: si misura quanto dura una nota, non da dove viene il sostegno. Un'app che dice «appoggia meglio» sta inventando.</p>
    <p class="dim">La <b>risonanza</b>, la posizione della voce, le vocali: serve un orecchio, non uno spettro su un microfono di telefono.</p>
    <p class="dim">Se hai una <b>bella voce</b>: non è una misura.</p>
    <p class="dim">La <b>salute vocale</b>. Se cantando ti fa male qualcosa si smette e si va da un umano.</p>
    <h2>Come si comporta</h2>
    <p class="dim">L'app e la tua voce <b>non suonano mai insieme</b>: lei dà la nota, tace, e solo dopo misura. È anche il motivo per cui la misura è credibile — un programma che emette mentre ascolta si dà da solo la risposta che sperava. Misurato: mentre l'app ascolta, dalla sua uscita escono <b>162 dB</b> meno che mentre suona.</p>
    <p class="dim">Il verdetto sta sulla frase, non sulla nota, e la tendenza conta più dell'istante.</p>
    <p class="dim">Quando una cosa non la può misurare lo <b>dice</b> invece di inventarla: se le letture arrivano troppo rade non parla di vibrato, se il glissando non ha un gradino netto non ti indica un passaggio, se l'estensione esce di meno di tre semitoni non la salva.</p>
    <h2>Le melodie</h2>
    <p class="dim">Sono <b>generate</b>, non prese da nessuna canzone: camminano sui gradi di una scala. Una sequenza di accordi non è protetta dal diritto d'autore, una melodia sì — è proprio quello che il diritto d'autore protegge in una canzone. Questa app non ha nessun diritto di darti quella di qualcun altro.</p>
    <h2>I tuoi dati</h2>
    <p class="dim">Restano nel telefono, in questa pagina. Nessun account, nessun server.</p>`;
  const b = el('button', 'secondario', 'Dimentica tutto quello che sai di me');
  b.addEventListener('click', () => { store.dimenticaTutto(); location.hash = '#/'; });
  corpo.appendChild(b);
}

// ── navigazione ──────────────────────────────────────────────────────────────

const ROTTE = {
  '#/': vistaCasa,
  '#/nota': vistaNotaTenuta,
  '#/estensione': vistaEstensione,
  '#/passaggio': vistaPassaggio,
  '#/attacco': vistaAttacco,
  '#/intervalli': vistaIntervalli,
  '#/fiato': vistaFiato,
  '#/agilita': vistaAgilita,
  '#/orecchio': vistaOrecchio,
  '#/strumento': vistaStrumento,
  '#/melodia': vistaMelodia,
  '#/info': vistaInfo,
};

function vai() {
  // Ogni schermata che se ne va porta via i suoi ascoltatori e ferma il microfono: un
  // ciclo di lettura lasciato acceso continuerebbe a misurare da un'altra schermata, e
  // negli altri progetti della famiglia è esattamente il difetto che dà la sensazione
  // «l'app è piena di bug» senza poterne indicare uno.
  if (pulizia) { pulizia(); pulizia = null; }
  if (ascolto) ascolto.ferma();
  // E si zittisce anche l'USCITA: cambiare schermata durante una scala lasciava le note
  // restanti a suonare sopra la schermata nuova.
  audio.zittisci();
  const vista = ROTTE[location.hash] || vistaCasa;
  const r = vista();
  if (typeof r === 'function') pulizia = r;
}

window.addEventListener('hashchange', vai);
vai();

// Per il collaudo in pagina.
window.__canto = { store, rotte: Object.keys(ROTTE) };
