// Note, ottave, intervalli — in italiano, perché l'app parla italiano e «B♭» non lo legge
// nessuno qui.

import { hzDaMidi, midiDaHz } from './pitch.js';

export const NOMI = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

/** Nome con ottava di un numero MIDI: 60 → «Do4». */
export function nome(midi) {
  const m = Math.round(midi);
  return `${NOMI[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export const hz = (midi) => hzDaMidi(midi);
export const midi = (frequenza) => midiDaHz(frequenza);
/** Numero MIDI più vicino, intero. */
export const midiVicino = (frequenza) => Math.round(midiDaHz(frequenza));

/**
 * Gli intervalli dell'esercizio, con il nome che usa un insegnante.
 *
 * L'ordine è quello in cui si insegnano: ottava e quinta prima perché sono le più facili
 * da sentire (rapporti semplici), la seconda maggiore e la settima per ultime.
 */
export const INTERVALLI = [
  { semitoni: 12, nome: 'ottava', facilita: 1 },
  { semitoni: 7, nome: 'quinta', facilita: 1 },
  { semitoni: 5, nome: 'quarta', facilita: 2 },
  { semitoni: 4, nome: 'terza maggiore', facilita: 2 },
  { semitoni: 3, nome: 'terza minore', facilita: 2 },
  { semitoni: 9, nome: 'sesta maggiore', facilita: 3 },
  { semitoni: 8, nome: 'sesta minore', facilita: 3 },
  { semitoni: 2, nome: 'seconda maggiore', facilita: 4 },
  { semitoni: 11, nome: 'settima maggiore', facilita: 5 },
  { semitoni: 1, nome: 'seconda minore', facilita: 5 },
];

/** La scala maggiore, per l'esercizio di agilità. */
export const SCALA_MAGGIORE = [0, 2, 4, 5, 7, 9, 11, 12];

/**
 * La banda che il rilevatore guarda davvero, in numeri MIDI.
 *
 * Non è un dettaglio da nascondere: sotto Re♭2 il rilevatore NON guarda (`HZ_MIN` = 70 Hz
 * in pitch.js), e una voce di basso profondo ci arriva. Quando l'esercizio dell'estensione
 * tocca il fondo, l'app deve dire «qui non ti so più misurare» invece di dire «non ci
 * arrivi»: sono due frasi molto diverse per chi le riceve.
 */
export const MIDI_MIN = Math.ceil(midiDaHz(70));
export const MIDI_MAX = Math.floor(midiDaHz(1300));
