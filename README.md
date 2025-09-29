# Stock CFA — App V2.0

Application Web moderne pour gérer un stock par code-barres, utilisable en local (ordinateur ou smartphone).

## 🆕 Nouveautés V2.0

### Interface utilisateur
- **Design moderne** avec glass morphism et animations fluides
- **Tableau de bord** avec statistiques en temps réel
- **Interface responsive** optimisée mobile et desktop
- **Thème sombre** automatique selon les préférences système
- **Icônes emoji** pour une meilleure lisibilité

### Nouvelles fonctionnalités
- **Prix unitaire** et calcul de la valeur totale du stock
- **Emplacement** des articles (localisation physique)
- **QR Code generator** pour les nouveaux articles
- **Statistiques avancées** sur le tableau de bord
- **Indicateurs visuels** améliorés pour les niveaux de stock
- **Activité récente** sur le tableau de bord

### Améliorations techniques
- **Performance optimisée** avec animations CSS
- **Gestion d'erreurs** améliorée avec notifications
- **Auto-sauvegarde** intelligente
- **Import/Export** étendu avec nouveaux champs
- **PWA** améliorée avec meilleur caching

## 🚀 Lancer en local

```bash
cd stock-app-v2.0
python -m http.server 8080
```

Ouvrir **http://localhost:8080** → *Scanner* → **🎥 Démarrer le scan** → autoriser caméra.

## 📊 Tableau de bord

Le nouveau tableau de bord affiche :
- **Articles total** dans le stock
- **Stock faible** (articles sous le seuil)
- **Valeur totale** du stock en euros
- **Emprunts actifs** en cours
- **Articles en rupture** avec détails
- **Activité récente** des mouvements

## 📋 Formats CSV étendus

### Articles (articles.csv)
```csv
barcode,name,qty,min,price,location,tags
CFA-00001,Domino 6mm²,42,10,2.50,Armoire A,consommable
CFA-00002,Disjoncteur 10A,12,5,15.99,Armoire B,protection|TP
```

### Journal (journal.csv)
```csv
time,barcode,name,delta,qtyAfter,mode,source
2025-01-15T14:30:00.000Z,CFA-00001,Domino 6mm²,-2,40,out,scan
```

## 🎨 Fonctionnalités visuelles

- **Glass morphism** pour les cartes et la navigation
- **Animations fluides** pour les interactions
- **Badges de statut** colorés pour les niveaux de stock
- **Indicateurs visuels** pour les emprunts en retard
- **Mode sombre** automatique
- **Responsive design** pour tous les écrans

## 🔧 Compatibilité

- **Caméra** : HTTPS ou `http://localhost`
- **BarcodeDetector** natif du navigateur
- **File System Access API** pour la sauvegarde (Chrome/Edge)
- **IndexedDB** pour le stockage local
- **Service Worker** pour le mode hors-ligne

## 📱 PWA (Progressive Web App)

L'application peut être installée sur mobile et desktop :
- Mode hors-ligne complet
- Notifications de mise à jour
- Cache intelligent des ressources
- Synchronisation automatique

---

**Made with ❤️ for CFA — Version 2.0**