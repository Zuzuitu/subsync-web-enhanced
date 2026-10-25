# SubSync2 — evaluarea experimentală a discontinuităților EN→RO

Data: 2026-10-25. **DOAR CERCETARE; NU ESTE O FUNCȚIE ACTIVĂ ÎN PWA.**

## Motiv

PR #94 a stabilit erorile de referință pentru un titlu sintetic cu offset cunoscut. PR #103 a integrat indicatorii pentru punctele **canonice reținute**, cu 15/15 CI PASS. Punctele reținute sunt potriviri acceptate în jurul unei singure linii globale. O scenă adăugată/eliminată poate împinge potrivirile relevante **în afara** acestei benzi; de aceea `fitPointTimes` din raportul PWA nu poate demonstra singur existența/absența unei tăieturi.

## Experiment izolat

`web/src/en-ro-discontinuity-research.js` oferă `studyIndependentStep(input)`, apelabil **numai cu perechi de cue-uri verificate independent**, cu ID unic al cue-ului, timpul subtitrării și timpul referinței audio. Este interzisă folosirea directă a potrivirilor lexicale brute, a punctelor candidate sau a inlierilor `fitPointTimes` drept astfel de dovezi.

Modulul verifică domeniul de timp, proveniența, unicitatea și limitele (16–256 ancore). Rezervă **global, înaintea căutării**, fiecare a doua ancoră pentru validare (held-out). Caută delimitarea folosind exclusiv setul de antrenare, care trebuie să acopere cronologic ambele părți. Alege un singur interval de delimitare între două ancore de antrenare, apoi folosește *o singură dată* punctele held-out pentru confirmare — nu le folosește pentru a alege dintre mai multe delimitări. Acest pas evită contaminarea validării prin selecție. Intervalul dintre ancorele de antrenare care delimitează un posibil salt este o **zonă nedeterminată**: ancorele de validare situate strict în interiorul acesteia nu sunt repartizate pe părți folosind un midpoint artificial. Cere ancore suplimentare în afara intervalului și compară eroarea modelului cu salt cu deriva liniară doar pe același subset evaluabil. Dacă nu există dovezi suficiente, întoarce `supported=false`; dacă există, verdictul este doar `possible-offset-step-not-a-confirmed-cut`.

Pragurile interne (inclusiv diferența de 1 s, MAD 0,25 s, raportul SSE 0,25 și acoperirea minimă) sunt **ipoteze conservative de laborator**, nu praguri de sincronizare, nu criterii universale de detectare, nu estimări de acuratețe și nu propuneri de schimbare a valorilor originale sc0ty.

## Regresii

`tests/js/en-ro-discontinuity-research.js` verifică: caz affine perfect fără salt; derivă liniară (nu confunda cu cut); un singur fals pozitiv (nu accepta); două salturi neclare (fail closed); salt fals prezent doar în datele de antrenare (holdout trebuie să-l respingă); schimbare de semn a saltului; salt sintetic 8 s și variantă cu zgomot (ipoteză, nu confirmare); prea puține ancore, lipsă proveniență, cue-uri duplicate, coordonate nefinite; absența textelor private din rezultat.

## Limitări deliberate și condițiile pentru continuare

- **NU** este importat de PWA, nu schimbă SRT, Save, corelarea, pragurile canonice sau precizia reală.
- Simularea cu ancore marcate independent nu demonstrează că motorul poate obține în siguranță aceleași ancore dintr-un film cu dialog repetat.
- De testat înainte de orice funcție publică: sursa independentă a ancorelor, identitatea cue-urilor, ediții cu scene tăiate/lipite, cuvinte repetitive, fals pozitivi, limite iPhone și ground truth autorizat.
- Dacă dovezile lipsesc, aplicația trebuie să folosească aceeași sincronizare canonică ori să rămână inconcludentă; **nu** corecta automat pe segmente.

Vezi și `docs/PIECEWISE_REVIEW.md`, unde este explicat de ce metoda externă piecewise nu a fost adoptată ca atare.

## Următorul control: cronologia materialului EN→RO generat efectiv

`tests/research/validate-generated-en-ro-editions.js` citește `tests/generated/en-ro-e2e/fixture.json`, produs de `tests/fixtures/generate-en-ro-e2e.py` folosind perechi de fraze și timpi cunoscuți din sinteza Piper. Perechile de tip `audioStart` → `subtitleStart` sunt autoritatea fixture-ului, **nu** corelații ghicite din cuvinte. Testul verifică explicit offsetul original și cronologia înainte de orice simulare.

Se testează: fixture-ul perfect afin; o pauză/scenă adăugată de +8 secunde în audio; o regiune lipsă din ediție prin eliminarea unui bloc de opt cue-uri și scăderea timpului dispărut (cu verificarea golului rămas între cue-urile autentice); derivă liniară; o singură potrivire falsă; două editări ambigue; lipsa ancorelor post-editare; cronologie inversată și lipsa dovezii declarate. Cazurile pozitive rămân **ipoteze de salt**, nu confirmări de tăieturi.

Rularea se face exclusiv în `Legacy WebAssembly Build`, *după* generarea fixture-ului și instalarea Node 20; în rezultatul public sunt doar valori numerice și etichete de caz, **fără** propoziții, texte românești, identificatori ai utilizatorilor sau media. Nu se schimbă generatorul, modelele, dicționarele, exportul ori PWA.

Limită critică: ambele cronologii sunt create de același generator legal sintetic; acesta oferă ground truth de fixture, dar **nu dovedește** că o aplicație poate deduce din sunet real că perechea cue→audio este corectă. Cazurile repetate și filmele cu montaj necunoscut cer dovezi suplimentare și comparare independentă înaintea oricărei corecții pe segmente.
