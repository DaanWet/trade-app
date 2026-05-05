# Trade App

Persoonlijke trade-tracker. Geef je koop/verkoop trades in, de app rekent positie-metrics (FIFO), realized/unrealized P&L, currency-conversie en Belgische meerwaardebelasting.

## Stack
- Backend: Express 5 + better-sqlite3 (TypeScript)
- Frontend: Angular 19 (standalone + signals) + Bootstrap 5
- Marktdata: yahoo-finance2 (gratis, geen API key)

## Snel starten

```bash
# Terminal 1 — backend
cd backend
npm install
npm run dev          # http://localhost:3100

# Terminal 2 — frontend
cd frontend
npm install
npm start            # http://localhost:33793
```

Open `http://localhost:33793` in je browser.

## Eerste keer

1. Ga naar **Trades** → **Nieuwe trade**.
2. Typ een ticker (bv. `AAPL`) — autocomplete vindt het symbool en zet automatisch de juiste currency.
3. Vul datum, BUY/SELL, aantal aandelen, prijs/aandeel en eventueel kosten in.
4. Ga naar **Dashboard** voor je posities, totalen en portfolio-grafiek.
5. **Belasting** toont je BE-meerwaardebelasting per jaar (vanaf 2026, 10% boven €10.000 vrijstelling).
6. **Instellingen** → kies je weergave-munt (default EUR).

## Hoe positie-metrics berekend worden

- **FIFO**: SELLs worden gematcht tegen de oudste openstaande BUYs.
- **Avg cost** is het gewogen gemiddelde van de overgebleven open lots (incl. proportionele aankoopkosten).
- **Realized P&L** = som van P&L op afgesloten matches.
- **Unrealized P&L** = (huidige prijs − avg cost) × open shares.
- **Currency**: trades worden in originele munt opgeslagen; conversie pas bij weergave naar je display currency met de FX-koers van die dag.

## Configuratie

`backend/.env`:
```
PORT=3100
DB_PATH=./data/trades.db
DEFAULT_DISPLAY_CURRENCY=EUR
CORS_ORIGIN=http://localhost:4200,http://localhost:4222,http://localhost:33793
```

Database wordt automatisch aangemaakt op eerste start.
