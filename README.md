# Munich Immo Dashboard

Static dashboard for the daily Munich Property Hunter search (GitHub Pages).
The daily run writes the listing data into `const DATA` in `index.html`; the
page evaluates every listing in the browser against the buyer profile.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Dashboard (UI in German). Data in `const DATA = {run, L, EX, D}`. |
| `hunter/profile.js` | Buyer profile: mandatory filters, legacy filters, preferences, scoring weights, Bavarian cost rates. |
| `hunter/evaluate.js` | Pure evaluation functions: mandatory filters, match status, scoring, financials, rent estimate, dedup, snapshot comparison. |
| `test/` | `node --test` suite. Run with `npm test` (Node 18+, no dependencies). |

When publishing the dashboard elsewhere (e.g. as an artifact), ship
`hunter/profile.js` and `hunter/evaluate.js` next to `index.html`.

## Match status

Each mandatory filter returns `pass`, `fail` or `unknown`:

- any `fail` → `EXCLUDED`
- otherwise any `unknown` → `NEEDS_VERIFICATION`
- all `pass` → `CONFIRMED`

Mandatory filters: Eigentumswohnung/Kauf, München Stadt or Landkreis,
price ≤ 300,000 €, area ≥ 45 m², 2 or 2.5 rooms, private Balkon/Loggia/Terrasse
(communal garden does not count), no Dachgeschoss, no Erbpacht/Erbbaurecht,
no Wohnrecht/Nießbrauch, acceptable public transport (verified routes only;
unknown routes are flagged, never assumed).

Legacy filters from earlier runs (`profile.legacy`, on by default):
unvermietet only, no Erdgeschoss/Hochparterre, no Baujahr 1960–1985.

## Scoring (100 points, `profile.weights`)

| Category | Weight |
| --- | --- |
| Neighborhood quality | 25 |
| Transportation | 20 |
| Building and apartment condition | 20 |
| Rental demand and resale liquidity | 15 |
| Price and acquisition costs | 10 |
| Balcony and infrastructure | 10 |

Missing inputs score 0 and mark the result as provisional (`score.provisional`,
`score.missing`). Preferences (price < 275,000 €, non-corner, small building,
etc.) only affect the score, never the status.

## Listing fields

Existing fields (`id, zone, district, plz, title, price, area, rooms, outdoor,
rail, transit, occ, photo, facts, warns, todo, links, rank, status`) are kept.
`facts` entries for Etage, Baujahr, Hausgeld, Provision, Energieklasse and
Zustand are parsed automatically. Optional fields, fill only from evidence:

```js
{
  propertyType: "Eigentumswohnung", offerType: "Kauf",
  firstSeen: "2026-11-10",            // from snapshot history, drives freshness filter
  micro: "ruhige Seitenstraße nahe Luitpoldpark",
  tenure: "Eigentum",                  // or "Erbbaurecht"
  floor: "2 von 4", attic: false,
  outdoorSqm: 6.5,
  yearBuilt: 1998, renovated: true, condition: "gepflegt", energyClass: "C",
  units: 18, highRise: false, corner: false, lightLayout: 4,          // 0..5
  weg: { sonderumlage: false, sanierungsstau: false, reserve: 45000 },
  hausgeld: 280, hausgeldNonRecoverable: 110, brokerRate: 0.0357,
  renovation: { amount: 15000, basis: "Exposé: Bad renovierungsbedürftig" },
  legalIssues: [], tenantRestrictions: null,
  neighborhood: {                      // 0..5 or {score, source}
    buildingEnvironment, quietGreen, shopping, maintenance, rentalDemand, gastronomy
  },
  routes: {                            // verified door-to-door connections only
    "Hauptbahnhof": { verified: true, walkMin: 6, lines: ["U2"], modes: ["U"], transfers: 0, totalMin: 18, source: "MVV" },
    "Marienplatz": { ... }, "Münchner Freiheit": { ... }
  },
  infra: {                             // walking minutes from a source; false = confirmed none
    supermarkets: [{ name: "REWE", walkMin: 4 }],
    alnatura: false, drugstore: { name: "dm", walkMin: 7 },
    pharmacy: { walkMin: 3 }, bakery: { walkMin: 2 }
  },
  rentComps: [                         // kind: achieved | mietspiegel | asking
    { eurPerSqm: 21.5, kind: "mietspiegel", source: "Mietspiegel München 2025" }
  ]
}
```

Rent estimates are never marked as verified; estimates based only on asking
rents are labelled as such.

## Financials (Bavaria)

- Grunderwerbsteuer 3.5 % (statutory)
- Notar + Grundbuch 2.0 % (estimate)
- Buyer commission from the listing; if unknown the total is shown as a lower bound
- Renovation budget only when the listing gives evidence (`renovation.basis`)
