# Mermaid — finalne dopracowanie i walidacja

## Wynik

Dopracowano istniejące komponenty i helpery, bez nowego silnika, zależności ani
systemu podglądu. Tylko Flowchart (`flowchart`/`graph`), State v2, Mindmap i Gantt.
Sequence/ER nadal trafiają do bezpiecznego fallbacku kodu, również w produkcyjnym
teście historycznych/nowych bloków. Bez migracji historii.

- **Tytuły:** metadane Mermaid mają pierwszeństwo; bez nich używany jest bezpośrednio
  poprzedzający nagłówek Markdown albo osobny pogrubiony tytuł. Dopiero brak obu
  oznacza lokalizowany fallback. Puste deklaracje nie przechwytują kolejnej linii.
- **Flowchart:** zachowany ELK i rounded routing; pełne kolory grup, decyzje
  wyróżnione sąsiednim kolorem palety. Etykiety mają wspólny odstęp 0,55em od własnej
  trasy; wyszukiwanie wzdłuż niej zastąpiło przypadkowe pierścienie przesunięć.
- **State:** rzeczywiste centrowanie tekstu w obu osiach, szerokość zależna od
  rozmiaru fontu, wyważone dwuwierszowe etykiety przejść. Oficjalne współdzielenie
  portów ELK wyrównuje wejścia do terminala, zachowując wszystkie krawędzie/groty.
  Jedna ograniczona ponowna próba rozmieszczenia wykorzystuje miejsca zwolnione
  przez późniejsze etykiety; nie maskuje linii ani nie zmienia relacji.
- **Mindmap:** natywny zaokrąglony root zamiast ciemnego koła; kontrastowa etykieta,
  zachowane grupowanie i hierarchia. Mocniejsze gałęzie, minimum 4,5px, płynne łuki
  kubiczne z zachowaniem końców połączeń i pozycji węzłów z natywnego layoutu.
- **Gantt:** bez redesignu; większy zapas między datami, roczne ticki bez powtarzania
  roku na kilku miesiącach, brak powielonego tytułu. Odstęp etykiet zewnętrznych
  od belki/obróconego rombu jest mierzony; poprawiany tylko zbyt mały natywny gap.
  Zachowano sekcje, kolory, daty, zadania, wiersze i `todayMarker off`.
- **Wykresy:** istniejąca wspólna ramka i aktywny `ChartFrame` nie wymagały zmian.
  Potwierdzono hover, tooltipy, punkty, Donut, legendę i unikalne gradienty.
  Oczko ostatnie po prawej, eksporty diagramów PNG/SVG, wykresów PNG/SVG/CSV.
  Podglądy używają tego samego Dialog i klas tabel, maks. 80vw × 80dvh.
- **Przezroczyste eksporty:** oba eksportery nie dodają już prostokąta tła całego
  SVG. PNG powstaje na nowym canvasie RGBA z zachowaniem alfa. Wypełnienia węzłów,
  belek i segmentów, gradienty, tekst, osie, siatka, legenda oraz lokalne WOFF2 są
  zachowane. Powierzchnia szkła/ramka nie trafiają do pliku. UI, aktywne podglądy
  i eksport CSV pozostają bez zmian.

## Pliki zmienione w tym dopracowaniu

Ścieżki względem `server/webui` (pozostałe zmiany Git istniały już przed zadaniem):

1. `src/lib/components/app/content/DiagramBlock.svelte`
2. `src/lib/components/app/content/MarkdownContent.svelte`
3. `src/lib/diagrams/diagram-title.ts`
4. `src/lib/diagrams/diagram-groups.ts`
5. `src/lib/diagrams/edge-label-layout.ts`
6. `src/lib/diagrams/gantt-layout.ts`
7. `src/lib/diagrams/mermaid-presentation.ts`
8. `src/lib/diagrams/mermaid-runtime.ts`
9. `tests/unit/diagram-layout.test.ts`
10. `tests/unit/mermaid.test.ts`
11. `tests/unit/mermaid-runtime.test.ts`
12. `tests/browser/diagrams.mjs`
13. `tests/browser/diagrams-production.mjs`
14. `docs/diagrams.md`
15. `docs/diagrams-validation.md`
16. `src/lib/charts/chart-export.ts`
17. `src/lib/diagrams/diagram-export.ts`
18. `tests/browser/export-transparency.mjs` (nowy helper testowy)
19. `tests/browser/charts.mjs`
20. `docs/charts.md`

Jedynym nowym plikiem ponad wcześniejszy niezacommitowany zestaw jest wspólny
helper testowy `export-transparency.mjs`; nie dodano architektury produkcyjnej.
Nie zmieniano `ChartFrame.svelte`, wyglądu/gradientów/danych wykresów, wersji 1.9.0,
`AUTHORS.md`, tapet ani zależności. Wspólny akcent ma wartość `#00BEFF`.

## Walidacja końcowa

| Polecenie / test                              | Wynik                              |
| --------------------------------------------- | ---------------------------------- |
| `npm run lint`                                | OK                                 |
| `npm run check`                               | OK — 0 błędów i 0 ostrzeżeń Svelte |
| `npm test`                                    | OK — 73 pliki, 888 testów          |
| `npm run build`                               | OK                                 |
| `npm audit`                                   | 0 podatności                       |
| Chromium dev `diagrams.mjs`                   | OK                                 |
| Chromium dev `charts.mjs`                     | OK                                 |
| Chromium dev `response-preferences.mjs`       | OK                                 |
| Chromium production `diagrams-production.mjs` | OK                                 |
| Chromium production `charts.mjs`              | OK                                 |

Dev: dwa poziomy złożoności każdej rodziny, dwie tapety i różne fonty/rozmiary/wagi.
W aktualnym zestawie **0 nierozwiązanych etykiet** — także złożony State z Fira Sans
16px. Historyczny wynik dla wycofanej rodziny 20px nie jest walidacją nowego
katalogu; aktualny fixture 20px używa Barlow. Test nie pomija kolizji złożonego State. Dodatkowe
asercje sprawdzają centrowanie w obu osiach, zachowanie pięciu relacji przy wspólnym
terminalu, natywny zaokrąglony root i grubsze łuki Mindmap, odstępy zewnętrznych nazw
Gantta od belek/rombów, daty na granicy stycznia/lutego i brak podwójnego tytułu.

Zachowano i sprawdzono streaming (zamknięte fence, stabilność SVG, Stop), anulowanie
starych zadań, lazy loading, strict, walidację SVG, brak zasobów zewnętrznych,
fallbacki, ustawienia Preview/Cancel/Save/Reset, preferencje i historię IndexedDB.
Eksporty PNG/SVG/CSV są pobierane i otwierane niezależnie/offline. Dialogi mają
Escape, powrót fokusu, wewnętrzne przewijanie i limity jak podgląd tabel.

Chromium dev i production sprawdza rzeczywiste pobrane pliki dla Line, Area,
Bar (również grupowany i poziomy), Donut, Flowchart, State, Mindmap i Gantt.
Test przezroczystości wymaga kanału RGBA w nagłówku PNG, alfa=0 w czterech rogach
rastra, obecności przezroczystych pikseli tła i niepustej wizualizacji. SVG nie może
mieć prostokąta pokrywającego dokument i także jest rasteryzowany do kontroli alfa.
Szczegóły dla każdego eksportu zapisuje `transparency.json` w katalogach artefaktów.
Dotychczasowe asercje sprawdzają osadzone fonty, gradienty, dane i niezmienione CSV.

Artefakty i logi:

- `/tmp/opencode/llampart-elegance-diagrams/` — zrzuty, PNG/SVG, `geometry.json`, `results.json`
- `/tmp/opencode/llampart-elegance-charts/` — aktywne tooltipy i eksporty wykresów
- `/tmp/opencode/llampart-elegance-production/` — produkcyjne dialogi `*-preview.png` i eksporty
- `/tmp/opencode/llampart-elegance-charts-production/` — wykresy produkcyjne
- `/tmp/opencode/llampart-elegance-transparent-exports.png` — obejrzane w Chromium
  eksporty wszystkich ośmiu typów, PNG i SVG obok siebie na szachownicy
- `/tmp/opencode/llampart-elegance-*.log` — wyniki poleceń i regresji

## Znane ograniczenia

- Rozmieszczanie etykiet jest ograniczone obliczeniowo. Sprawdzony zestaw przechodzi
  bez kolizji, ale nie jest to gwarancja dla dowolnego gęstego grafu. Nierozwiązana
  etykieta pozostaje widoczna z diagnostyką, zamiast białego tła lub zmiany relacji.
- Mermaid nie udostępnia ustawienia krzywej Mindmap. Łuk jest korektą prezentacji
  istniejącej gałęzi SVG, nie drugim layoutem; oryginalne źródło jest najpierw
  walidowane natywnym parserem. Flowchart/State nie mają przepisywanych ścieżek.
- Gantt nie oferuje stałej osobnej kolumny nazw zadań; długie nazwy są przy belkach,
  w swoich wierszach. Poprawka gapu jest oparta na zmierzonych granicach elementów,
  nie ręcznych przesunięciach dla poszczególnych przykładów. Brak drugiego silnika.
- Duże układy przewijają się; PNG: maks. 8192px/16 mln pikseli. Layout pracuje na
  głównym wątku bez twardego timeoutu. Sprawdzona przeglądarka: Chromium.
- Strict nadal blokuje linki, skrypty i akcje diagramów. Aktywny podgląd diagramu
  oznacza pełny bezpieczny komponent SVG, nie odblokowanie wykonywalnych callbacków.

## Końcowy stan Git

HEAD: `1eacab2 feat(chat): add configurable response preferences`.
38 zmodyfikowanych plików śledzonych i 26 nieśledzonych plików obejmuje także
wcześniejszą implementację. Nic nie jest staged. Pełny status zapisano w
`/tmp/opencode/llampart-elegance-git-status.txt`.

`git diff --check` z wyłączeniem nietkniętego `AUTHORS.md` przechodzi. Pełny wynik
zawiera wyłącznie pięć istniejących końcowych spacji w tym pliku użytkownika.
Nie wykonano commita, pusha, taga, zmiany wersji, publikacji ani deploymentu.
