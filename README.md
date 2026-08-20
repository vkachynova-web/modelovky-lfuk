# LFUK Quiz App

Jednoduchá webová aplikace pro procvičování otázek z textových databází v souborech `.txt`.

## Struktura projektu

- `data/raw/` — původní textové databáze s otázkami (přidáváte sem nové soubory `.txt`)
- `data/questions.json` — vygenerovaná databáze ve strukturovaném formátu
- `scripts/parser.py` — parser a validátor textových souborů
- `scripts/validate_database.py` — validace hotového `questions.json`
- `web/index.html` — hlavní rozhraní aplikace
- `web/style.css` — stylování
- `web/app.js` — logika aplikace a kvízu
- `tests/test_parser.py` — základní testy parseru

## Jak vygenerovat databázi

1. Put every topic file into `data/raw/` or pass a custom folder to the parser.
2. Run:

```bash
python3 scripts/parser.py --input-dir "/path/to/txt/files" --output "data/questions.json"
```

3. For validation run:

```bash
python3 scripts/validate_database.py --input "data/questions.json"
```

## Jak spustit aplikaci

Z adresáře projektu spusťte:

```bash
cd lfuk_quiz_app
python3 -m http.server 8000
```

Pak otevřete v prohlížeči:

```text
http://localhost:8000/web/
```

## Poznámka

Všechny otázky, odpovědi a označení správných odpovědí jsou převzaty z původních textových dat. Parser je navržen tak, aby neprováděl vlastní opravy dat a v případě neúplnosti nebo formátových odchylek vypsal přehledný report a skončil s chybou.
