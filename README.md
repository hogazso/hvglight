# hvglight

Böngészőbővítmény (Manifest V3, Chrome / Edge / Firefox) saját használatra. Szűri a
hvg.hu cikkeit saját szabályok szerint, és két nézegetőt ad hozzá: a heti címlapokhoz
és Marabu karikatúráihoz.

## Telepítés

**Chrome / Edge / Brave**

1. `chrome://extensions` (Edge: `edge://extensions`).
2. Fejlesztői mód be, majd Kicsomagolt bővítmény betöltése, és válaszd a mappát.

A `browser_specific_settings` kulcsra a Chrome figyelmeztetést ír ki, ez a Firefoxnak
szól, nyugodtan figyelmen kívül hagyható.

**Firefox (115+)**

1. `about:debugging#/runtime/this-firefox` → Ideiglenes kiegészítő betöltése → `manifest.json`.
2. `about:addons` → hvglight → Engedélyek → hvg.hu engedélyezése.

Ideiglenes betöltésnél a Firefox újraindításkor elfelejti a bővítményt.

Kódmódosítás után: a bővítmények oldalon a hvglight kártyáján az újratöltés ikon,
majd a hvg.hu lap újratöltése.

## Funkciók

- **Szűrés a hvg.hu-n**: rovat, címke, kulcsszó, testvéroldal és címlap-blokk alapján,
  elrejtéssel vagy halványítással.
- **Tiszta hírfolyam** (popup → Tiszta hírfolyam): időrendi lista az RSS-ből,
  rovatszűrővel, kereséssel, kiszűrtek mutatásával.
- **Címlaptár** (popup → Címlaptár): a heti hvg-címlapok nézegetője, hét/év szerint
  léptethető, ugrás mezővel (pl. `2020-15`).
- **Marabu-tár** (popup → Marabu-tár): Marabu karikatúráinak nézegetője, kereséssel.
- **Szabályok oldal**: a szűrési szabályok szerkesztése, export/import JSON-ban.

Címke-, szerző- és keresőoldalon a bővítmény nem szűr.

## Felépítés

```
manifest.json
icons/
src/shared/    közös logika: szabálymotor, RSS-feldolgozás, UI-elemek, nézegető
src/content/   a hvg.hu-ba injektált script és stílus
src/popup/     eszköztár-ablak
src/options/   szabályok oldal
src/reader/    tiszta hírfolyam
src/covers/    Címlaptár
src/marabu/    Marabu-tár
```

## Adatkezelés

A bővítmény csak a hvg.hu nyilvános oldalait és RSS-folyamait tölti le, sütik nélkül.
A beállítások a böngésző saját tárolójában (`storage.sync` / `storage.local`) vannak,
más nem kap adatot.
