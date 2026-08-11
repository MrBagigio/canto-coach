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
- **Banco: [`collaudo.html`](collaudo.html) — 328 prove, tutte verdi.**
- **Sul telefono: [`prova-zero.html`](prova-zero.html)** — misura la tua stanza e la tua voce.

Il motore viene da [ukulele-coach](../ukulele-coach) (`js/pitch.js`). Le prove 0–4
dell'AVVIO §4 sono state fatte **prima di qualunque schermata**, ed è stato giusto:
hanno trovato due difetti veri e smentito uno dei tre sospetti del documento.

## Gli esercizi

`index.html` è l'app: **PWA installabile**, funziona senza rete, dieci esercizi — i gradini
del §2 nell'ordine del documento, ognuno con un criterio d'uscita misurato in
`js/percorso.js`. Tutti costruiti sullo stesso motore: **l'app dà la nota → TACE → tu canti
→ l'app misura**. L'alternanza non è una scelta di interfaccia, è la ragione per cui la
misura è credibile, e sta scritta in un posto solo (`giro()` in `js/app.js`) così non può
divergere fra una schermata e l'altra. Il collaudo la verifica in dB: mentre l'app misura,
dalla sua uscita escono **−180 dBFS, 162 dB sotto** il livello della nota.

| esercizio | cosa misura | criterio d'uscita |
|---|---|---|
| Nota tenuta | intonazione media, calo, vibrato o fermezza | due tenute dentro, di fila |
| La tua estensione | i due numeri da cui l'app ricava tutte le note che ti darà | misurata una volta |
| Il tuo passaggio | dove livello e timbro fanno un gradino salendo | provato — «non trovato» è una risposta |
| Attacco pulito | i primi 150 ms contro il resto della *tua* nota | tre attacchi puliti di fila |
| Intervalli | la distanza cantata, non l'intonazione assoluta | quattro giusti di fila |
| Fiato | secondi **dentro tolleranza**, non secondi di rumore | 12 secondi |
| Scale e agilità | note prese **e** tempo, insieme | una scala pulita a tempo |
| Orecchio | riconoscere, non produrre — con ripetizione spaziata | tutti al secondo ripasso |
| Canta quello che suoni | il ponte fra strumento e voce, qualunque strumento | tre note riprese |
| Melodie | melodie **generate**, mai copiate | due prese tutte |

**Il diritto d'autore, risolto generando** (§6). Una sequenza di accordi non è protetta — e
infatti le altre tre app hanno una libreria di giri — ma una melodia sì: è proprio quello
che il diritto d'autore protegge in una canzone. Le melodie qui camminano sui gradi di una
scala, deterministiche dato un seme, e il collaudo verifica su sette semi che partano e
finiscano sulla tonica, non escano dall'ambito, non facciano salti oltre la quinta, non
ripetano due note uguali di fila e non contengano tritoni.

**Partenza a freddo, senza tabelle di tipi vocali.** La prima volta l'app non sa dove sta
comoda la tua voce, e darti una nota a caso vorrebbe dire darti quella di un altro
(«se l'app dà un La4 a un baritono, quello canta un La3 e l'app dice che ha sbagliato di
dodici semitoni: ha sbagliato l'app»). Quindi te lo chiede cantando: mugoli una nota
qualunque, e da lì nasce una zona provvisoria che l'esercizio dell'estensione sostituirà
con quella vera.

**La tolleranza è 35 centesimi** — un terzo di semitono. Non è severità dosata a occhio:
lo strumento sbaglia al massimo 7,5 centesimi, e il collaudo verifica che ci sia almeno un
fattore quattro fra i due, altrimenti l'app starebbe giudicando il rumore della propria
misura e lo chiamerebbe intonazione.

### Sette difetti trovati GUIDANDO l'app, non leggendo il codice

Nessuno dei sette dava un errore in console, e il collaudo era verde con tutti e sette
dentro. Il metodo: un **cantante sintetico** che legge l'istruzione a schermo («tieni il
Sol3», «ripetila dal Fa♯3») e canta quella nota attraverso la vera `getUserMedia`. Fa
quello che farebbe una persona, e trova quello che una persona troverebbe.

1. **«voce ferma, oscillazione ±135 centesimi»** — una frase che si contraddice da sola.
   `scomponi` lo sapeva già (restituisce «oscillazione non periodica: è instabilità, non
   vibrato»), era il verdetto a non ascoltarlo. Ora sopra la tolleranza si chiama
   instabilità e non viene promossa.
2. **Contava le letture invece dei millisecondi.** «Venti letture stabili» sono mezzo
   secondo a pagina davanti e **venti secondi** a pagina in secondo piano, dove il browser
   strozza `setInterval` da 25 ms a 1000: l'app diceva «non ti ho sentito» a chi stava
   cantando benissimo. Stessa lezione che nell'ukulele era costata il conteggio delle
   battute su `requestAnimationFrame`.
3. **«voce ferma» dichiarata senza averla misurata.** Alla cadenza strozzata `scomponi`
   non trova nessun vibrato, e la risposta è indistinguibile da «voce ferma». Ora sopra
   **37 ms** di passo — tre letture per periodo a 9 Hz, ricavato dalla banda — l'app dice
   che il vibrato non l'ha misurato, e continua a dire l'intonazione media, che invece sa.
4. **Un'estensione di zero semitoni veniva salvata** e poi usata per decidere ogni nota
   successiva: un'app che ti fa cantare per sempre lo stesso La3, convinta di sapere
   qualcosa di te. Sotto i tre semitoni ora non si salva niente e si dice perché.

5. **Un passaggio di registro dichiarato con un gradino di −0,0 dB.** Il punteggio è un
   rapporto contro il passo tipico del glissando, e un rapporto ha un buco nero al
   denominatore: su una salita liscia il passo tipico tende a zero e qualunque bricciolo
   diventa «dieci volte il tipico». Ora oltre al rapporto serve una dimensione assoluta —
   2 dB o 0,12 di timbro — sotto cui non è un passaggio, è il microfono.
6. **Una scheda dell'orecchio mai vista passava davanti ai ripassi in ritardo.** Una scheda
   nuova ha `quando: 0`, quindi risultava la più scaduta di tutte: il file dichiarava
   «prima le scadute, poi le nuove» e il codice faceva l'opposto. Un ripasso scaduto ha una
   fretta che una scheda nuova non ha — sta per essere dimenticato.
7. **Melodie con due note uguali di fila e con un tritono.** Due note identiche attaccate
   sono una nota lunga per il microfono: l'esercizio ne conterebbe una come mancata,
   bocciando chi ha fatto giusto — un limite della misura si toglie di mezzo generando, non
   ignorandolo giudicando. E il tritono è l'intervallo più difficile da intonare che esista.
   Con la correzione ne è uscito un terzo difetto: chiudevano con salti da quattordici
   semitoni (`La4 → Sol3`) e facevano l'andirivieni fra due note sole.

E uno di comportamento: i primi 400 ms di una nota sono l'attacco, non la tenuta, e
includerli faceva risultare instabile una nota tenuta benissimo. L'attacco ha un esercizio
suo, dove viene giudicato con il metro giusto.

## Prima: prove 0–4 sul motore

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

I gradini 3, 7, 8 e 10 del §2: passaggio di registro (glissando lento in salita, cercando
il salto), scale e agilità a velocità crescente, orecchio (riconoscere gli intervalli
invece di produrli), melodie. E il gradino 9 — «canta quello che suoni» — che il motore già
regge: la prova 4 dice entro quanto riconosce una nota di chitarra, ukulele e pianoforte.

Il diritto d'autore sulle melodie (§6) va deciso **prima** di riempire il repertorio: una
sequenza di accordi non è protetta e infatti le altre tre app hanno una libreria di giri,
ma una melodia lo è. Vie pulite: melodie generate, pubblico dominio, o inserite dall'utente
e mai uscite dal telefono.
