// Separare l'INTONAZIONE dall'OSCILLAZIONE.
//
// È la trappola ③ dell'AVVIO, e non è un dettaglio di algoritmo: è il punto in cui un
// coach di canto o dice qualcosa di vero o insulta chi sta cantando bene.
//
// Un rilevatore nato sulle corde vede una serie di letture e la media, perché una corda
// pizzicata ha UN'altezza e tutto il resto è disturbo. Una voce cantata bene NON ha
// un'altezza sola: oscilla di 4–7 volte al secondo, di ±20–100 centesimi, e quell'oscillazione
// è la cosa che si studia per anni. Mediarla via è sbagliato due volte — si butta la misura
// più interessante che l'app potrebbe dare, e si dichiara «instabile» una voce che sta
// facendo esattamente la cosa giusta.
//
// Qui la serie di letture si scompone in tre pezzi, ognuno dei quali è un esercizio di §2:
//   media   → l'intonazione (nota tenuta)
//   deriva  → il calo, il difetto più comune e quello di cui da soli non ci si accorge
//   residuo → il vibrato (frequenza e ampiezza), e la fermezza di chi il vibrato non lo fa
//
// Tutto qui dentro è una funzione pura su un array di numeri: si collauda senza microfono,
// senza audio e senza aspettare. Le decisioni che hanno sbagliato negli altri progetti
// stavano tutte dentro un ciclo di disegno, dove non si possono provare.

/** Vibrato cantato: sotto 3,5 Hz è un'onda, sopra 9 è un tremolo — fuori non si cerca. */
export const HZ_MIN = 3.5;
export const HZ_MAX = 9.0;

/**
 * Il passo di lettura più grosso con cui un vibrato è ancora misurabile.
 *
 * Si RICAVA dalla banda, non si sceglie: per vedere un'oscillazione a 9 Hz servono almeno
 * tre letture per periodo, cioè 1/(3·9) = 37 ms. Sopra, l'autocorrelazione non ha
 * abbastanza punti e restituisce «nessun vibrato» — che è una risposta indistinguibile da
 * «voce ferma» e verrebbe scritta a schermo come tale.
 *
 * Non è un caso di scuola. Il ciclo di lettura gira su `setInterval` a 25 ms, e un browser
 * che tiene la pagina in secondo piano lo strozza a 1000: se l'utente cambia scheda mentre
 * tiene la nota, l'app riceve quaranta volte meno letture e — senza questo controllo —
 * dichiarerebbe «voce ferma» a chi sta facendo un vibrato perfetto. È il difetto numero
 * uno di questa famiglia di progetti: dichiarare ciò che non si sta misurando.
 */
export const PASSO_MASSIMO_MS = 1000 / (3 * HZ_MAX);

/**
 * Retta ai minimi quadrati su una serie campionata a passo fisso.
 * @returns {{intercetta:number, pendenza:number}} pendenza in unità/secondo
 */
export function retta(valori, dtMs) {
  const n = valori.length;
  if (n < 2) return { intercetta: n ? valori[0] : 0, pendenza: 0 };
  const dt = dtMs / 1000;
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const x = i * dt;
    sx += x; sy += valori[i]; sxx += x * x; sxy += x * valori[i];
  }
  const den = n * sxx - sx * sx;
  const pendenza = den !== 0 ? (n * sxy - sx * sy) / den : 0;
  return { intercetta: (sy - pendenza * sx) / n, pendenza };
}

/**
 * Scompone una serie di scarti in centesimi.
 *
 * @param {number[]} centesimi scarti dal bersaglio, uno per lettura
 * @param {number} dtMs passo fra due letture, in millisecondi
 * @returns {{
 *   media:number, deriva:number, hz:number|null, ampiezza:number,
 *   fermezza:number, confidenza:number, misurabile:boolean, motivo:string
 * }}
 *   `media` centesimi medi (l'intonazione); `deriva` centesimi al secondo (il calo, negativo
 *   se cali); `hz` frequenza del vibrato o null se non ce n'è uno riconoscibile; `ampiezza`
 *   semi-escursione in centesimi; `fermezza` deviazione standard del residuo (quanto balla
 *   una voce che il vibrato NON lo sta facendo); `confidenza` quanto è periodico il residuo,
 *   da 0 a 1.
 */
export function scomponi(centesimi, dtMs) {
  const n = centesimi.length;
  const durata = (n * dtMs) / 1000;
  // Due periodi del vibrato più lento sono il minimo per poter dire «è periodico»: sotto,
  // qualunque numero uscirebbe sarebbe una parola messa su una curva che non si è vista
  // abbastanza. Meglio dichiararlo non misurabile.
  const minimo = 2 / HZ_MIN;
  if (n < 8 || durata < minimo) {
    const { intercetta, pendenza } = retta(centesimi, dtMs);
    return {
      media: n ? centesimi.reduce((a, b) => a + b, 0) / n : 0,
      deriva: pendenza,
      intercetta,
      hz: null,
      ampiezza: 0,
      fermezza: 0,
      confidenza: 0,
      misurabile: false,
      // Anche qui, esplicito: senza questo, chi controlla `vibratoMisurabile === false`
      // non vede il caso «serie corta» e scrive «voce ferma ±0» su una misura mai fatta.
      vibratoMisurabile: false,
      motivo: `servono almeno ${minimo.toFixed(1)} s di nota tenuta, ce ne sono ${durata.toFixed(2)}`,
    };
  }

  const media = centesimi.reduce((a, b) => a + b, 0) / n;
  const { intercetta, pendenza } = retta(centesimi, dtMs);
  // Media e calo sopravvivono a un passo grosso; il vibrato no. Si dichiara quello che si
  // può ancora dire, e si TACE su quello che non si sa — invece di dire «voce ferma».
  if (dtMs > PASSO_MASSIMO_MS) {
    return {
      media,
      deriva: pendenza,
      intercetta,
      hz: null,
      ampiezza: 0,
      fermezza: 0,
      confidenza: 0,
      misurabile: false,
      vibratoMisurabile: false,
      motivo: `letture ogni ${dtMs.toFixed(0)} ms: per vedere un vibrato ne servono almeno tre per periodo, cioè una ogni ${PASSO_MASSIMO_MS.toFixed(0)} ms o meno`,
    };
  }
  // Si toglie la RETTA, non la media: se la voce cala, il calo non è vibrato e sottraendo
  // solo la media resterebbe dentro il residuo a gonfiare l'ampiezza.
  const dt = dtMs / 1000;
  const residuo = centesimi.map((v, i) => v - (intercetta + pendenza * i * dt));

  let energia0 = 0;
  for (const v of residuo) energia0 += v * v;
  const fermezza = Math.sqrt(energia0 / n);
  if (energia0 <= 0) {
    return { media, deriva: pendenza, intercetta, hz: null, ampiezza: 0, fermezza: 0, confidenza: 0, misurabile: true, motivo: 'serie piatta' };
  }

  // Autocorrelazione normalizzata sui ritardi che corrispondono alla banda del vibrato.
  const lagMin = Math.max(1, Math.floor(1 / (HZ_MAX * dt)));
  const lagMax = Math.min(Math.floor(n / 2), Math.ceil(1 / (HZ_MIN * dt)));
  if (lagMax <= lagMin + 1) {
    return { media, deriva: pendenza, intercetta, hz: null, ampiezza: 0, fermezza, confidenza: 0, misurabile: true, motivo: 'passo di lettura troppo grosso per questa banda' };
  }
  const curva = new Float64Array(lagMax - lagMin + 1);
  let migliore = -Infinity;
  let miglioreLag = -1;
  for (let lag = lagMin; lag <= lagMax; lag += 1) {
    let cross = 0; let ea = 0; let eb = 0;
    for (let i = 0; i + lag < n; i += 1) {
      cross += residuo[i] * residuo[i + lag];
      ea += residuo[i] * residuo[i];
      eb += residuo[i + lag] * residuo[i + lag];
    }
    const norm = ea > 0 && eb > 0 ? cross / Math.sqrt(ea * eb) : 0;
    curva[lag - lagMin] = norm;
    if (norm > migliore) { migliore = norm; miglioreLag = lag; }
  }

  // Interpolazione parabolica: senza, il passo di lettura quantizza la frequenza. A 25 ms
  // di cadenza, fra il ritardo 7 e l'8 ci sono 5,7 e 5,0 Hz — un salto che si vedrebbe.
  let lag = miglioreLag;
  const i0 = miglioreLag - lagMin;
  if (i0 > 0 && i0 < curva.length - 1) {
    const den = 2 * (2 * curva[i0] - curva[i0 - 1] - curva[i0 + 1]);
    if (den !== 0) lag += (curva[i0 + 1] - curva[i0 - 1]) / den;
  }
  const hz = 1 / (lag * dt);
  const confidenza = Math.max(0, Math.min(1, migliore));

  // Ampiezza: la semi-escursione della sinusoide equivalente. Per una sinusoide pura vale
  // RMS·√2; su una serie che sinusoide non è, resta la definizione più onesta disponibile
  // (l'energia c'è comunque, e il picco singolo non è una misura).
  const ampiezza = fermezza * Math.SQRT2;

  // Sotto una certa periodicità NON è vibrato: è una voce che balla. Sono due verdetti
  // opposti per lo studente — «bel controllo» contro «tienila ferma» — e la differenza è
  // esattamente questo numero. La soglia sta qui e non dentro una vista, così si può
  // spostare misurando invece che a naso.
  const periodico = confidenza >= 0.45;
  return {
    media,
    deriva: pendenza,
    intercetta,
    hz: periodico ? hz : null,
    ampiezza: periodico ? ampiezza : 0,
    fermezza,
    confidenza,
    misurabile: true,
    vibratoMisurabile: true,
    motivo: periodico ? '' : 'oscillazione non periodica: è instabilità, non vibrato',
  };
}

/**
 * Il calo: quanto sei sceso fra l'inizio e la fine della nota tenuta.
 *
 * L'AVVIO lo definisce come «scarto a 0,5 s contro scarto a 4 s», e la parte da 0,5 s è
 * giusta e va tenuta: i primi 500 ms sono l'attacco, dove ancora si sta cercando la nota,
 * e includerli misurerebbe l'attacco chiamandolo calo.
 *
 * La differenza fra due finestre, però, è un cattivo stimatore quando c'è il vibrato, e
 * questo NON è un dettaglio teorico: sul banco, con un calo vero di −6 centesimi al secondo
 * e un vibrato di ±40, le due finestre dicevano −17,4 centesimi al posto dei −23,4 veri.
 * Sei centesimi di errore su una misura che vale una ventina: un quarto. Il motivo è che
 * una finestra di 600 ms contiene 3,3 periodi di vibrato, e quel 0,3 non si media via.
 *
 * La retta ai minimi quadrati su TUTTA la nota invece il vibrato lo annulla davvero (misura
 * −3,98 su −4,00 con ±50 di vibrato addosso), perché usa tutti i campioni e l'oscillazione
 * è simmetrica attorno alla retta. Quindi il numero che l'app mostra viene dalla retta;
 * le due finestre restano come controprova, e quando le due stime divergono molto vuol dire
 * che la nota non è una retta più un vibrato — è successo qualcos'altro.
 */
export function calo(centesimi, dtMs, { daMs = 500, finestraMs = 600 } = {}) {
  const primo = Math.round(daMs / dtMs);
  const per = Math.max(1, Math.round(finestraMs / dtMs));
  const utile = centesimi.slice(primo);
  if (utile.length < per * 2) return null;
  const { intercetta, pendenza } = retta(utile, dtMs);
  const durata = ((utile.length - 1) * dtMs) / 1000;
  const fetta = (arr, i0) => {
    const s = arr.slice(i0, i0 + per);
    return s.reduce((a, b) => a + b, 0) / s.length;
  };
  const inizio = fetta(utile, 0);
  const fine = fetta(utile, utile.length - per);
  return {
    calo: pendenza * durata,       // il numero buono: dalla retta
    pendenza,
    durata,
    inizio,
    fine,
    caloFinestre: fine - inizio,   // la controprova, sensibile al vibrato
  };
}
