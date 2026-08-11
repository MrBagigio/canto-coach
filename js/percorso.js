// Il percorso: i gradini del §2 nell'ordine, ognuno con un criterio d'uscita MISURATO.
//
// «Ogni gradino ha un criterio d'uscita misurato; la ripetizione spaziata decide cosa
// rivedere.» Il punto è che il criterio non sia una spunta che si mette da soli né un
// contatore di volte: due sessioni buone di fila su cose diverse valgono più di venti
// tentativi di cui uno riuscito, e la differenza la può vedere solo l'app.
//
// Un gradino non si CHIUDE mai per sempre: si dichiara «fatto», e resta lì. Il canto non
// è una lista di cose da spuntare, e un'app che ti toglie l'esercizio di nota tenuta perché
// «l'hai già superato» ti toglie proprio quello che dovresti fare tutti i giorni.

export const GRADINI = [
  {
    id: 'nota', titolo: 'Nota tenuta', rotta: '#/nota',
    sotto: 'La prima lezione di qualunque insegnante: una nota, tenuta ferma.',
    obiettivo: 'due note tenute dentro tolleranza, di fila',
    criterio: (s) => diFila(s.filter((x) => x.esercizio === 'nota-tenuta'), 2),
  },
  {
    id: 'estensione', titolo: 'La tua estensione', rotta: '#/estensione',
    sotto: 'I due numeri da cui l\'app ricava ogni nota che ti darà.',
    obiettivo: 'misurata almeno una volta',
    criterio: (s, d) => !!d.estensione,
  },
  {
    id: 'passaggio', titolo: 'Il tuo passaggio', rotta: '#/passaggio',
    sotto: 'Un glissando lento in salita, cercando il punto dove la voce cambia registro.',
    obiettivo: 'provato almeno una volta — anche «non trovato» è una risposta',
    criterio: (s) => s.some((x) => x.esercizio === 'passaggio'),
  },
  {
    id: 'attacco', titolo: 'Attacco pulito', rotta: '#/attacco',
    sotto: 'Atterrare sulla nota invece di scivolarci sopra da sotto.',
    obiettivo: 'tre attacchi puliti di fila',
    criterio: (s) => diFila(s.filter((x) => x.esercizio === 'attacco'), 3),
  },
  {
    id: 'intervalli', titolo: 'Intervalli', rotta: '#/intervalli',
    sotto: 'Terza, quarta, quinta, ottava: il cuore delle lezioni.',
    obiettivo: 'quattro intervalli giusti di fila',
    criterio: (s) => diFila(s.filter((x) => x.esercizio === 'intervalli'), 4),
  },
  {
    id: 'fiato', titolo: 'Fiato', rotta: '#/fiato',
    sotto: 'Quanti secondi tieni la nota dentro tolleranza. Un numero che sale.',
    obiettivo: 'una nota tenuta 12 secondi dentro tolleranza',
    criterio: (s) => s.some((x) => x.esercizio === 'fiato' && (x.secondi || 0) >= 12),
  },
  {
    id: 'agilita', titolo: 'Scale e agilità', rotta: '#/agilita',
    sotto: 'Cinque note su e giù, a velocità crescente. L\'esercizio classico, qui cronometrato.',
    obiettivo: 'una scala pulita a tempo',
    criterio: (s) => s.some((x) => x.esercizio === 'agilita' && x.promosso),
  },
  {
    id: 'orecchio', titolo: 'Orecchio', rotta: '#/orecchio',
    sotto: 'Riconoscere gli intervalli senza cantarli. Con la ripetizione spaziata.',
    obiettivo: 'tutti gli intervalli almeno al secondo ripasso',
    criterio: (s, d) => (d.schede || []).length > 0 && (d.schede || []).every((x) => x.gradino >= 2),
  },
  {
    id: 'strumento', titolo: 'Canta quello che suoni', rotta: '#/strumento',
    sotto: 'Suoni una nota su qualunque strumento, l\'app la riconosce, tu la canti. Il ponte fra strumento e voce.',
    obiettivo: 'tre note riprese dallo strumento, dentro tolleranza',
    criterio: (s) => s.filter((x) => x.esercizio === 'strumento' && x.promosso).length >= 3,
  },
  {
    id: 'melodia', titolo: 'Melodie', rotta: '#/melodia',
    sotto: 'Melodie generate — senza autore, quindi tue. Ascolti e ricanti.',
    obiettivo: 'due melodie prese tutte',
    criterio: (s) => s.filter((x) => x.esercizio === 'melodia' && x.promosso).length >= 2,
  },
];

/** N sessioni promosse consecutive fra le più recenti (le sessioni arrivano dalla più nuova). */
function diFila(sessioni, n) {
  if (sessioni.length < n) return false;
  return sessioni.slice(0, n).every((x) => x.promosso);
}

/**
 * A che punto sei, gradino per gradino.
 * @param {object} dati lo store: {sessioni, estensione, schede}
 */
export function stato(dati) {
  const s = dati.sessioni || [];
  return GRADINI.map((g) => ({ ...g, fatto: !!g.criterio(s, dati), volte: s.filter((x) => x.esercizio === chiave(g.id)).length }));
}

const chiave = (id) => (id === 'nota' ? 'nota-tenuta' : id);

/**
 * Cosa fare oggi.
 *
 * Il primo gradino non ancora fatto, più i ripassi scaduti. Non è una classifica e non è
 * un blocco: tutti gli esercizi restano aperti sempre — questo dice solo da dove
 * ricominciare quando non si sa da dove ricominciare, che è il momento in cui si smette.
 */
export function oggi(dati) {
  const tutti = stato(dati);
  return {
    prossimo: tutti.find((g) => !g.fatto) || null,
    fatti: tutti.filter((g) => g.fatto).length,
    totale: tutti.length,
    gradini: tutti,
  };
}
