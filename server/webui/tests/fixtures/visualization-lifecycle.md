**1. Flowchart — Proces zamawiania produktu**

```mermaid
%% Proces zamawiania produktu
flowchart TD
    A[Otwarcie strony produktu] --> B[Dodanie produktu do koszyka]
    B --> C{Koszyk pusty?}
    C -->|Tak| B
    C -->|Nie| D[Przejście do kasy]
    D --> E[Wprowadzenie adresu dostawy]
    E --> F[Wybór metody płatności]
    F --> G{Płatność udana?}
    G -->|Nie| H[Ponowienie płatności]
    H --> G
    G -->|Tak| I[Wysyłka zamówienia]
    I --> J[Dostawa do klienta]
```

**2. State Diagram — Cykl życia zamówienia**

```mermaid
%% Cykl życia zamówienia
stateDiagram-v2
    state "Nowe zamówienie" as Nowe
    state "W realizacji" as W_realizacji
    state "Wysłane" as Wyslone
    state "Dostarczone" as Dostarczone
    state "Anulowane" as Anulowane
    state "Zwrot" as Zwrot

    [*] --> Nowe
    Nowe --> W_realizacji : Potwierdzenie zamówienia przez system
    W_realizacji --> Wyslone : Nadanie przesyłki przez kuriera
    Wyslone --> Dostarczone : Odbiór przesyłki przez klienta
    W_realizacji --> Anulowane : Rezygnacja klienta od zamówienia
    Anulowane --> Zwrot : Zwrócenie środków na konto klienta
    Dostarczone --> [*]
    Zwrot --> [*]
```

**3. Mindmap — Architektura aplikacji mobilnej**

```mermaid
%% Architektura aplikacji mobilnej
mindmap
  root((Aplikacja mobilna))
    Frontend
      React Native
      Komponenty UI
      Nawigacja
    Backend
      API
      Baza danych
      Autoryzacja
    DevOps
      CI/CD
      Infrastruktura
      Monitoring
    Testowanie
      Testy jednostkowe
      Testy integracyjne
      E2E
```

**4. Gantt — Harmonogram wdrożenia aplikacji**

```mermaid
%% Harmonogram wdrożenia aplikacji
gantt
    title Harmonogram wdrożenia
    dateFormat YYYY-MM-DD
    section Planowanie
    Analiza wymagań        :a1, 2026-11-02, 5d
    Projekt UX/UI          :a2, 2026-11-09, 8d
    section Rozwój
    Backend API            :b1, 2026-11-16, 15d
    Frontend               :b2, 2026-11-16, 18d
    Integracja             :b3, 2026-12-07, 5d
    section Testy
    Testy jednostkowe      :c1, 2026-12-07, 7d
    Testy akceptacyjne     :c2, 2026-12-16, 3d
    section Wdrożenie
    Publikacja produkcyjna :milestone, m1, 2026-12-21, 0d
    Monitoring             :d1, 2026-12-22, 5d
```

**5. Line — Przychody i koszty w 2026 roku**

```llampart-chart
{"type":"line","title":"Przychody i koszty w 2026 roku","description":"Wartości w tysiącach złotych","xKey":"miesiac","xLabel":"Miesiąc","yLabel":"Tys. zł","series":[{"key":"przychody","label":"Przychody"},{"key":"koszty","label":"Koszty"}],"data":[{"miesiac":"Sty","przychody":42,"koszty":28},{"miesiac":"Lut","przychody":58,"koszty":33},{"miesiac":"Mar","przychody":49,"koszty":31},{"miesiac":"Kwi","przychody":73,"koszty":41},{"miesiac":"Maj","przychody":65,"koszty":39},{"miesiac":"Cze","przychody":92,"koszty":52},{"miesiac":"Lip","przychody":81,"koszty":48},{"miesiac":"Sie","przychody":105,"koszty":61},{"miesiac":"Wrz","przychody":91,"koszty":54},{"miesiac":"Paź","przychody":118,"koszty":69},{"miesiac":"Lis","przychody":110,"koszty":64},{"miesiac":"Gru","przychody":136,"koszty":78}]}
```

**6. Area — Skumulowane pobrania aplikacji**

```llampart-chart
{"type":"area","title":"Skumulowane pobrania aplikacji","description":"Wartości w tysiącach pobrań","xKey":"miesiac","xLabel":"Miesiąc","yLabel":"Tys. pobrań","series":[{"key":"pobrania","label":"Pobrania"}],"data":[{"miesiac":"Sty","pobrania":120},{"miesiac":"Lut","pobrania":310},{"miesiac":"Mar","pobrania":650},{"miesiac":"Kwi","pobrania":1050},{"miesiac":"Maj","pobrania":1580},{"miesiac":"Cze","pobrania":2210},{"miesiac":"Lip","pobrania":2950},{"miesiac":"Sie","pobrania":3810},{"miesiac":"Wrz","pobrania":4780},{"miesiac":"Paź","pobrania":5860},{"miesiac":"Lis","pobrania":7130},{"miesiac":"Gru","pobrania":8640}]}
```

**7. Bar — Wyniki sprzedaży produktów**

```llampart-chart
{"type":"bar","title":"Wyniki sprzedaży produktów","description":"Wartości w tysiącach sztuk","xKey":"produkt","xLabel":"Produkt","yLabel":"Tys. szt.","series":[{"key":"q1","label":"Q1"},{"key":"q2","label":"Q2"}],"data":[{"produkt":"Laptop","q1":85,"q2":110},{"produkt":"Monitor","q1":120,"q2":155},{"produkt":"Klawiatura","q1":175,"q2":190},{"produkt":"Mysz","q1":145,"q2":170},{"produkt":"Słuchawki","q1":105,"q2":145}]}
```

**8. Donut — Udział kanałów sprzedaży**

```llampart-chart
{"type":"donut","title":"Udział kanałów sprzedaży","description":"Udział procentowy kanałów sprzedaży","labelKey":"kategoria","valueKey":"udzial","data":[{"kategoria":"Sklep internetowy","udzial":34},{"kategoria":"Marketplace","udzial":24},{"kategoria":"Sprzedaż bezpośrednia","udzial":18},{"kategoria":"Partnerzy","udzial":12},{"kategoria":"Aplikacja mobilna","udzial":8},{"kategoria":"Pozostałe","udzial":4}]}
```
