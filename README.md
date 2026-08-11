# Canto Coach

App per studiare canto dal telefono. Pagina statica, nessun backend, nessun account.
Indipendente dallo strumento: strumento e voce **si alternano e non suonano mai insieme**
(vedi §0 di [AVVIO.md](AVVIO.md) — è la decisione che fa sparire il problema difficile
invece di aggirarlo).

- **Online: <https://mrbagigio.github.io/canto-coach/>** — serve https per il microfono,
  quindi `prova-zero.html` sul telefono si apre da lì, non da localhost.
- Repo: `MrBagigio/canto-coach`
- Cartella di lavoro: `C:\Users\alexg\Documents\canto-coach`
- In locale: `node tools/serve.mjs` → 4181 (voce `canto` nel launch.json di MetaUpgrader)
- Per pubblicare: `node tools/carica-commit.mjs` (prova a vuoto) poi `--scrivi`. Da qui la
  spinta con git è bloccata dall'hook, si passa dalla API Git Data.
- **Banco: [`collaudo.html`](collaudo.html) — 176 prove, tutte verdi.**
- **Sul telefono: [`prova-zero.html`](prova-zero.html)** — misura la tua stanza e la tua voce.

Il motore viene da [ukulele-coach](../ukulele-coach) (`js/pitch.js`). Le prove 0–4
dell'AVVIO §4 sono state fatte **prima di qualunque schermata**, ed è stato giusto:
hanno trovato due difetti veri e smentito uno dei tre sospetti del documento.

## Stato: prove 0–4 fatte, zero curriculum

### Prova 0 — il rilevatore segue la voce? Sì

Nota tenuta, tre timbri (mugolato a bocca chiusa, «a», «i») × cinque altezze da Sol2 a La4,
con **jitter ±8 centesimi e soffio a −18 dB**:

| | errore |
|---|---|
| mediano | **3,2 centesimi** |
| peggiore | **7,5 centesimi** (mugolato su Sol2) |
| limite oltre il quale non si costruisce niente (AVVIO) | 20 |

**Lo stesso banco senza jitter né soffio dava 0,0 centesimi su tutti i casi.** Non era un
motore straordinario: era il banco gentile che mente, esattamente come previsto. Una somma
di sinusoidi a frequenze proporzionali è periodica al campione e l'autocorrelazione la
aggancia esatta. I due numeri che rendono il banco onesto stanno in `VOCE_VERA`.

### Prova 1 — l'ottava sulla voce grave: c'era, ed era peggio di un'ottava

Il difetto: su una vocale aperta in voce grave il candidato grossolano usciva a
**esattamente il doppio** (248 invece di 123,5 · 194 invece di 98 · 258 invece di 131).
L'autocorrelazione cerca solo entro ±35% attorno al candidato, quindi non poteva più
tornare indietro: la chiarezza crollava sotto 0,55 e **l'app diceva «non ti sento» a uno
che stava cantando forte**. Non un'ottava sbagliata: il silenzio.

Due cause, tutte e due misurate e tutte e due con la prova che le rimette al loro posto:

1. **Quattro armonici sommati sono troppo pochi per la voce.** Su una «a» a 123 Hz la prima
   formante sta a 730, cioè sulla sesta armonica: il candidato giusto arrivava solo alla
   quarta e non la vedeva, quello all'ottava sopra sì. Ora `ARMONICI_HPS = 12`, ricavato
   dalla banda (800 Hz di prima formante / 70 Hz di voce più grave ≈ 11). Il collaudo
   spazzola K da 4 a 16: il difetto sparisce da K=6, 12 è il margine.
2. **I candidati non possono essere le caselle della FFT.** 123,47 Hz cade a metà fra la
   casella 11 e la 12 (a 44,1 kHz con finestra 4096 valgono 10,77 Hz l'una): il pettine
   piantato sulla casella cerca i suoi armonici a 118, 237, 355 mentre quelli veri stanno
   a 123, 247, 370, e al sesto è sbagliato di una casella piena. Questo caso sbagliava a
   **qualunque** K. Ora i candidati stanno su una griglia logaritmica di 20 centesimi e lo
   spettro si legge interpolato: costa anche meno (180 candidati invece di 115).

Con la fondamentale attenuata di 0, 6, 12 e 18 dB: **0 note sbagliate su 8**, in tutti e
quattro i casi.

### Prova 2 — il mugolato piano: la soglia era tarata su una corda pizzicata

La misura che ha deciso tutto: **una stanza senza nessuno che canta non produce MAI una
lettura di altezza.** La chiarezza dell'autocorrelazione sul solo rumore misura 0,06–0,08
contro un cancello a 0,55, in quattro stanze da −65 a −40 dBFS. Il guardiano vero è quello.
La soglia sull'RMS non stava difendendo da niente: stava solo rendendo l'app sorda.

E il rilevatore legge il mugolato con 3–5 dB di voce sopra il rumore, mentre il fattore 3,2
ereditato dall'accordatore ne pretendeva 9,7.

| pavimento · fattore | cameretta | stanza normale | ventola | stanza rumorosa |
|---|---|---|---|---|
| 0,006 · 3,2 (accordatore) | −42 | −42 | −37 | −30 |
| **0,0008 · 2,0 (qui)** | **−60** | **−50** | **−42** | **−34** |

*(livello più basso di mugolato riconosciuto, in dBFS)*

⚠️ **Da NON riportare nell'ukulele e nella chitarra senza rimisurare lì**: una corda
pizzicata decade a lungo, e un pavimento più basso significa continuare a inseguire una
corda che si sta spegnendo.

Resta un limite che nessuna soglia toglie, ed è fisica: **la voce deve stare ~5 dB sopra il
rumore della stanza.** Sotto, nel segnale la voce non c'è abbastanza.
Quanto sia il *tuo* mugolato piano nella *tua* stanza è l'unico numero che il banco non può
sapere: lo misura `prova-zero.html`, da aprire sul telefono.

### Prova 3 — vibrato: il sospetto dell'AVVIO era sbagliato

Il documento sospettava che la mediana su 5 letture di `_stabilizza` appiattisse il vibrato.
**Non lo fa**: quella funzione non restituisce la mediana, restituisce la lettura com'è, e
usa la mediana solo come metro per buttare via il campione impazzito oltre il 12% —
che in centesimi fa 196, quasi due semitoni. Un vibrato cantato ci passa attraverso **al
100%**. (Il collaudo lo verifica anche al contrario: a ±400 centesimi interviene davvero.)

Quello che il vibrato lo attenua è la **finestra di analisi**: ogni lettura è una media su
~60 ms, e 60 ms sono un terzo di un periodo a 5,5 Hz. Misurato sull'audio: **±44,9 su ±50,
il 90%**. È poco e si conosce.

`js/vibrato.js` scompone la serie di letture in tre pezzi che sono tre esercizi diversi
del §2 — intonazione media, calo, oscillazione — e dichiara «non misurabile» sotto due
periodi invece di dare un numero a caso. Su una serie di verità nota: 5,51 Hz su 5,5,
±50,0 su ±50, calo −3,98 su −4,00.

Un difetto trovato costruendolo: **il calo non si misura come differenza fra due finestre.**
Con un vibrato di ±40 addosso, le due finestre dell'AVVIO dicevano −17,4 dove il vero era
−26,9 — un quarto di errore, perché 600 ms contengono 3,3 periodi di vibrato e quel 0,3 non
si media via. La retta ai minimi quadrati su tutta la nota invece il vibrato lo annulla.
Il numero mostrato viene dalla retta; le due finestre restano come controprova.

### Prova 4 — la nota che suoni (modo ②)

| | errore |
|---|---|
| chitarra, ukulele | +0,3 … +1,4 centesimi |
| piano da Do4 in su | +6,5 … +7,9 |
| **piano sotto i 150 Hz** | **+20,5 … +24,6** |
| piano La1 (55 Hz) | muto: sotto i 70 Hz il rilevatore non guarda, ed è dichiarato |

Le corde gravi del pianoforte sono rigide (parziali a n·f·√(1+B·n²): con B=5e-4 l'ottava
parziale cade 27 centesimi sopra il suo posto, la dodicesima 60) e l'altezza che esce è un
compromesso fra le parziali stirate. **La nota resta giusta** — è quello che serve al modo
«canta quello che hai appena suonato» — ma il bersaglio da cantare va preso dal semitono
temperato, non dalla frequenza letta, altrimenti si dà da cantare un bersaglio calante di
un quarto di semitono.

## Come si lavora qui

- **I numeri che decidono un comportamento sono proprietà, non costanti murate**
  (`armonici`, `passoCent`, `rmsMinimo`, `sopraIlRumore`): il banco li deve poter
  spazzolare, perché il valore giusto si sceglie guardando i dati.
- **Ogni correzione ha la sua prova RED per costruzione**: rimettendo il numero di prima,
  il difetto deve ricomparire. Un fix che non si sa far fallire non si sa se funziona.
- **Le righe grigie del collaudo sono MISURE, non giudizi**: passano sempre e stampano il
  numero. Un numero nascosto dentro una prova verde non lo legge nessuno.
- Le soglie delle prove si **derivano**, non si copiano da una run fortunata. Due l'hanno
  già imparato a spese loro: «entro 25 centesimi» passava con 24,2, e «±2 sul calo»
  bocciava un codice giusto per 0,15 (l'incertezza vera la misura il vibrato stesso su una
  nota che non cala).

## Ancora da fare

Gli esercizi del §2, in ordine, a partire da nota tenuta ed estensione — e la nota di
riferimento **generata dall'app**, con armoniche (una sinusoide pura è difficile da
agganciare per l'orecchio) e **nella tua ottava**, che si sa solo dopo aver misurato
l'estensione.
