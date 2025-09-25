# Stock CFA — App locale (v1.2)

Application Web simple pour gérer un stock par code-barres, utilisable en local (ordinateur ou smartphone).

## Nouveautés v1.2
- **Journal des mouvements** (entrées/sorties/init/ajustements UI/scan).
- **Export/Import** des **articles** en **JSON** et **CSV**.
- **Export/Import** du **journal** en **CSV** ou **JSON** (import CSV supporté).
- Badge en ligne/hors-ligne, PWA, et caméra avec bouton *Démarrer le scan*.
- Compatibilité `file://` (sans caméra) et http(s) (caméra active).

## Lancer en local
```bash
cd stock-app-v1.2
python -m http.server 8080
```
Ouvrir **http://localhost:8080** → *Scanner* → **Démarrer le scan** → autoriser caméra.

## CSV attendus
### Articles (articles.csv)
```
barcode,name,qty,min,tags
CFA-00001,Domino 6mm²,42,10,consommable
CFA-00002,Disjoncteur 10A,12,5,protection|TP
```
- `tags` séparés par `|`

### Journal (journal.csv)
```
timeISO,barcode,name,delta,qtyAfter,mode,source
2025-09-24T11:22:33.123Z,CFA-00001,Domino 6mm²,-2,40,out,scan
```

## Notes v1.2.1
- Compatibilité JS élargie (suppression du `*rest` en destructuration).
- Correction paramètre par défaut dans `barcode.js`.
