# SubSync2 — checkpoint de continuitate: 25 octombrie 2026

> **Sursă:** repository-ul canonic `Zuzuitu/subsync-web-enhanced` și evaluarea privată făcută în această sesiune. Acest fișier este doar un checkpoint **fără media, subtitrări, titluri de fișiere private, tokenuri sau ID-uri Drive**. Istoricul cronologic complet este în `docs/PROJECT_STATE.md`. Codul sursă și CI-urile din repository au prioritate față de descrierile din chat.

## A. Verificare GitHub confirmată

- **main**, înaintea acestui checkpoint: `1b5edf8d0b6a0a45f583e6fa9599930d41e3ab24` (PR #107 squash merged).
- **PWA public / deploy/pages-preview**: `a46305ab124bb5d5cf15b79f7f77b43e239ecd34` (PR #100, MP4 OPFS recovery).
- **PR #94** — măsurarea whole-title EN audio → RO SRT: merged `f500d2d9a7221721a78b162574d45fb1940ca4d8`, CI 13/13, nu mai este deschis.
- **PR #103** — diagnostic read-only al dovezilor EN→RO: merged `d2dd7cf0ce3ef6815bf85914972dd44f242b3f03`, CI 15/15.
- **PR #104** — studiu offline conservator al salturilor de offset, cu holdout și 384 scenarii sintetice: merged `f6c01534b926d67d777855c4b9ad40c09f6407d6`, CI 12/12.
- **PR #105** — controale din fixture generat cu timpi audio/subtitrare autentici, repararea descărcării artefactului CI după retry, **fără** schimbarea motorului: merged `146abb22fb2278cd3fac4f4f0ea0fd8612ac8502`, CI 12/12. În jobul final, artefactul corect `12598200184` a fost descărcat după ID; diferența de timp nativ vs. WebAssembly pe aceeași intrare sintetică a fost **0 ms**. Issue #106 închis.
- **PR #107** — verificator local privat `scripts/audit-srt-pair.js`, teste `tests/js/audit-srt-pair.js`, `docs/PRIVATE_SRT_AUDIT.md`: merged `1b5edf8d0b6a0a45f583e6fa9599930d41e3ab24`, CI 9/9. Nu există runtime import ori schimbări publicate.
- Issue #101 (istoric simulator iOS `simctl bootstatus`) rămâne deschis; nu este permisiune de a relua lucrul la iOS nativ.

## B. Decizii permanente / blocaje de arhitectură

1. **Prioritate PWA și procesare LOCALĂ**, inclusiv audio/SRT/Whisper/FFmpeg; fără upload media spre backend, GitHub, servicii ASR externe ori API-uri plătite.
2. Păstrează upstream `sc0ty/subsync` (GPL-3.0 și credit Michał Szymaniak), toate limbile, **9 modele ASR și 217 pachete dicționar**; nu le modifica pentru fixul de sincronizare.
3. Prioritatea este sincronizarea globală **audio englezesc → SRT românesc**, cu păstrarea fluxului **audio românesc → SRT românesc**, a Audio Extractor, importului și exportului.
4. **Praguri canonice înghețate:** `minPointsNo=20`, `minCorrelation=0.9999`, `maxPointDist=2s`, `minWordProb=0.3`, `minWordLen=5`, `minWordsSim=0.6`. Nu le coborî pentru teste.
5. Fără patch pentru un film, offset fix hardcodat, supoziție că o scenă este tăiată din simpla modificare a SRT, coruperea politicii Save sau asocierea punctelor de matching brute cu ancore independente.
6. Cercetarea `web/src/en-ro-discontinuity-research.js` rămâne **OFFLINE, neimportată în PWA**, neaplicată SRT-ului. Nu activa piecewise fără dovezi audio–cue independente, false-positive controls și validare heldout.
7. **Dezvoltarea iOS nativ, IPA, signing și background este SUSPENDATĂ**, până la cerere expresă. Workflow-urile CI istorice pot rula pe PR; nu interpreta asta ca reluarea feature-ului.
8. GitHub: branch → PR → exact-head CI **toate verzi** → merge; **deploy PWA doar deliberat**, cu readback. Nu publica acest checkpoint ca build nou; nu atinge `deploy/pages-preview`.

## C. Dovezi private recuperate în această sesiune

- Folderul SubSync2 conectat în Google Drive conține **6 subfoldere**, fiecare cu audio și câte două SRT-uri `Original.srt` / `Decalare.srt`; setul 6 are și MKA original. Niciun fișier privat nu este comis în repository.
- Au fost comparate **toate 7.023 cue-urile** din cele 12 SRT-uri. Distribuția între cele șase seturi: **870 / 1.360 / 1.135 / 1.198 / 1.576 / 884**. Toate cue-urile păstrează indexul, corpul textului și durata, iar fiecare start/end din `Decalare.srt` este **+10.000 ms exact** față de `Original.srt`.
- Aceasta demonstrează doar **decalarea matematică a SRT-urilor**; **nu** că `Original.srt` este audio ground truth, **nu** existența unei ediții diferite și **nu** precizia motorului.
- **Test audio efectuat strict local, read-only:** șase fișiere MP3 decodate integral cu FFmpeg, 16 kHz mono, VAD WebRTC pe cadre de 30 ms, **320 intervale de SRT selectate pe film (1.920 total)**, comparate la poziția originală și la +10 s.
- Diferența VAD strict (procentul de cadre clasificate `speech-like` din ferestrele originalului minus cele deplasate), în ordinea seturilor: **+6,95 / +2,61 / +6,83 / +5,55 / +6,97 / +0,09 puncte procentuale**.
- Interpretare: **cinci seturi** favorizează preliminar `Original.srt`; **al șaselea rămâne NEconcludent** deoarece detectorul marchează activitate vocală aproape permanentă. VAD poate confunda muzica/sunetele cu vorbirea.
- Explorarea valorilor de offset ale VAD **nu** reprezintă estimarea exactă a milisecundelor și **nu** autorizează patch-uri în sincronizare.
- **NU s-au executat în acest audit motorul canonic EN→RO/RO→RO, corelatorul, Save ori exportul sincronizat pe cele șase filme reale.** Nu se poate raporta MAE/P95/max de sincronizare bazate pe VAD.
- Copiile audio MP3 și fișierele private de raport VAD existau în spațiul local al sesiunii la finalizarea auditului; accesul la ele **nu este garantat** într-un chat ulterior. Pentru continuare folosiți Drive privat autorizat, nu repetați manual sincronizarea pe iPhone.

## D. Blocajul actual și ordinea de lucru

**Blocajul real:** încă nu există o măsurare E2E verificată a motorului SubSync2 pe cele șase seturi private, cu rezultat `Decalare.srt` → SRT exportat și comparație cu `Original.srt` validat acustic.

1. Verifică live main, PR #107, deploy și această pagină. Citește `docs/PROJECT_STATE.md`, `config/project-invariants.json`, `AGENTS.md`, `docs/EN_RO_DISCONTINUITY_STUDY.md` și `docs/PRIVATE_SRT_AUDIT.md`.
2. Recuperează audio și SRT exclusiv din Drive privat / fișiere locale deja disponibile. Confirmă **limba pistei audio** și ediția înainte de a selecta motorul; nu deduce din numele fișierului.
3. Construieste un **harness de test privat, local/offline** pentru PWA real, fără a încărca fișiere în CI sau GitHub. Rulează motorul canonic nemodificat cu fiecare audio și `Decalare.srt`. Captură output SRT, starea de corelare, numărul de puncte, formula, Save și cronologia; nicio eludare a validatorului.
4. Folosește câteva ancore independente `audio ↔ cue` validate explicit pentru a confirma mai întâi fiabilitatea `Original.srt`; apoi compară **fiecare** cue exportat cu `Original.srt`, pe început/mijloc/final. Calculează erori semnate/absolute, mediană, MAE, P95, maxim și drift, separând rezultatele pozitive de `correlated=false` sau `Save blocked`.
5. Prioritizează diagnosticarea setului 6 (VAD neconcludent) fără heuristici specifice acelui film. Nu suprainterpreta variațiile muzică/voce ale filmelor animate.
6. Dacă lipsesc runtime-ul WebAssembly, modelele sau un browser compatibil pentru testul real, înregistrează exact dependența lipsă; nu înlocui testul engine cu VAD sau un simplu offset numeric.
7. Orice fix justificat: test regresie sintetic public legal + verificare pe toate șase private + protecție împotriva regresiilor în EN→RO / RO→RO / import; PR separat, CI complet verde, deploy deliberat și checkpoint.
8. Nu cere utilizatorului să reproceseze manual pe iPhone decât dacă verifici mai întâi că toate sursele private și rezultatele locale sunt indisponibile.

**Starea de produs:** fixul MP4 din PR #100 este public și funcțional la testul fizic raportat pe iPhone; activarea exactă a recovery OPFS pe telefon nu a fost probată și precizia full-title pe filme reale rămâne deschisă.

**Ultima regulă:** observație ≠ ipoteză ≠ dovadă. Nu promite `orice film va fi perfect sincronizat` până nu există rezultat E2E independent pe editări multiple.
