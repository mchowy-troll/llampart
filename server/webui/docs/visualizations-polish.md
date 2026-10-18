# Finalne dopracowanie wizualizacji

Aktualny zakres i ograniczenia opisują [diagrams.md](diagrams.md), a wyniki
rzeczywistych testów oraz artefakty — [diagrams-validation.md](diagrams-validation.md).

Wspólna oprawa wykresów i diagramów korzysta z `VisualizationHeader.svelte`,
`visualization-frame.css`, `VisualizationPreview.svelte`, istniejącego Dialog
i klas podglądu tabel. Limit okna wynosi 80vw × 80dvh, oczko jest ostatnią akcją
po prawej. Nie zmieniono geometrii zaakceptowanych wykresów ani podglądu tabel.

Podgląd wykresu renderuje aktywny `ChartFrame` z oryginalnym spec i aktualnym wyborem
serii; nie jest już obrazem eksportowym. Lokalna legenda, hover i tooltipy działają
tak samo jak w wiadomości. Każda instancja ma własne identyfikatory SVG. Zamknięcie
niszczy instancję podglądu, nie naruszając wykresu w rozmowie.

Wspólna paleta dziewięciu barw pochodzi wyłącznie z `chart-palette.ts`.
Kolory diagramów odpowiadają jawnym grupom, sekcjom i gałęziom; nie przypisuje się
losowych kolorów węzłom ani znaczeń na podstawie ich nazw. Wykresy zachowują
dotychczasową deterministyczną możliwość rozszerzenia palety do 20 kategorii Donut;
wykresy Line/Area/Bar nadal mają limit pięciu serii.

Eksporty pozostają bez zmian: PNG/SVG dla diagramów, PNG/SVG/CSV dla wykresów.
Zachowano lokalne WOFF2, ustawienia typografii, bezpieczne SVG, streaming,
preferencje, centralną kompozycję promptu oraz kontrakt pre-encode/KV-cache.
