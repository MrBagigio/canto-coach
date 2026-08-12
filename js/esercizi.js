// Le decisioni degli esercizi: quale nota dare, e cosa dire di quello che è uscito.
//
// Tutto qui dentro è una funzione pura su numeri. Non tocca il DOM, non tocca l'audio, non
// tocca il microfono — e non è pignoleria: negli altri tre progetti della famiglia le
// decisioni che hanno sbagliato stavano tutte dentro un ciclo di disegno, dove non si
// possono collaudare. Qui il collaudo le interroga una per una.
//
// Il tono delle frasi è una decisione di prodotto, non gentilezza. Dire a qualcuno che il
// suo barré è muto è un'informazione; dirgli che la sua voce è calante è personale. Un'app
// che glielo ripete trenta volte è un'app che smette di aprire, anche avendo ragione tutte
// e trenta le volte. Quindi: il verdetto sta sulla FRASE e non sulla nota, la TENDENZA
// conta più dell'istante, e la tolleranza è larga.

import { MIDI_MIN, MIDI_MAX, INTERVALLI, nome } from './teoria.js';
import { scomponi, calo } from './vibrato.js';

/**
 * Quanto si può stare fuori su una nota tenuta prima che valga la pena dirlo.
 *
 * Non esiste un «giusto» nel canto come per un accordo: un buon cantante tira le terze,
 * scivola dentro le note, usa il vibrato. 35 centesimi è un terzo di semitono — largo per
 * un accordatore, giusto per una voce.
 *
 * Quello che invece si MISURA, ed è il vincolo vero: lo strumento sbaglia al massimo 7,5
 * centesimi su una nota tenuta (prova 0 del collaudo). La tolleranza deve stare molto
 * sopra quel numero, altrimenti l'app starebbe giudicando il rumore della propria misura
 * e lo chiamerebbe intonazione. Il collaudo verifica che ci sia almeno un fattore quattro.
 */
export const TOLLERANZA = 35;
export const INCERTEZZA_STRUMENTO = 7.5;

/** Sotto questa frazione di letture con una nota, non si giudica: non si è sentito abbastanza. */
export const COPERTURA_MINIMA = 0.5;

// ── Che nota dare ────────────────────────────────────────────────────────────

/**
 * La zona comoda, dai due estremi misurati.
 *
 * «La nota va data nella TUA ottava»: se l'app dà un La4 a un baritono, quello canta un
 * La3 e l'app dice che ha sbagliato di dodici semitoni — ha sbagliato l'app. Dopo la
 * misura dell'estensione questo non deve più succedere, ed è per questo che l'estensione
 * è il secondo esercizio e non un di più.
 *
 * La zona comoda non è tutta l'estensione: gli estremi sono dove si arriva, non dove si
 * sta. Si tiene la parte centrale, saltando una quarta dal basso e una terza dall'alto —
 * e su un'estensione stretta si stringe in proporzione invece di rovesciarsi.
 */
export function zonaComoda(estensione) {
  if (!estensione || estensione.grave == null || estensione.acuto == null) return null;
  const larghezza = estensione.acuto - estensione.grave;
  if (larghezza < 3) return { basso: estensione.grave, alto: estensione.acuto };
  const sotto = Math.min(5, Math.round(larghezza * 0.28));
  const sopra = Math.min(4, Math.round(larghezza * 0.22));
  return { basso: estensione.grave + sotto, alto: estensione.acuto - sopra };
}

/**
 * Una nota da dare, dentro la zona comoda.
 *
 * `caso` è un numero fra 0 e 1 passato da fuori invece di essere sorteggiato qui dentro:
 * una funzione che sorteggia non si collauda, e il collaudo di questa deve poter dire
 * «con qualunque sorteggio, la nota cade dentro la zona».
 */
export function notaDaDare(zona, caso = 0.5, { evita = [], distanzaMinima = 2 } = {}) {
  if (!zona) return null;
  // La zona si TAGLIA sulla banda che il rilevatore guarda davvero (70–1300 Hz). Dare una
  // nota fuori da lì vorrebbe dire chiedere di cantarla e poi dire «non ti sento» per
  // colpa propria. Se non resta niente si restituisce null: il chiamante deve avere
  // qualcosa da dire, non una nota inventata.
  const basso = Math.max(MIDI_MIN, Math.round(zona.basso));
  const alto = Math.min(MIDI_MAX, Math.round(zona.alto));
  if (alto < basso) return null;
  const possibili = [];
  for (let m = basso; m <= alto; m += 1) {
    if (evita.some((e) => Math.abs(e - m) < distanzaMinima)) continue;
    possibili.push(m);
  }
  const lista = possibili.length ? possibili : [Math.round((basso + alto) / 2)];
  return lista[Math.min(lista.length - 1, Math.floor(caso * lista.length))];
}

/**
 * La zona di partenza quando l'estensione non è ancora misurata.
 *
 * NON è una tabella di tipi vocali: è la nota che hai appena cantato tu. All'apertura
 * l'app non sa niente di te, e l'unica cosa onesta da fare è chiedertelo cantando invece
 * di indovinare da un menu. Una quinta sotto e una quinta sopra la tua nota comoda è una
 * zona in cui nessuno si fa male, e l'esercizio dell'estensione la sostituirà con quella
 * vera.
 */
export function zonaDaUnaNota(midiCantato) {
  const m = Math.round(midiCantato);
  return {
    basso: Math.max(MIDI_MIN, m - 5),
    alto: Math.min(MIDI_MAX, m + 5),
    provvisoria: true,
  };
}

// ── Cosa dire ────────────────────────────────────────────────────────────────

/** Un verdetto: un titolo, delle righe di misura, e se il passo si può chiudere. */
function verdetto(titolo, righe, promosso, dettaglio = '', valore = null) {
  return { titolo, righe, promosso, dettaglio, valore };
}

/**
 * La nota chiesta è stata cantata? — per l'esercizio dell'estensione.
 *
 * Non è la stessa domanda di «era intonata»: qui interessa solo se quella nota è uscita
 * dalla gola in modo riconoscibile. Due condizioni, e servono tutt'e due: che si sia
 * sentito abbastanza a lungo, e che quello che si è sentito fosse QUELLA nota e non
 * un'altra — chi non arriva a un acuto tipicamente canta l'ottava sotto senza accorgersene,
 * e senza questo controllo l'app gli attribuirebbe un'estensione che non ha.
 */
export function notaPresa(raccolta, { scartoMassimo = 150, msMinimi = 500 } = {}) {
  if (raccolta.dentro < COPERTURA_MINIMA) return { presa: false, motivo: 'non sentita abbastanza' };
  const s = raccolta.serie;
  // In millisecondi, non in numero di letture: la cadenza del ciclo cambia di quaranta
  // volte fra una pagina davanti e una in secondo piano.
  if (s.length * raccolta.dtMs < msMinimi) return { presa: false, motivo: 'troppo corta' };
  const mediana = [...s].sort((a, b) => a - b)[Math.floor(s.length / 2)];
  if (Math.abs(mediana) > scartoMassimo) {
    return { presa: false, motivo: `hai cantato ${Math.abs(mediana) > 900 ? 'un\'altra ottava' : 'un\'altra nota'}`, mediana };
  }
  return { presa: true, motivo: '', mediana };
}

const segno = (x, cifre = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(cifre)}`;

/**
 * Nota tenuta: intonazione media, calo, fermezza. Il cuore di tutto.
 *
 * L'ordine delle frasi non è casuale — si dice per primo quello su cui si può fare
 * qualcosa. Il calo è il difetto più comune e quello di cui da soli non ci si accorge,
 * quindi quando c'è viene prima dell'intonazione media: se cali, la media è una
 * conseguenza, non la causa.
 */
export const ATTACCO_DA_SALTARE_MS = 400;

export function giudicaNotaTenuta({ serie: tutta, dtMs, dentro }) {
  if (dentro < COPERTURA_MINIMA) {
    return verdetto('Non ti ho sentito abbastanza',
      [`nota riconosciuta in ${Math.round(dentro * 100)}% del tempo`], false,
      'Avvicina il telefono, oppure canta un po\' più forte: non è un giudizio sulla voce, è che nel microfono non c\'era abbastanza.');
  }
  // I primi 400 ms sono l'attacco: chi canta ci mette un momento a partire e a trovare la
  // nota. Includerli qui vorrebbe dire misurare l'attacco e chiamarlo tenuta — e l'attacco
  // ha un esercizio suo, dove viene giudicato con il metro giusto. Senza questo taglio una
  // partenza da un'altra nota gonfia l'oscillazione di oltre cento centesimi e la nota
  // tenuta meglio del mondo risulta instabile.
  const daSaltare = Math.min(Math.floor(tutta.length / 3), Math.round(ATTACCO_DA_SALTARE_MS / dtMs));
  const serie = tutta.slice(daSaltare);
  const v = scomponi(serie, dtMs);
  const c = calo(serie, dtMs);
  const righe = [];
  const media = v.media;
  const deriva = c ? c.calo : 0;

  righe.push(`intonazione media ${segno(media)} centesimi`);
  if (c) righe.push(`dall'inizio alla fine ${segno(deriva)} centesimi in ${c.durata.toFixed(1)} s`);
  // «Voce ferma» si scrive SOLO se il vibrato lo si è davvero potuto cercare. A cadenza
  // grossa `scomponi` non trova niente, e scrivere «voce ferma» sarebbe dichiarare una
  // cosa che non si è misurata — a chi magari sta facendo un vibrato perfetto.
  // «Voce ferma» va scritto solo se la voce era ferma davvero. Guidando l'app è uscita la
  // frase «voce ferma, oscillazione ±135 centesimi», che si contraddice da sola: una
  // sbandata di più di un semitono non è fermezza, è instabilità — e `scomponi` lo sapeva
  // (restituisce il motivo «oscillazione non periodica»), era la frase a non ascoltarlo.
  // La soglia non è inventata: è la stessa tolleranza dichiarata altrove.
  const instabile = !v.hz && v.vibratoMisurabile !== false && v.fermezza > TOLLERANZA;
  if (v.vibratoMisurabile === false) {
    righe.push(`vibrato non misurato (${v.motivo})`);
  } else if (v.hz) {
    righe.push(`vibrato ${v.hz.toFixed(1)} volte al secondo, ±${v.ampiezza.toFixed(0)} centesimi`);
  } else if (instabile) {
    righe.push(`oscillazione ±${v.fermezza.toFixed(0)} centesimi, senza regolarità`);
  } else {
    righe.push(`voce ferma, oscillazione ±${v.fermezza.toFixed(0)} centesimi`);
  }

  const calante = deriva < -TOLLERANZA * 0.6;
  const crescente = deriva > TOLLERANZA * 0.6;
  const fuori = Math.abs(media) > TOLLERANZA;

  let titolo;
  let dettaglio = '';
  if (instabile) {
    titolo = 'La nota ballava';
    dettaglio = `Sei andato su e giù di ±${v.fermezza.toFixed(0)} centesimi senza una regolarità: non è vibrato, è la nota che non sta ferma. L'intonazione media (${segno(media)}) qui conta poco — prima viene tenerla immobile, anche più bassa e più piano.`;
    return verdetto(titolo, righe, false, dettaglio);
  }
  if (calante) {
    titolo = 'Sei calato mentre la tenevi';
    dettaglio = `Hai perso ${Math.abs(deriva).toFixed(0)} centesimi strada facendo. È il difetto più comune che esista e da soli non ci si accorge: si parte giusti e si scende. Riprova pensando di spingere la nota un filo verso l'alto verso la fine.`;
  } else if (crescente) {
    titolo = 'Sei salito mentre la tenevi';
    dettaglio = `Hai guadagnato ${deriva.toFixed(0)} centesimi strada facendo.`;
  } else if (fuori) {
    titolo = media < 0 ? 'Sei stato sotto, ma fermo' : 'Sei stato sopra, ma fermo';
    dettaglio = `${Math.abs(media).toFixed(0)} centesimi ${media < 0 ? 'sotto' : 'sopra'} per tutta la nota — e questo è più facile da correggere di un calo: la nota era stabile, era solo un po' più in ${media < 0 ? 'basso' : 'alto'}.`;
  } else {
    titolo = 'Nota tenuta, dentro';
    dettaglio = v.hz
      ? 'E con un vibrato riconoscibile: quello è controllo, non instabilità.'
      : 'Intonazione e tenuta a posto.';
  }
  if (v.vibratoMisurabile === false) {
    dettaglio += ' Il vibrato non l\'ho potuto misurare: le letture sono arrivate troppo rade, di solito perché la pagina è finita in secondo piano. Tieni l\'app davanti mentre canti.';
  }
  return verdetto(titolo, righe, !calante && !crescente && !fuori, dettaglio);
}

/**
 * Attacco: atterri sulla nota o ci scivoli sopra da sotto?
 *
 * Si confronta il primo pezzetto con la parte stabile della stessa nota, non con il
 * bersaglio: così l'esercizio misura l'ATTACCO e non l'intonazione, che è già misurata
 * altrove. Uno che parte 80 centesimi sotto e ci arriva ha un problema di attacco anche
 * se la sua media finale è perfetta — anzi, soprattutto allora.
 */
export function giudicaAttacco({ serie, dtMs, dentro }, { finestraMs = 150 } = {}) {
  if (dentro < COPERTURA_MINIMA || serie.length * dtMs < 500) {
    return verdetto('Non ti ho sentito abbastanza', [], false,
      'Serve che la nota parta forte abbastanza da essere sentita subito.');
  }
  // L'attacco dura 150 ms: se le letture arrivano ogni 300 non ce n'è nemmeno una dentro,
  // e quello che uscirebbe non sarebbe una misura dell'attacco ma un numero a caso.
  if (dtMs > finestraMs / 2) {
    return verdetto('Non ho potuto misurare l\'attacco', [`letture ogni ${dtMs.toFixed(0)} ms, l'attacco dura ${finestraMs}`], false,
      'Le letture sono arrivate troppo rade, di solito perché la pagina è finita in secondo piano. Tieni l\'app davanti mentre canti.');
  }
  const n = Math.max(2, Math.round(finestraMs / dtMs));
  const primo = serie.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const stabile = serie.slice(Math.round(400 / dtMs), Math.round(1200 / dtMs));
  if (!stabile.length) return verdetto('Nota troppo corta', [], false, 'Tienila almeno un secondo e mezzo.');
  const arrivo = stabile.reduce((a, b) => a + b, 0) / stabile.length;
  const scivolata = primo - arrivo;
  const righe = [
    `primi ${finestraMs} ms: ${segno(scivolata)} centesimi rispetto a dove sei arrivato`,
  ];
  if (scivolata < -25) {
    return verdetto('Ci sei scivolato dentro da sotto', righe, false,
      `Sei partito ${Math.abs(scivolata).toFixed(0)} centesimi sotto e ci sei salito. È l'abitudine più diffusa e la si sente: la nota comincia "molle". Prova a sentirla in testa prima di aprire bocca, e ad attaccarla già dove sta.`);
  }
  if (scivolata > 25) {
    return verdetto('Ci sei arrivato da sopra', righe, false,
      'Meno comune dello scivolare da sotto, e di solito vuol dire che stai spingendo.');
  }
  return verdetto('Attacco pulito', righe, true, 'Sei atterrato sulla nota, non ci sei scivolato sopra.');
}

/**
 * Intervallo: la distanza cantata contro quella chiesta.
 *
 * Il numero che conta è la distanza, non l'intonazione assoluta: se la nota di partenza
 * l'hai presa dieci centesimi sotto e sei salito di una quinta esatta, la quinta è esatta.
 * È l'esercizio dell'orecchio, non dell'accordatura.
 */
export function giudicaIntervallo({ centDiPartenza, centDiArrivo, semitoni }) {
  const cantato = centDiArrivo - centDiPartenza;
  const atteso = semitoni * 100;
  const errore = cantato - atteso;
  const info = INTERVALLI.find((i) => i.semitoni === Math.abs(semitoni));
  const righe = [
    `${info ? info.nome : `${semitoni} semitoni`}: cantata ${(cantato / 100).toFixed(2)} semitoni (${segno(errore)} centesimi)`,
  ];
  if (Math.abs(errore) > 90) {
    const semitoniSbagliati = Math.round(errore / 100);
    return verdetto('Intervallo sbagliato', righe, false,
      `Hai cantato ${Math.abs(semitoniSbagliati)} semitoni ${semitoniSbagliati > 0 ? 'in più' : 'in meno'}. Non è questione di intonazione: è proprio un altro intervallo. Riascolta le due note una dopo l'altra.`);
  }
  if (Math.abs(errore) > TOLLERANZA + 15) {
    return verdetto(errore < 0 ? 'Intervallo un po\' stretto' : 'Intervallo un po\' largo', righe, false,
      `${Math.abs(errore).toFixed(0)} centesimi. ${errore < 0 ? 'Salendo si tende a non arrivarci: è normalissimo e si corregge sentendo la nota alta PRIMA di cantarla.' : 'Ci sei andato oltre.'}`);
  }
  return verdetto('Intervallo giusto', righe, true, '');
}

/**
 * Fiato: quanti secondi hai tenuto la nota DENTRO tolleranza, non quanti hai fatto rumore.
 *
 * La differenza conta: una nota tenuta venti secondi che scivola via non è fiato, è una
 * sirena. E il numero serve a essere confrontato con sé stesso fra due settimane, non con
 * quello di un altro — 8–12 secondi da principiante, 20–30 da allenato.
 */
export function giudicaFiato({ serieBuchi, serie, dtMs }, { tolleranza = TOLLERANZA + 15 } = {}) {
  // Si legge la serie CON i buchi: il silenzio azzera il conteggio come una stonatura.
  // La prima stesura leggeva la serie tappata, dove l'ultimo valore buono sopravvive al
  // silenzio: una nota da 5 secondi seguita da 27 di niente misurava 32 secondi di fiato.
  // Il cantante sintetico cantava tutta la finestra, e il difetto dormiva lì sotto.
  const letture = serieBuchi || serie;
  let miglior = 0;
  let corrente = 0;
  let conVoce = 0;
  for (const c of letture) {
    if (c !== null && Math.abs(c) <= tolleranza) {
      corrente += dtMs;
      miglior = Math.max(miglior, corrente);
    } else corrente = 0;
    if (c !== null) conVoce += 1;
  }
  const secondi = miglior / 1000;
  const righe = [`${secondi.toFixed(1)} secondi dentro ${tolleranza} centesimi`,
    `${((conVoce * dtMs) / 1000).toFixed(1)} secondi di voce in tutto`];
  return verdetto(`${secondi.toFixed(1)} secondi`, righe, secondi >= 8,
    secondi < 8
      ? 'Sotto gli otto secondi. Non è una pagella: è il numero da guardare fra due settimane.'
      : 'Da qui in avanti quello che conta è vedere questo numero salire, non batterlo oggi.',
    secondi);
}

/**
 * Scale e agilità: quante note hai preso, e quanto ci hai messo.
 *
 * Il criterio è a due facce e servono tutte e due: prendere le note e stare nel tempo.
 * Prenderle tutte a metà velocità non è agilità; farle a velocità doppia saltandone due
 * nemmeno. Per questo il verdetto promuove solo se entrambe reggono, e dice quale delle
 * due ha ceduto — che è l'unica informazione su cui si può fare qualcosa.
 */
export function giudicaAgilita(confronto, { msAttesi }) {
  const { prese, su, durataMs, scartoMedio } = confronto;
  const righe = [
    `${prese} note su ${su}`,
    `${(durataMs / 1000).toFixed(1)} s contro ${(msAttesi / 1000).toFixed(1)} chiesti`,
  ];
  if (scartoMedio !== null) righe.push(`intonazione media delle note prese ${segno(scartoMedio)} centesimi`);
  if (prese < su) {
    const mancate = confronto.esiti.filter((e) => !e.cantata).length;
    return verdetto(`Ne hai prese ${prese} su ${su}`, righe, false,
      `${mancate === 1 ? 'Una nota' : `${mancate} note`} non ${mancate === 1 ? 'è uscita' : 'sono uscite'} o ${mancate === 1 ? 'era' : 'erano'} troppo lontana dalla scala. Rifalla più lenta: l'agilità si costruisce da ferma, non da veloce.`);
  }
  const troppoLento = durataMs > msAttesi * 1.35;
  if (troppoLento) {
    return verdetto('Tutte prese, ma più lenta del richiesto', righe, false,
      'Le note ci sono tutte: adesso è solo questione di tenerle nel tempo.');
  }
  return verdetto('Scala pulita, a tempo', righe, true,
    'Prese tutte e dentro il tempo: la prossima volta si può stringere.');
}

/** Una melodia cantata a memoria: stesse regole della scala, parole diverse. */
export function giudicaMelodia(confronto) {
  const { prese, su, scartoMedio } = confronto;
  const righe = [`${prese} note su ${su}`];
  if (scartoMedio !== null) righe.push(`intonazione media ${segno(scartoMedio)} centesimi`);
  const buchi = confronto.esiti.map((e, i) => (e.cantata ? null : i + 1)).filter(Boolean);
  if (prese === su) {
    return verdetto('Melodia presa tutta', righe, true,
      Math.abs(scartoMedio || 0) > TOLLERANZA
        ? `Le note giuste, ma tutta la melodia sta ${scartoMedio < 0 ? 'sotto' : 'sopra'} di ${Math.abs(scartoMedio).toFixed(0)} centesimi: l'hai trasportata. È un difetto diverso e più piccolo di stonare.`
        : 'Note e intonazione a posto.');
  }
  return verdetto(`Ne hai prese ${prese} su ${su}`, righe, false,
    `${buchi.length === 1 ? `La nota numero ${buchi[0]} non c'è` : `Mancano le note ${buchi.join(', ')}`}. Riascoltala: la melodia si canta quando la si sente in testa, non mentre la si indovina.`);
}

// ── Il passaggio di registro ─────────────────────────────────────────────────

/**
 * Dove la voce cambia registro, cercato in un glissando lento in salita.
 *
 * Due cose si vedono al microfono quando si passa da un registro all'altro: il LIVELLO fa
 * un gradino (di solito verso il basso, perché il registro alto è più sottile finché non
 * è allenato) e il TIMBRO cambia — lo spettro si impoverisce di armoniche, cioè il
 * baricentro spettrale rispetto alla fondamentale scende. Nessuna delle due, da sola, è
 * una prova; insieme, e se il gradino è NETTO rispetto a come quelle due grandezze
 * ballano normalmente, sono un indizio serio.
 *
 * La soglia non è un numero scelto: il salto deve staccarsi dal passo TIPICO fra due
 * semitoni vicini nello stesso glissando, misurato lì per lì. Chi non ha un passaggio
 * evidente — o chi ha mosso il telefono mentre saliva — riceve «non l'ho trovato», che è
 * la risposta giusta molto più spesso di quanto sia comodo ammettere.
 */
export const STACCO_MINIMO = 2.5;

/**
 * Quanto deve essere grande il gradino IN ASSOLUTO, oltre che rispetto agli altri.
 *
 * Il punteggio da solo è un rapporto contro il passo tipico del glissando, e un rapporto
 * ha un buco nero al denominatore: su una salita liscissima il passo tipico tende a zero e
 * qualunque bricciolo diventa «dieci volte il tipico». Non è teoria — guidando l'app è
 * uscito un passaggio dichiarato con un gradino di **−0,0 dB**, cioè il nulla presentato
 * come una scoperta. È [[il difetto numero uno]] di questa famiglia in una veste nuova:
 * dichiarare qualcosa che non si sta misurando.
 *
 * Questi due numeri sono il pavimento sotto cui non si guarda più il rapporto. Vengono da
 * cosa può fare la stanza invece della voce: due decibel se ti muovi appena rispetto al
 * telefono, e un decimo di baricentro se cambia il rumore di fondo. Sotto, non è un
 * passaggio: è un microfono.
 */
export const DB_MINIMO = 2.0;
export const TIMBRO_MINIMO = 0.12;

export function trovaPassaggio(letture, { minSemitoni = 7, perCasella = 3 } = {}) {
  const caselle = new Map();
  for (const l of letture) {
    if (!Number.isFinite(l.midi)) continue;
    const k = Math.round(l.midi);
    if (!caselle.has(k)) caselle.set(k, { midi: k, db: [], br: [] });
    caselle.get(k).db.push(l.dbfs);
    if (Number.isFinite(l.brillantezza)) caselle.get(k).br.push(l.brillantezza);
  }
  const mediana = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  const punti = [...caselle.values()]
    .filter((c) => c.db.length >= perCasella)
    .sort((a, b) => a.midi - b.midi)
    .map((c) => ({ midi: c.midi, db: mediana(c.db), br: mediana(c.br) }));

  if (punti.length < minSemitoni) {
    return { trovato: false, motivo: `il glissando ha coperto ${punti.length} semitoni, ne servono almeno ${minSemitoni}`, punti };
  }
  const passi = [];
  for (let i = 1; i < punti.length; i += 1) {
    if (punti[i].midi - punti[i - 1].midi > 2) continue;   // buco: non è un passo
    passi.push({
      midi: punti[i].midi,
      dDb: punti[i].db - punti[i - 1].db,
      dBr: (punti[i].br !== null && punti[i - 1].br !== null) ? punti[i].br - punti[i - 1].br : 0,
    });
  }
  if (passi.length < minSemitoni - 1) {
    return { trovato: false, motivo: 'il glissando è troppo spezzettato per confrontare i passi', punti };
  }
  // Il pavimento sui «tipici» non è prudenza: senza, il rapporto ha un buco nero al
  // denominatore e su una salita liscia dichiara un passaggio dove non c'è niente.
  const tipico = (chiave, pavimento) => {
    const v = passi.map((p) => Math.abs(p[chiave])).sort((a, b) => a - b);
    return Math.max(v[Math.floor(v.length / 2)], pavimento);
  };
  const tDb = tipico('dDb', DB_MINIMO / 4);
  const tBr = tipico('dBr', TIMBRO_MINIMO / 4);
  const punteggiati = passi.map((p) => ({ ...p, punteggio: Math.abs(p.dDb) / tDb + Math.abs(p.dBr) / tBr }));
  const migliore = punteggiati.reduce((a, b) => (b.punteggio > a.punteggio ? b : a));
  const abbastanzaGrande = Math.abs(migliore.dDb) >= DB_MINIMO || Math.abs(migliore.dBr) >= TIMBRO_MINIMO;
  if (migliore.punteggio < STACCO_MINIMO * 2 || !abbastanzaGrande) {
    return {
      trovato: false,
      motivo: abbastanzaGrande
        ? 'nessun gradino si stacca dal resto: o non hai un passaggio evidente, o non si vede da questo microfono'
        : `il gradino più grosso è di ${Math.abs(migliore.dDb).toFixed(1)} dB e ${Math.abs(migliore.dBr).toFixed(2)} di timbro: troppo piccolo per non essere il microfono`,
      punti,
      tipico: { db: tDb, br: tBr },
    };
  }
  return {
    trovato: true,
    midi: migliore.midi,
    dDb: migliore.dDb,
    dBr: migliore.dBr,
    punteggio: migliore.punteggio,
    punti,
    tipico: { db: tDb, br: tBr },
  };
}

export function giudicaPassaggio(esito) {
  if (!esito.trovato) {
    return verdetto('Non ho trovato un passaggio netto', [esito.motivo], true,
      'Non vuol dire che non ce l\'hai: vuol dire che da qui non si vede. Un passaggio si sente meglio di quanto si misuri, e molte voci non ne hanno uno solo. Riprova salendo più lentamente, senza spostare il telefono.');
  }
  return verdetto(`Attorno al ${nome(esito.midi)}`, [
    `il livello fa un gradino di ${esito.dDb >= 0 ? '+' : '−'}${Math.abs(esito.dDb).toFixed(1)} dB`,
    `il timbro cambia di ${esito.dBr >= 0 ? '+' : '−'}${Math.abs(esito.dBr).toFixed(2)} (baricentro rispetto alla fondamentale)`,
    `il gradino è ${(esito.punteggio / 2).toFixed(1)} volte il passo tipico di questo glissando`,
  ], true,
    `Sapere dove sta il tuo passaggio cambia cosa ha senso studiare: le note lì attorno vanno lavorate piano e senza spingere, ed è normale che siano le più scomode. Rifallo un altro giorno — se esce sempre lì, è lì.`);
}

// ── L'estensione ─────────────────────────────────────────────────────────────

/**
 * La macchina a stati dell'esercizio dell'estensione.
 *
 * Due regole che vengono dal §6 e non sono negoziabili, perché misurare l'estensione
 * spingendo fa male alla voce:
 *   ① si chiede la più acuta COMODA, non la più acuta;
 *   ② «non ci arrivo» è un pulsante, ed è il segnale principale — più di qualunque misura.
 * E si dichiara che il numero cambia con la giornata, invece di scriverlo come se fosse
 * una proprietà della persona.
 *
 * Terza regola, che viene dallo strumento: sotto i 70 Hz il rilevatore non guarda. Quando
 * si tocca quel fondo l'app deve dire «qui non ti so più misurare», non «non ci arrivi».
 * Sono due frasi molto diverse per chi le riceve.
 */
export function estensioneInizio(midiPartenza) {
  return {
    verso: 'giu',
    corrente: Math.round(midiPartenza),
    grave: Math.round(midiPartenza),
    acuto: Math.round(midiPartenza),
    finito: false,
    motivoFine: '',
  };
}

export function estensionePasso(stato, esito) {
  const s = { ...stato };
  const preso = esito === 'presa';
  if (preso) {
    if (s.verso === 'giu') s.grave = Math.min(s.grave, s.corrente);
    else s.acuto = Math.max(s.acuto, s.corrente);
  }

  const cambiaVerso = () => {
    if (s.verso === 'giu') { s.verso = 'su'; s.corrente = s.acuto + 1; return; }
    s.finito = true;
  };

  if (!preso) { cambiaVerso(); if (s.verso === 'su') s.motivoFine = ''; return s; }

  const prossima = s.verso === 'giu' ? s.corrente - 1 : s.corrente + 1;
  if (prossima < MIDI_MIN) {
    s.motivoFine = `Sotto ${nome(MIDI_MIN)} il rilevatore non guarda più: non è che non ci arrivi, è che qui non ti so misurare.`;
    cambiaVerso();
    return s;
  }
  if (prossima > MIDI_MAX) {
    s.motivoFine = `Sopra ${nome(MIDI_MAX)} il rilevatore non guarda più: non è che non ci arrivi, è che qui non ti so misurare.`;
    s.finito = true;
    return s;
  }
  s.corrente = prossima;
  return s;
}

/**
 * Sotto quanti semitoni un'estensione non è una misura ma un incidente.
 *
 * Chiunque canti ha più di una terza minore. Se ne è uscita di meno, è successo qualcosa
 * d'altro: l'app stava dando note nel posto sbagliato, oppure il microfono non ha sentito,
 * oppure si è premuto «non ci arrivo» al primo colpo. Salvarla come «la tua estensione»
 * sarebbe il peggiore dei difetti possibili qui, perché quel numero decide TUTTE le note
 * che l'app darà da qui in avanti: una zona comoda di zero semitoni vuol dire un'app che
 * ti farà cantare per sempre la stessa nota.
 */
export const ESTENSIONE_MINIMA = 3;

export function estensioneRiassunto(stato) {
  const semitoni = stato.acuto - stato.grave;
  return {
    grave: stato.grave,
    acuto: stato.acuto,
    semitoni,
    ottave: semitoni / 12,
    attendibile: semitoni >= ESTENSIONE_MINIMA,
    testo: `${nome(stato.grave)} → ${nome(stato.acuto)}, ${semitoni} semitoni (${(semitoni / 12).toFixed(1)} ottave)`,
  };
}
