// Ripetizione spaziata, ridotta all'osso.
//
// SM-2 senza la parte che non serve qui: niente voto da 0 a 5, solo «l'hai riconosciuto o
// no». Un'app che chiede quanto ti è sembrato difficile su una scala a sei livelli, mentre
// stai facendo un esercizio d'orecchio, sta chiedendo la cosa sbagliata nel momento
// sbagliato — e la risposta sarebbe rumore.
//
// La regola: se sbagli si torna all'inizio, se azzecchi l'intervallo fra due ripassi si
// allarga. È l'unica parte di SM-2 che porta davvero il beneficio.

const GIORNO = 24 * 3600 * 1000;
/** I salti, in giorni. Chi azzecca sale di un gradino, chi sbaglia torna al primo. */
export const SALTI = [0, 1, 3, 7, 16, 35];

export function schedaNuova(id) {
  return { id, gradino: 0, quando: 0, viste: 0, giuste: 0 };
}

/** Aggiorna una scheda dopo una risposta. Funzione pura: `ora` arriva da fuori. */
export function rispondi(scheda, giusto, ora) {
  const gradino = giusto ? Math.min(SALTI.length - 1, scheda.gradino + 1) : 0;
  return {
    ...scheda,
    gradino,
    viste: scheda.viste + 1,
    giuste: scheda.giuste + (giusto ? 1 : 0),
    quando: ora + SALTI[gradino] * GIORNO,
  };
}

/**
 * Le schede da RIvedere adesso, le più in ritardo per prime.
 *
 * «Rivedere» vuol dire che le hai già viste almeno una volta: una scheda nuova ha
 * `quando: 0`, quindi senza il controllo sulle viste risulterebbe la più in ritardo di
 * tutte e passerebbe davanti a ogni ripasso vero. È il difetto che il collaudo ha trovato:
 * il file dichiarava «prima le scadute, poi le nuove» e il codice faceva l'opposto.
 *
 * L'ordine giusto è quello dichiarato, e non è un gusto: un ripasso è scaduto perché sta
 * per essere dimenticato — ha una fretta che una scheda mai vista non ha.
 */
export function daRivedere(schede, ora) {
  return schede.filter((s) => s.viste > 0 && s.quando <= ora).sort((a, b) => a.quando - b.quando);
}

/** Le schede mai viste, nell'ordine in cui sono state definite (dalla più facile). */
export function nuove(schede) {
  return schede.filter((s) => s.viste === 0);
}

/**
 * Quale far vedere adesso.
 *
 * Prima quelle scadute; se non ce n'è nessuna, quella MAI vista — perché un'app che ha
 * finito i ripassi deve insegnare qualcosa di nuovo, non ripetere all'infinito quello che
 * sai già. Se non c'è più niente di nuovo, la meno consolidata.
 */
export function prossima(schede, ora) {
  if (!schede.length) return null;
  const scadute = daRivedere(schede, ora);
  if (scadute.length) return scadute[0];
  const mai = nuove(schede);
  if (mai.length) return mai[0];
  return [...schede].sort((a, b) => a.gradino - b.gradino || a.quando - b.quando)[0];
}

/** Quanto ne sai, da 0 a 1: la media dei gradini. Serve alla casa, non al giudizio. */
export function consolidamento(schede) {
  if (!schede.length) return 0;
  return schede.reduce((s, x) => s + x.gradino, 0) / (schede.length * (SALTI.length - 1));
}
