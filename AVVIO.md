# Canto Coach — documento d'avvio

App a sé, indipendente dallo strumento. PWA statica su GitHub Pages, installabile su
iPhone, niente server, niente account, funziona senza rete.

Consegna dalle sessioni che hanno costruito **Ukulele Coach**, **Chitarra Coach** e i
documenti di **Piano Coach**.

> **Due revisioni, e vale la pena sapere perché.**
> La prima stesura rispondeva a «cantare mentre suono la chitarra», e a forza di tagliare
> le funzioni disoneste era rimasto un calcolatore di capotasto: non era un coach di
> canto, e la domanda «ma è proprio coach di canto?» era giusta.
> La seconda ha separato i due prodotti. Questa terza toglie di mezzo anche la chitarra:
> **lo strumento è accompagnamento intercambiabile — chitarra, piano, tastiera o
> niente affatto — e la voce è il soggetto.**

---

## 0. La decisione che risolve il problema difficile, invece di aggirarlo

C'era un problema che sembrava il muro di tutto il progetto: **la voce e lo strumento
suonano nella stessa banda**, e separarli in un microfono solo è un problema di ricerca.
Voce maschile 98–262 Hz, chitarra 82–330 Hz, piano tutto: sovrapposizione totale.

Slegando l'app dallo strumento, quel muro **sparisce del tutto**, e non per rinuncia:

> **Lo strumento e la voce non suonano mai insieme. Si alternano.**
> Lo strumento (o l'app) dà la nota → silenzio → tu canti → l'app misura.
> **Una sorgente alla volta, sempre.**

È esattamente il caso per cui il motore dell'accordatore è stato costruito e collaudato:
**±3 centesimi misurati**, anche con rumore. Non serve nessuna DSP nuova per la parte che
conta.

E l'alternanza non è un compromesso tecnico travestito da metodo: **è il modo in cui si
insegna a cantare da sempre.** L'insegnante dà la nota, tu la canti, lui ti corregge.
Nessun insegnante suona il pianoforte mentre tu canti la stessa nota per giudicarti.

### Tre modi di avere la nota da cantare, tutti equivalenti per l'app

1. **L'app la genera.** Nessuno strumento richiesto. È il modo predefinito: si studia sul
   divano, in macchina, con gli auricolari.
2. **La suoni tu, su qualunque strumento.** Piano, tastiera, chitarra, ukulele: l'app
   ascolta una nota sola — una sorgente, il caso facile — la riconosce, e diventa quella
   il bersaglio. È l'esercizio «canta quello che hai appena suonato», che è **il ponte
   vero fra strumento e voce**.
3. **La detta l'esercizio.** Scale, intervalli, melodie generate.

Il modo ② è la risposta alla tua richiesta: **oggi il piano, domani la chitarra, e all'app
non cambia niente.** Deve solo riconoscere una nota, e lo sa già fare da 70 a 1300 Hz.

### Una nota sul canticchiare, che è quello che hai chiesto

**Canticchiare a bocca chiusa è più facile da analizzare che cantare su una vocale**, e la
differenza è a nostro favore:

- niente **consonanti**, quindi sparisce la trappola degli scoppi a banda larga che
  farebbero impazzire il rilevatore di attacchi;
- le **formanti** sono molto meno marcate a bocca chiusa: meno picchi forti che non sono
  armoniche, quindi meno note inventate;
- lo spettro è dominato dalle armoniche basse, che è la forma che l'HPS legge meglio.

In cambio una cosa sola, ed è già risolta: **il livello è più basso.** Un mugolato
tranquillo può stare sotto la soglia fissa di 0,006 che l'accordatore aveva prima. La
soglia adattiva scritta oggi in `pitch.js` — che sta un fattore sopra il rumore *misurato*
della stanza invece che a un numero deciso a tavolino — è esattamente quello che serve, e
la barra del livello dice se ti sente. Arriva a proposito.

---

## 1. Cosa si può misurare davvero, e cosa no

La divisione fra le due colonne è la differenza fra un'app seria e una che spaccia.

### Misurabile onestamente, con una voce sola in un microfono di telefono

| Cosa | Come | Perché è didattica vera |
|---|---|---|
| **Intonazione su nota tenuta** | il rilevatore esistente, ±3 centesimi | è la base di tutto |
| **Calo (drift)** | scarto a 0,5 s contro scarto a 4 s | si parte giusti e si **cala**: è il difetto più comune e da soli non ci si accorge |
| **Attacco** | centesimi nei primi 150 ms | atterri sulla nota o ci **scivoli sopra da sotto**? |
| **Intervalli** | nota data → nota cantata | terza, quarta, quinta, ottava: il cuore delle lezioni |
| **Estensione** | la più grave e la più acuta **comode** | e come cambiano in settimane |
| **Passaggio di registro** | dove livello o timbro fanno un salto mentre sali | sapere dov'è il tuo cambia cosa ha senso studiare |
| **Vibrato** | frequenza (4–7 Hz) e ampiezza (±20–100 cent) | si impara a controllarlo solo se lo si misura |
| **Fiato** | secondi di nota tenuta **dentro tolleranza** | 8–12 s da principiante, 20–30 da allenato: un numero che sale |
| **Fermezza di volume** | deviazione del livello sulla frase | l'altro modo in cui una nota lunga muore |
| **Agilità** | scala di 5 note a velocità crescente | l'esercizio classico, qui cronometrato |
| **Orecchio** | riconoscere intervalli, dire se sei calante | la ripetizione spaziata è già scritta |

### NON misurabile onestamente — e va detto, non aggirato

- **appoggio e sostegno del fiato.** Si misura *quanto dura* una nota, non *da dove viene
  il sostegno*. Un'app che dice «appoggia meglio» sta inventando;
- **risonanza, posizione della voce, vocali.** Serve un orecchio, non uno spettro su un
  microfono di telefono;
- **«hai una bella voce».** Non è una misura;
- **salute vocale.** Se qualcosa fa male si smette e si va da un umano.

Questa seconda colonna è la parte **più facile da spacciare per funzionante**, ed è per
questo che sta scritta qui.

---

## 2. Gli esercizi, in ordine

Non un elenco di funzioni: un percorso, come quello degli accordi.

1. **Trova la tua nota.** L'app suona una nota nella tua zona comoda, tu la tieni a bocca
   chiusa. Si misura scarto e calo. È la prima lezione di qualunque insegnante.
2. **La tua estensione.** Per gradi, in salita e in discesa, fermandosi al primo sforzo.
   Escono due numeri che l'app userà per tutto il resto.
3. **Il tuo passaggio.** Glissando lento in salita, cercando il salto.
4. **Attacco pulito.** Nota data, silenzio, poi tu: atterrare senza scivolare.
5. **Intervalli** in salita, poi in discesa (più difficile), poi a salti.
6. **Nota tenuta lunga** — il fiato, cronometrato, tolleranza che si stringe.
7. **Scale e agilità**, a velocità crescente.
8. **Orecchio**: riconoscere, non produrre.
9. **Canta quello che suoni** — modo ② di §0. Qui entra lo strumento, quale che sia.
10. **Melodie**, su repertorio libero o tuo (§6 sul diritto d'autore).

Ogni gradino ha un criterio d'uscita misurato; la ripetizione spaziata decide cosa
rivedere.

### La nota di riferimento va scelta, non presa a caso

Tre dettagli che decidono se l'esercizio funziona:

- **un tono con armoniche si intona meglio di una sinusoide pura.** Una sinusoide è
  difficile da agganciare per l'orecchio. Serve un timbro tipo organo o voce sintetica;
- **la nota va data nella TUA ottava.** Se l'app dà un La4 a un baritono, quello canta un
  La3 e l'app dice che ha sbagliato di dodici semitoni: ha sbagliato l'app. Dopo la misura
  dell'estensione questo non deve più succedere;
- **l'app non deve suonare mentre misura.** È la stessa lezione del metronomo che si
  sentiva da solo — con una differenza: qui non serve nemmeno spostare la banda, basta
  **alternare**, ed è anche didatticamente giusto.

---

## 3. Quello che la voce ha e la corda no — le trappole del rilevatore

Il motore è quello giusto, ma è stato collaudato su corde. La voce rompe quattro cose, e
tutte vanno provate **prima** di costruire schermate.

**① La fondamentale può essere debole o assente.** Su voce maschile, con il taglio dei
bassi di un microfono di telefono, la fondamentale a 100 Hz può essere più debole della
seconda armonica: un rilevatore che cerca il picco più forte sbaglia l'ottava. L'HPS è
**esattamente l'algoritmo giusto** — deduce l'altezza dalla spaziatura delle armoniche,
non dalla presenza della fondamentale — ma il **peso doppio sulla fondamentale**, aggiunto
per i suoni quasi puri dell'ukulele, qui gioca dalla parte sbagliata e va rimisurato.

**② Le formanti creano picchi forti che NON sono armoniche.** Su una vocale «a» la prima
sta a 700–800 Hz, dentro la banda. `armonicoDi()` le lascia passare perché non stanno a
multipli interi. *Canticchiando il problema è molto più piccolo* (§0), ma esiste appena
apri la bocca.

**③ Il vibrato muove l'altezza di ±20–100 centesimi.** La mediana su 5 letture lo
**appiattisce**, e appiattirlo è sbagliato due volte: si perde una misura interessante e
si dichiara instabile una voce che sta facendo la cosa giusta. Serve separare la **media**
(l'intonazione) dall'**oscillazione** (il vibrato), non mediare tutto insieme.

**④ Le consonanti sono scoppi a banda larga.** Il rilevatore di attacchi tarato sulle
pennate scatterebbe su ogni «t» e «k». *Canticchiando non esiste*; torna con le parole.

---

## 4. Le prove da fare PRIMA, con i criteri di fallimento scritti prima

**Prova 0 — il rilevatore segue la tua voce?**
Nota tenuta: mugolato a bocca chiusa, vocale «a», vocale «i». Errore in centesimi contro
il valore vero.
→ *Sopra ~20 centesimi su una nota tenuta non si costruisce niente. È la prova che tiene
in piedi tutto il prodotto.*

**Prova 1 — sbaglia l'ottava sulla voce grave?**
Da Sol2 (98 Hz) a Do3, con la fondamentale attenuata di 12 dB per simulare il microfono
del telefono.
→ *Un errore d'ottava è l'app che ti dice che sei stonato di dodici semitoni. Se succede,
il peso della fondamentale nell'HPS va rifatto — e va rifatto senza rompere l'accordatore
dell'ukulele, dove quel peso serviva.*

**Prova 2 — un mugolato piano supera la soglia?**
Livelli da −55 a −35 dBFS, in stanza silenziosa e con una ventola.
→ *È la prova diretta della soglia adattiva scritta oggi. Se un mugolato tranquillo viene
dichiarato silenzio, l'app è sorda proprio nel modo in cui vuoi usarla.*

**Prova 3 — vibrato: si misura o si appiattisce?**
Voce con vibrato noto (5,5 Hz, ±50 cent): deve tornare intonazione **media corretta** E
vibrato misurato, non una lettura ferma e sbagliata.

**Prova 4 — riconosce una nota di piano?**
Modo ② di §0. Il piano ha armoniche molto stirate nei bassi (rigidità B fino a 5e-4:
l'ottava armonica cade 27 centesimi sopra il suo posto, la dodicesima 60).
→ *Se sbaglia sulle note gravi del piano, il modo «canta quello che suoni» funziona solo
al centro della tastiera, e va detto invece che scoperto.*

---

## 5. E se un giorno vuoi cantare MENTRE suoni

Non è questa app, ed è giusto che non lo sia — ma l'estensione misurata qui sblocca la
funzione più utile che esista per chi si accompagna:

> La maggior parte delle persone non riesce a cantare le canzoni nella tonalità originale.
> Non perché stoni: perché la canzone è scritta per la voce di un altro. Ci prova, non ci
> arriva, conclude che non sa cantare, e smette.

Sapendo la tua estensione, per ogni canzone si calcola **in che tonalità ti sta comoda**,
e poi si traduce sullo strumento che hai in mano: **capotasto al 3** sulla chitarra,
**suonala in Fa** sul piano. Il calcolo è lo stesso, la traduzione cambia — che è
esattamente la forma giusta per un'app indipendente dallo strumento.

Il resto (giudicare l'intonazione **mentre** suoni) resta un problema aperto: due sorgenti
nella stessa banda, e la voce che sparisce quando canta una nota dell'accordo, che sui
tempi forti è la regola. Se un giorno si affronta, si affronta come modalità di
`chitarra-coach`, con le prove che decidono se tagliarla. **Qui non serve.**

---

## 6. Le cose che valgono comunque

**Essere severi sulla voce è un rischio di prodotto, non solo tecnico.** Dire a qualcuno
che il suo barré è muto è un'informazione. Dirgli che la sua voce è calante è
**personale**. Un'app che te lo ripete trenta volte è un'app che smetti di aprire, anche
se ha ragione tutte e trenta le volte.

- **non esiste "giusto" nel canto come per un accordo**: un buon cantante tira le terze,
  scivola dentro le note, usa il vibrato. Tolleranza larga (±35–50 centesimi su nota
  tenuta), **misurata**, non scelta per severità;
- **la tendenza conta più dell'istante**: «sei costantemente un po' sotto» è utile;
- **il verdetto va sulla frase, non sulla nota**;
- **misurare l'estensione spingendo fa male alla voce.** Chiedere la più acuta *comoda*,
  fermarsi al primo sforzo, e dirlo. E rimisurarla: cambia con la giornata.

**Il diritto d'autore.** Le prime tre app l'hanno schivato senza accorgersene: una
sequenza di accordi non è protetta, e infatti la libreria contiene giri. Un'app di canto
vuole **melodie**, che sono la parte più protetta. Vie pulite: **melodie generate**
(intervalli, scale, arpeggi: infinite e senza autore), **repertorio di pubblico dominio**,
**melodie inserite dall'utente** che restano sul telefono. Da decidere prima di riempire
il repertorio.

**Le tredici lezioni già pagate** stanno nel documento del pianoforte e valgono tutte. Le
due che colpiscono qui: **il programma sente sé stesso** (risolto dall'alternanza, ma va
verificato che l'app taccia davvero mentre misura, in dB e non a fiducia), e **il banco
gentile mente** — una voce sintetica pulita, senza vibrato né respiro, dirà che tutto
funziona; il banco che decide ha vibrato, portamento, fondamentale debole e formanti.

**Il metodo che ha funzionato tre volte**: microfono sintetico attraverso la vera
`getUserMedia`, attese sull'orologio audio, righe di **misura** oltre a quelle di
giudizio, screenshot veri con dati realistici. E il collaudo in pagina, che nell'ukulele
sta a 2050 prove e ha trovato una trentina di difetti veri.

---

## 7. Primo messaggio suggerito per la chat nuova

> Leggi `AVVIO.md` in questa cartella. Costruiamo Canto Coach: app a sé, **indipendente
> dallo strumento**, in cui strumento e voce **si alternano** e non suonano mai insieme.
> Copia il motore da `C:\Users\alexg\Documents\ukulele-coach` (è la versione più
> aggiornata: soglia adattiva, soppressione degli armonici, `t.misura` nel collaudo).
> Comincia dalle **prove 0–4** di §4 e dammi i numeri prima di qualunque schermata:
> se sbaglia l'ottava sulla mia voce grave o se non sente un mugolato piano, si sistema
> quello e basta.
> Poi gli esercizi di §2 in ordine, a partire da nota tenuta ed estensione — e la nota di
> riferimento generata dall'app, così posso studiare senza avere niente in mano.
