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
  estensioneInizio, estensionePasso, estensioneRiassunto,
} from './esercizi.js';

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
  return {
    nodo: d,
    aggiorna(l, bersaglioHz) {
      barra.style.width = `${(l.livello * 100).toFixed(0)}%`;
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
  });
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

    // Le due note si trovano dividendo in due la parte cantata: la prima metà è la nota di
    // partenza, la seconda quella di arrivo. Si prende la mediana di ciascuna, non la
    // media, perché il salto in mezzo è un glissando e la media lo spalmerebbe su entrambe.
    const meta = Math.floor(racc.serie.length / 2);
    const mediana = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
    const c1 = mediana(racc.serie.slice(0, meta));
    const c2 = mediana(racc.serie.slice(meta));
    const v = (c1 === null || c2 === null || racc.dentro < 0.4)
      ? { titolo: 'Non ti ho sentito abbastanza', righe: [`nota riconosciuta nel ${Math.round(racc.dentro * 100)}% del tempo`], promosso: false, dettaglio: 'Servono due note tenute, una dopo l\'altra, senza pause lunghe.' }
      : giudicaIntervallo({ centDiPartenza: c1, centDiArrivo: c2, semitoni: scelto.semitoni });
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
      invito: `tieni il ${nome(m)} finché ce la fai`,
      giudica: (racc) => giudicaFiato(racc),
    }, ui);
    ui.esiti.prepend(cartaVerdetto(r.verdetto));
    store.salvaSessione({ esercizio: 'fiato', nota: m, secondi: r.verdetto.valore });
    ui.pulsante.disabled = false;
    ui.pulsante.textContent = 'Ancora';
  });
}

// ── casa ─────────────────────────────────────────────────────────────────────

const ESERCIZI = [
  { id: 'nota', titolo: 'Nota tenuta', sotto: 'La prima lezione di qualunque insegnante: una nota, tenuta ferma.', rotta: '#/nota' },
  { id: 'estensione', titolo: 'La tua estensione', sotto: 'Due numeri che l\'app userà per tutto il resto: senza, ti darebbe le note di un altro.', rotta: '#/estensione' },
  { id: 'attacco', titolo: 'Attacco pulito', sotto: 'Atterrare sulla nota invece di scivolarci sopra da sotto.', rotta: '#/attacco' },
  { id: 'intervalli', titolo: 'Intervalli', sotto: 'Terza, quarta, quinta, ottava: il cuore delle lezioni.', rotta: '#/intervalli' },
  { id: 'fiato', titolo: 'Fiato', sotto: 'Quanti secondi tieni la nota dentro tolleranza. Un numero che sale.', rotta: '#/fiato' },
];

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

  ESERCIZI.forEach((x) => {
    const a = el('a', 'carta');
    a.href = x.rotta;
    a.appendChild(el('b', null, x.titolo));
    a.appendChild(el('span', null, x.sotto));
    const fatte = store.sessioniDi(x.id === 'nota' ? 'nota-tenuta' : x.id).length;
    if (fatte) a.appendChild(el('i', 'contatore', `${fatte} volte`));
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
    <p class="dim">L'app e la tua voce <b>non suonano mai insieme</b>: lei dà la nota, tace, e solo dopo misura. È anche il motivo per cui la misura è credibile — un programma che emette mentre ascolta si dà da solo la risposta che sperava.</p>
    <p class="dim">Il verdetto sta sulla frase, non sulla nota, e la tendenza conta più dell'istante.</p>
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
  '#/attacco': vistaAttacco,
  '#/intervalli': vistaIntervalli,
  '#/fiato': vistaFiato,
  '#/info': vistaInfo,
};

function vai() {
  // Ogni schermata che se ne va porta via i suoi ascoltatori e ferma il microfono: un
  // ciclo di lettura lasciato acceso continuerebbe a misurare da un'altra schermata, e
  // negli altri progetti della famiglia è esattamente il difetto che dà la sensazione
  // «l'app è piena di bug» senza poterne indicare uno.
  if (pulizia) { pulizia(); pulizia = null; }
  if (ascolto) ascolto.ferma();
  const vista = ROTTE[location.hash] || vistaCasa;
  const r = vista();
  if (typeof r === 'function') pulizia = r;
}

window.addEventListener('hashchange', vai);
vai();

// Per il collaudo in pagina.
window.__canto = { store, ESERCIZI };
