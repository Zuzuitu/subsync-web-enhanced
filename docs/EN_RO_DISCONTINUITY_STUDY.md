# SubSync2 — evaluarea experimentală a discontinuităților EN→RO

Data: 2026-10-25. **DOAR CERCETARE; NU ESTE O FUNCȚIE ACTIVĂ ÎN PWA.**

## Motiv

PR #94 a stabilit erorile de referință pentru un titlu sintetic cu offset cunoscut. PR #103 a integrat indicatorii pentru punctele **canonice reținute**, cu 15/15 CI PASS. Punctele reținute sunt potriviri acceptate în jurul unei singure linii globale. O scenă adăugată/eliminată poate împinge potrivirile relevante **în afara** acestei benzi; de aceea `fitPointTimes` din raportul PWA nu poate demonstra singur existența/absența unei tăieturi.

## Experiment izolat

`web/src/en-ro-discontinuity-research.js` oferă `studyIndependentStep(input)`, apelabil **numai cu perechi de cue-uri verificate independent**, cu ID unic al cue-ului, timpul subtitrării și timpul referinței audio. Este interzisă folosirea directă a potrivirilor lexicale brute, a punctelor candidate sau a inlierilor `fitPointTimes` drept astfel de dovezi.

Modulul verifică domeniul de timp, proveniența, unicitatea și limitele (16–256 ancore). Încearcă delimitări cronologice cu cel puțin opt ancore de fiecare parte și cu acoperire temporală minimă; ajustează mediile robuste ale reziduurilor față de linia dată **doar pe o jumătate din ancore**, apoi cere confirmare pe cele rezervate (held-out). Compară eroarea unui model cu salt cu un model cu derivă liniară. Dacă nu există dovezi suficiente, întoarce `supported=false`; dacă există, verdictul este doar `possible-offset-step-not-a-confirmed-cut`.

Pragurile interne (inclusiv diferența de 1 s, MAD 0,25 s, raportul SSE 0,25 și acoperirea minimă) sunt **ipoteze conservative de laborator**, nu praguri de sincronizare, nu criterii universale de detectare, nu estimări de acuratețe și nu propuneri de schimbare a valorilor originale sc0ty.

## Regresii

`tests/js/en-ro-discontinuity-research.js` verifică: caz affine perfect fără salt; derivă liniară (nu confunda cu cut); un singur fals pozitiv (nu accepta); două salturi neclare (fail closed); salt sintetic 8 s și variantă cu zgomot (ipoteză, nu confirmare); prea puține ancore, lipsă proveniență, cue-uri duplicate, coordonate nefinite; absența textelor private din rezultat.

## Limitări deliberate și condițiile pentru continuare

- **NU** este importat de PWA, nu schimbă SRT, Save, corelarea, pragurile canonice sau precizia reală.
- Simularea cu ancore marcate independent nu demonstrează că motorul poate obține în siguranță aceleași ancore dintr-un film cu dialog repetat.
- De testat înainte de orice funcție publică: sursa independentă a ancorelor, identitatea cue-urilor, ediții cu scene tăiate/lipite, cuvinte repetitive, fals pozitivi, limite iPhone și ground truth autorizat.
- Dacă dovezile lipsesc, aplicația trebuie să folosească aceeași sincronizare canonică ori să rămână inconcludentă; **nu** corecta automat pe segmente.

Vezi și `docs/PIECEWISE_REVIEW.md`, unde este explicat de ce metoda externă piecewise nu a fost adoptată ca atare.
