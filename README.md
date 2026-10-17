# Zielona Fala

Gra przeglądarkowa 2D o programowaniu sygnalizacji świetlnej i oznakowania drogowego.
Czysty JavaScript + canvas, bez zależności i bez budowania – wystarczy otworzyć `index.html`.

## Jak grać

Gra ma dwa tryby:

- **Planowanie** – ustawiasz organizację ruchu na losowej mapie.
  - Narzędzia po prawej: polskie znaki drogowe (A-7, B-20, D-1, B-2, C-2, C-3, C-5, C-6, C-7) i gumka.
    Wybierz znak i kliknij jedno z zaznaczonych miejsc przy ramieniu skrzyżowania. PPM zdejmuje znak.
  - Kliknij skrzyżowanie (narzędzie „Wybierz"), żeby zaprogramować **sygnalizację**: fazy (które ramiona mają zielone),
    czas zielonego i **przesunięcie cyklu** (zielona fala między sąsiednimi skrzyżowaniami).
    Wykres pod suwakiem pokazuje cały cykl świateł dla każdego ramienia.
  - W pasku u góry widać, jaki odsetek tras wjazd→wyjazd jest jeszcze osiągalny przy Twoich zakazach i nakazach.
- **Symulacja** – auta pojawiają się na bramach mapy i jadą losowymi trasami. Możesz zmieniać prędkość (1×–8×),
  natężenie ruchu i obserwować statystyki: przepustowość, opóźnienie, płynność, auta w korku.
  Powrót do planowania zeruje symulację, a reguły zostają.

Mapa jest losowana (przycisk **Losuj mapę**); ten sam numer mapy i rozmiar zawsze dają ten sam układ dróg.
Drogi mają 1–3 pasy w każdym kierunku. Ustawienia zapisują się automatycznie w `localStorage`.

## Zasady ruchu w symulacji

- Jazda prawostronna, auta wybierają pas pod następny skręt.
- Sygnalizacja: po zielonym 3 s żółtego i 1,5 s czerwonego dla wszystkich.
- Bez sygnalizacji i znaków obowiązuje **zasada prawej ręki**; lewoskręt ustępuje jadącym z przeciwka.
- **Droga z pierwszeństwem (D-1)** > brak znaku > **ustąp pierwszeństwa (A-7)** / **STOP (B-20)** (pełne zatrzymanie).
- **Zakaz wjazdu (B-2)** blokuje wjazd ze skrzyżowania w dane ramię. **Nakazy C-x** ograniczają dozwolone manewry z danego ramienia.
- Na skrzyżowaniu z włączoną sygnalizacją znaki A-7, B-20 i D-1 są pomijane.
- Auto nie wjedzie na skrzyżowanie, jeśli nie ma miejsca na wyjeździe. Kierowca stojący zablokowany ponad 90 s
  (poza czerwonym) rezygnuje i znika – to rozbija gridlock i trafia do statystyki „Porzucone".

## Struktura

| Plik | Zawartość |
| --- | --- |
| `js/mapgen.js` | generator mapy, geometria pasów i torów przejazdu |
| `js/signs.js` | rysowanie polskich znaków drogowych |
| `js/sim.js` | trasowanie, sygnalizacja, symulacja aut |
| `js/render.js` | kamera i rysowanie |
| `js/ui.js` | interfejs, narzędzia, inspektor skrzyżowania |

Parametry URL (do testów): `?seed=123&size=small|medium|large&mode=sim&speed=4&level=6&ff=60`
(`ff` – przewinięcie symulacji o tyle sekund).

Skróty: `Spacja` – pauza w symulacji, `Esc` – narzędzie „Wybierz".
