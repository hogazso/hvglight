# Szita – hvg.hu bulvár nélkül

Saját használatra készült böngészőbővítmény (Manifest V3, Chrome / Edge / Firefox).
A hvg.hu oldalain a saját szabályaid szerint elrejti vagy halványítja a cikkeket, és
ad egy külön, gyors, tiszta hírfolyam oldalt is.

## Telepítés

**Chrome / Edge / Brave**

1. Csomagold ki a zipet egy állandó helyre (a böngésző onnan tölti be, ne töröld).
2. Nyisd meg: `chrome://extensions` (Edge: `edge://extensions`).
3. Kapcsold be a **Fejlesztői módot**, majd **Kicsomagolt bővítmény betöltése**, és válaszd ki a mappát.
4. Tűzd ki az ikont az eszköztárra.

A Chrome egy figyelmeztetést ír ki a `browser_specific_settings` kulcsra. Ez a Firefoxnak
szól, a Chrome nyugodtan figyelmen kívül hagyja.

**Firefox (115+)**

1. `about:debugging#/runtime/this-firefox`, majd **Ideiglenes kiegészítő betöltése**, és válaszd a `manifest.json`-t.
2. `about:addons`, majd Szita, **Engedélyek**: engedélyezd a hvg.hu hozzáférést (MV3 alatt ez nem automatikus).

Ideiglenesen betöltve a Firefox újraindításkor elfelejti. Tartósan úgy maradhat meg, ha
az addons.mozilla.org-on „unlisted”-ként aláíratod (ingyenes, nem lesz nyilvános),
vagy a Developer Editionben kikapcsolod az aláírás-ellenőrzést.

Frissítés kódmódosítás után: a bővítmények oldalán a Szita kártyáján az újratöltés ikon,
majd a hvg.hu lap újratöltése.

## Mit tud

- **Szűrés a hvg.hu-n** (címlap, rovatoldalak, friss hírek, a cikkek alatti ajánlók):
  rovat, címke, kulcsszó, testvéroldal és címlap-blokk alapján.
- **Elrejtés vagy halványítás.** Halványításkor minden kiszűrt kártyán ott az ok
  (pl. „Címke: színes”). A bal alsó számlálóra kattintva egy lapon átmenetileg válthatsz.
- **Tiszta hírfolyam** (popup, majd *Tiszta hírfolyam*): időrendi lista az RSS-ből,
  rovatszűrővel és kereséssel. A *Kiszűrtek mutatása* kapcsolóval okkal együtt
  látod, mi akadt fenn. Bármelyik címkére kattintva tilthatod vagy kivétellé teheted,
  visszavonással.
- **Szabályok oldal**: élőben mutatja, hány friss cikk akad fenn, és a gyakori címkéket
  kattintható javaslatként kínálja. Van benne export és import is (JSON).
- **Szándékos keresés tisztelete**: címke-, szerző- és keresőoldalon nem szűr;
  a hvg.hu/elet rovatoldalon a rovat tiltása nem él, a címkék igen.

## Hogyan dönt

1. **Kivételek (mindig nyernek):** prémium (hvg360) cikk, *Mindig mutat* rovat,
   kivétel címke, kivétel kulcsszó.
2. **Tiltások:** testvéroldal, rovat, címke, kulcsszó.
3. Ami egyikre sem illik, marad.

A rovat az URL első szakasza (`hvg.hu/elet/...` → Élet+Stílus). Egy cikk viszont több
rovat RSS-folyamában is szerepelhet: a hvg sok Élet+Stílus cikket a Kult folyamba is
betesz. Ezért tiltható az Élet+Stílus egésze úgy, hogy a Kult kivétel maradjon.

A **címkék** az RSS-ből jönnek (a címlapkártyákon nincsenek). A bővítmény 15 percenként
letölti a 12 rovat folyamát, és a címkéket cikk-URL szerint tárolja
(`storage.local`, legfeljebb 4 napra). Egy kártya, amelynek a cikke még nincs az
indexben, csak rovat, testvéroldal és kulcsszó alapján szűrődik.

**Kulcsszavak:** részszöveg, kis- és nagybetűtől függetlenül, a címben és a bevezetőben.
Perjelek között reguláris kifejezés: `/– videó$/`. A kulcsszavaknál óvatosan: a
„kiderült” vagy „brutális” a komoly cikkekben is gyakori. A címke szinte mindig
pontosabb.

## Az alapszabályok

Az Élet+Stílus rovat, a szponzorált tartalom és a Pulzus rejtve van; kivétel a Kult
rovat és néhány kulturális címke. Tiltott címkék többek között: színes, hírességek,
divat, életmód, lottó, balhé, HVGame.

Ez szigorú kiindulás: egy-egy jó riport is kieshet, ha az Élet+Stílusban jelent meg.
Az első napokban érdemes a hírfolyamban bekapcsolni a *Kiszűrtek mutatása* kapcsolót,
és címkékre kattintva finomítani.

## Ha a hvg.hu átalakítja az oldalát

Minden oldalfüggő szelektor a `src/content/content.js` elején van:

| Mit keres | Szelektor |
|---|---|
| cikkkártya | `article.article-card` |
| cím | `.article-card__title a` |
| bevezető | `.article-card__lead` |
| címlap-blokk címe | `.card-section__header__title` |
| prémium jelölés | `.is-premium` osztály |

Az RSS-címek a `src/shared/defaults.js`-ben vannak (`FEEDS`).

## Adatkezelés

Semmi nem hagyja el a gépedet. A bővítmény csak a hvg.hu és a pulzus.hvg.hu nyilvános
RSS-folyamait tölti le, sütik nélkül (`credentials: 'omit'`). A szabályok a böngésző
saját szinkronizált tárhelyén vannak (`storage.sync`, tartalékként `storage.local`).

## Felépítés

```
manifest.json
icons/
src/shared/defaults.js   rovatok, testvéroldalak, folyamok, alapszabályok, tárolás
src/shared/rules.js      szabálymotor: URL-elemzés, kulcsszavak, döntés és indoklás
src/shared/feed.js       RSS letöltés, feldolgozás, URL → címkék index
src/shared/ui.js/.css    közös felületi elemek (popover, toast, színek, betűk)
src/content/             a hvg.hu-ba injektált script és stílus
src/popup/               eszköztár-ablak: kapcsoló, mód, a lap statisztikája
src/options/             szabályok oldal
src/reader/              tiszta hírfolyam
```

A content script csak `data-szita-*` attribútumokat tesz a kártyákra; a láthatóságot a
`<html data-szita-mode="hide|dim|off">` és a `content.css` dönti el. A mód váltása ezért
azonnali, nem kell újraszámolni.
