/* Gstock - app.js (Application principale V2.1.4) */
'use strict';

// État global de l'application
const appState = {
  currentTab: 'dashboard',
  scanning: false,
  items: [],
  filteredItems: [],
  moves: [],
  loans: [],
  settings: { buffer: 0, defaultTags: [] },
  githubConfig: null,
  githubStatus: 'inactive'
};

// Utilitaires
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function toast(msg, type = 'info') {
  const sr = $('#sr');
  if (sr) {
    sr.textContent = msg;
    console.log(`[${type.toUpperCase()}] ${msg}`);
  }
}

// Formatage des dates
function formatDate(ts) {
  return new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// Génération de codes intelligents basés sur le nom
function generateSmartCode(name) {
  if (!name || typeof name !== 'string') {
    return dbGenerateCode(); // Fallback vers l'ancien système
  }
  
  // Nettoyer et normaliser le nom
  let cleaned = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Supprimer les accents
    .replace(/[^a-z0-9\s]/g, '') // Garder seulement lettres, chiffres, espaces
    .trim();
  
  if (!cleaned) {
    return dbGenerateCode(); // Fallback si nom vide après nettoyage
  }
  
  // Extraire les mots significatifs
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  let code = '';
  
  // Stratégie de génération intelligente
  if (words.length === 1) {
    // Un seul mot : prendre les 6 premiers caractères
    code = words[0].substring(0, 6).toUpperCase();
  } else if (words.length === 2) {
    // Deux mots : 4 + 4 caractères
    code = (words[0].substring(0, 4) + words[1].substring(0, 4)).toUpperCase();
  } else {
    // Plusieurs mots : stratégie mixte
    const firstWord = words[0].substring(0, 4);
    const otherWords = words.slice(1).map(w => {
      // Extraire chiffres en priorité, sinon premières lettres
      const numbers = w.match(/\d+/g);
      if (numbers && numbers.length > 0) {
        return numbers[0];
      }
      return w.substring(0, 2);
    }).join('');
    
    code = (firstWord + otherWords).substring(0, 8).toUpperCase();
  }
  
  // S'assurer que le code fait au moins 4 caractères
  if (code.length < 4) {
    code = code.padEnd(4, '0');
  }
  
  // Ajouter un suffixe aléatoire pour éviter les doublons
  const suffix = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  code = code.substring(0, 8) + suffix;
  
  // Valider la compatibilité Code 128B
  if (window.validateCode128B && !window.validateCode128B(code)) {
    console.warn('Code généré non compatible Code 128B:', code);
    return dbGenerateCode(); // Fallback vers l'ancien système
  }
  
  return code;
}

// Gestion des onglets
function switchTab(tabName) {
  // Masquer tous les onglets
  $$('section[id^="tab-"]').forEach(section => {
    section.hidden = true;
  });
  
  // Désactiver tous les boutons
  $$('nav button').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Afficher l'onglet sélectionné
  const targetSection = $(`#tab-${tabName}`);
  if (targetSection) {
    targetSection.hidden = false;
  }
  
  // Activer le bouton correspondant
  const targetButton = $(`button[data-tab="${tabName}"]`);
  if (targetButton) {
    targetButton.classList.add('active');
  }
  
  appState.currentTab = tabName;
  
  // Actions spécifiques par onglet
  switch (tabName) {
    case 'dashboard':
      updateDashboard();
      break;
    case 'items':
      loadItems();
      break;
    case 'journal':
      loadJournal();
      break;
    case 'gear':
      loadLoans();
      break;
    case 'labels':
      // Rien de spécial à faire
      break;
    case 'scanner':
      // Rien de spécial à faire
      break;
    case 'settings':
      loadSettings();
      break;
  }
}

// Mise à jour du tableau de bord
async function updateDashboard() {
  try {
    const [items, loans, settings] = await Promise.all([
      dbList(),
      dbListLoans(false), // Seulement les prêts actifs
      dbGetSettings()
    ]);
    
    const totalItems = items.length;
    const lowStock = items.filter(item => (item.qty || 0) <= (item.threshold || 0) + (settings.buffer || 0)).length;
    const outOfStock = items.filter(item => (item.qty || 0) === 0).length;
    const activeLoans = loans.length;
    const totalValue = items.reduce((sum, item) => sum + ((item.qty || 0) * (item.price || 0)), 0);
    
    // Mettre à jour les statistiques
    $('#stat-total').textContent = totalItems;
    $('#stat-low').textContent = lowStock;
    $('#stat-value').textContent = totalValue.toFixed(2) + ' €';
    $('#stat-loans').textContent = activeLoans;
    
    // Statut GitHub
    const githubStatusEl = $('#github-status');
    if (githubStatusEl) {
      if (appState.githubStatus === 'active') {
        githubStatusEl.innerHTML = '🔄 <strong>Actif</strong>';
        githubStatusEl.className = 'dashboard-stat ok';
      } else if (appState.githubStatus === 'configured') {
        githubStatusEl.innerHTML = '⚙️ <strong>Configuré</strong>';
        githubStatusEl.className = 'dashboard-stat';
      } else {
        githubStatusEl.innerHTML = '❌ <strong>Inactif</strong>';
        githubStatusEl.className = 'dashboard-stat muted';
      }
    }
    
    // Articles en rupture
    const outOfStockList = $('#out-of-stock-list');
    if (outOfStockList) {
      if (outOfStock > 0) {
        const outItems = items.filter(item => (item.qty || 0) === 0);
        outOfStockList.innerHTML = outItems.map(item => 
          `<div class="stock-item">
            <strong>${item.name}</strong>
            <span class="code">${item.code}</span>
          </div>`
        ).join('');
      } else {
        outOfStockList.innerHTML = '<div class="muted">Aucun article en rupture 👍</div>';
      }
    }
    
    // Activité récente
    const recentMoves = await dbListMoves({ limit: 5 });
    const recentActivityEl = $('#recent-activity');
    if (recentActivityEl) {
      if (recentMoves.length > 0) {
        recentActivityEl.innerHTML = recentMoves.map(move => 
          `<div class="activity-item">
            <div class="activity-main">
              <strong>${move.name || move.code}</strong>
              <span class="activity-type ${move.type === 'ENTRY' ? 'ok' : 'danger'}">
                ${move.type === 'ENTRY' ? '+' : '-'}${move.qty}
              </span>
            </div>
            <div class="activity-time muted">${formatDate(move.ts)}</div>
          </div>`
        ).join('');
      } else {
        recentActivityEl.innerHTML = '<div class="muted">Aucune activité récente</div>';
      }
    }
    
  } catch (error) {
    console.error('Erreur mise à jour tableau de bord:', error);
    toast('Erreur lors de la mise à jour du tableau de bord', 'error');
  }
}

// Chargement des articles
async function loadItems() {
  try {
    appState.items = await dbList();
    applyItemsFilters();
  } catch (error) {
    console.error('Erreur chargement articles:', error);
    toast('Erreur lors du chargement des articles', 'error');
  }
}

// Application des filtres sur les articles
function applyItemsFilters() {
  const search = $('#searchItems').value.toLowerCase();
  const statusFilter = $('#filterStatus').value;
  const tagFilter = $('#filterTag').value;
  const settings = appState.settings;
  
  appState.filteredItems = appState.items.filter(item => {
    // Filtre de recherche
    if (search && !item.name.toLowerCase().includes(search) && 
        !item.code.toLowerCase().includes(search) && 
        !(item.tags || []).some(tag => tag.toLowerCase().includes(search))) {
      return false;
    }
    
    // Filtre de statut
    if (statusFilter) {
      const qty = item.qty || 0;
      const threshold = (item.threshold || 0) + (settings.buffer || 0);
      
      if (statusFilter === 'ok' && qty <= threshold) return false;
      if (statusFilter === 'low' && (qty === 0 || qty > threshold)) return false;
      if (statusFilter === 'under' && qty !== 0) return false;
    }
    
    // Filtre de tag
    if (tagFilter && !(item.tags || []).includes(tagFilter)) {
      return false;
    }
    
    return true;
  });
  
  renderItemsTable();
}

// Rendu de la table des articles
function renderItemsTable() {
  const tbody = $('#itemsTbody');
  if (!tbody) return;
  
  if (appState.filteredItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center">Aucun article trouvé</td></tr>';
    return;
  }
  
  const settings = appState.settings;
  
  tbody.innerHTML = appState.filteredItems.map(item => {
    const qty = item.qty || 0;
    const threshold = (item.threshold || 0) + (settings.buffer || 0);
    
    let statusClass = 'ok';
    let statusText = 'OK';
    
    if (qty === 0) {
      statusClass = 'under';
      statusText = 'Rupture';
    } else if (qty <= threshold) {
      statusClass = 'low';
      statusText = 'Faible';
    }
    
    const tags = (item.tags || []).map(tag => `<span class="tag">${tag}</span>`).join(' ');
    
    return `
      <tr>
        <td><strong>${item.name}</strong></td>
        <td><code>${item.code}</code></td>
        <td>${qty}</td>
        <td>${item.threshold || 0}</td>
        <td>${tags}</td>
        <td><span class="badge ${statusClass}">${statusText}</span></td>
        <td>
          <button onclick="adjustStock('${item.code}')" class="btn">Ajuster</button>
          <button onclick="editItem('${item.code}')" class="btn">Modifier</button>
          <button onclick="deleteItem('${item.code}')" class="btn danger">Supprimer</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Mise à jour des filtres de tags
function updateTagFilters() {
  const tagFilter = $('#filterTag');
  if (!tagFilter) return;
  
  const allTags = new Set();
  appState.items.forEach(item => {
    (item.tags || []).forEach(tag => allTags.add(tag));
  });
  
  const currentValue = tagFilter.value;
  tagFilter.innerHTML = '<option value="">Tous tags</option>' +
    Array.from(allTags).sort().map(tag => 
      `<option value="${tag}" ${tag === currentValue ? 'selected' : ''}>${tag}</option>`
    ).join('');
}

// Ajustement du stock
async function adjustStock(code) {
  try {
    const item = await dbGet(code);
    if (!item) {
      toast('Article non trouvé', 'error');
      return;
    }
    
    $('#dlgItem').textContent = `${item.name} (${item.code}) - Stock actuel: ${item.qty || 0}`;
    $('#dlgQty').value = '1';
    $('#dlgNote').value = '';
    $('#dlgType').value = 'add';
    
    const dialog = $('#adjustDialog');
    dialog.showModal();
    
    // Gérer la validation
    $('#dlgValidate').onclick = async () => {
      const type = $('#dlgType').value;
      const qty = parseInt($('#dlgQty').value) || 0;
      const note = $('#dlgNote').value.trim();
      
      if (qty <= 0) {
        toast('Quantité invalide', 'error');
        return;
      }
      
      const delta = type === 'add' ? qty : -qty;
      
      try {
        const newQty = await dbAdjustQty(code, delta);
        await dbAddMove({
          ts: Date.now(),
          type: type === 'add' ? 'ENTRY' : 'EXIT',
          code: item.code,
          name: item.name,
          qty: qty,
          note: note
        });
        
        toast(`Stock ajusté: ${item.name} → ${newQty}`, 'success');
        dialog.close();
        loadItems();
        updateDashboard();
      } catch (error) {
        console.error('Erreur ajustement stock:', error);
        toast('Erreur lors de l\'ajustement', 'error');
      }
    };
    
  } catch (error) {
    console.error('Erreur ouverture dialog ajustement:', error);
    toast('Erreur lors de l\'ouverture du dialog', 'error');
  }
}

// Édition d'un article
async function editItem(code) {
  try {
    const item = await dbGet(code);
    if (!item) {
      toast('Article non trouvé', 'error');
      return;
    }
    
    const name = prompt('Nom de l\'article:', item.name);
    if (name === null) return;
    
    const threshold = prompt('Seuil d\'alerte:', item.threshold || 0);
    if (threshold === null) return;
    
    const price = prompt('Prix unitaire (€):', item.price || 0);
    if (price === null) return;
    
    const location = prompt('Emplacement:', item.location || '');
    if (location === null) return;
    
    const tagsStr = prompt('Tags (séparés par des virgules):', (item.tags || []).join(', '));
    if (tagsStr === null) return;
    
    const updatedItem = {
      ...item,
      name: name.trim(),
      threshold: parseInt(threshold) || 0,
      price: parseFloat(price) || 0,
      location: location.trim(),
      tags: tagsStr.split(',').map(t => t.trim()).filter(t => t),
      updated: Date.now()
    };
    
    await dbPut(updatedItem);
    toast('Article modifié avec succès', 'success');
    loadItems();
    updateTagFilters();
    updateDashboard();
    
  } catch (error) {
    console.error('Erreur modification article:', error);
    toast('Erreur lors de la modification', 'error');
  }
}

// Suppression d'un article
async function deleteItem(code) {
  if (!confirm('Êtes-vous sûr de vouloir supprimer cet article ?')) {
    return;
  }
  
  try {
    await dbDelete(code);
    toast('Article supprimé', 'success');
    loadItems();
    updateTagFilters();
    updateDashboard();
  } catch (error) {
    console.error('Erreur suppression article:', error);
    toast('Erreur lors de la suppression', 'error');
  }
}

// Ajout d'un nouvel article
async function addNewItem() {
  const name = prompt('Nom de l\'article:');
  if (!name || !name.trim()) return;
  
  const qty = prompt('Quantité initiale:', '0');
  if (qty === null) return;
  
  const threshold = prompt('Seuil d\'alerte:', '5');
  if (threshold === null) return;
  
  const price = prompt('Prix unitaire (€):', '0');
  if (price === null) return;
  
  const location = prompt('Emplacement:', '');
  if (location === null) return;
  
  const tagsStr = prompt('Tags (séparés par des virgules):', '');
  if (tagsStr === null) return;
  
  try {
    const code = generateSmartCode(name.trim());
    
    const item = {
      code: code,
      name: name.trim(),
      qty: parseInt(qty) || 0,
      threshold: parseInt(threshold) || 0,
      price: parseFloat(price) || 0,
      location: location.trim(),
      tags: tagsStr.split(',').map(t => t.trim()).filter(t => t),
      updated: Date.now()
    };
    
    await dbPut(item);
    
    if (item.qty > 0) {
      await dbAddMove({
        ts: Date.now(),
        type: 'ENTRY',
        code: item.code,
        name: item.name,
        qty: item.qty,
        note: 'Création article'
      });
    }
    
    toast(`Article créé: ${item.name} (${code})`, 'success');
    loadItems();
    updateTagFilters();
    updateDashboard();
    
  } catch (error) {
    console.error('Erreur création article:', error);
    toast('Erreur lors de la création', 'error');
  }
}

// Chargement du journal
async function loadJournal() {
  try {
    const fromDate = $('#dateFrom').value;
    const toDate = $('#dateTo').value;
    
    let from = 0;
    let to = Infinity;
    
    if (fromDate) {
      from = new Date(fromDate).getTime();
    }
    if (toDate) {
      to = new Date(toDate + 'T23:59:59').getTime();
    }
    
    appState.moves = await dbListMoves({ from, to, limit: 1000 });
    renderJournalTable();
  } catch (error) {
    console.error('Erreur chargement journal:', error);
    toast('Erreur lors du chargement du journal', 'error');
  }
}

// Rendu de la table du journal
function renderJournalTable() {
  const tbody = $('#journalTbody');
  if (!tbody) return;
  
  if (appState.moves.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center">Aucun mouvement trouvé</td></tr>';
    return;
  }
  
  tbody.innerHTML = appState.moves.map(move => `
    <tr>
      <td>${formatDate(move.ts)}</td>
      <td><span class="badge ${move.type === 'ENTRY' ? 'ok' : 'danger'}">${move.type === 'ENTRY' ? 'Entrée' : 'Sortie'}</span></td>
      <td><code>${move.code}</code></td>
      <td>${move.name || ''}</td>
      <td>${move.qty || 0}</td>
      <td>${move.note || ''}</td>
    </tr>
  `).join('');
}

// Chargement des prêts
async function loadLoans() {
  try {
    appState.loans = await dbListLoans(true);
    renderLoansTable();
  } catch (error) {
    console.error('Erreur chargement prêts:', error);
    toast('Erreur lors du chargement des prêts', 'error');
  }
}

// Rendu de la table des prêts
function renderLoansTable() {
  const tbody = $('#loansTbody');
  if (!tbody) return;
  
  if (appState.loans.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center">Aucun prêt trouvé</td></tr>';
    return;
  }
  
  tbody.innerHTML = appState.loans.map(loan => {
    const isActive = !loan.returnedAt;
    const isOverdue = isActive && new Date(loan.due) < new Date();
    
    let statusClass = 'ok';
    let statusText = 'Rendu';
    
    if (isActive) {
      statusClass = isOverdue ? 'danger' : 'low';
      statusText = isOverdue ? 'En retard' : 'En cours';
    }
    
    return `
      <tr>
        <td><strong>${loan.name}</strong></td>
        <td><code>${loan.code}</code></td>
        <td>${loan.person}</td>
        <td>${new Date(loan.due).toLocaleDateString('fr-FR')}</td>
        <td><span class="badge ${statusClass}">${statusText}</span></td>
        <td>
          ${isActive ? `<button onclick="returnLoan(${loan.id})" class="btn">Retourner</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

// Retour d'un prêt
async function returnLoan(loanId) {
  try {
    await dbReturnLoan(loanId);
    toast('Prêt retourné avec succès', 'success');
    loadLoans();
    updateDashboard();
  } catch (error) {
    console.error('Erreur retour prêt:', error);
    toast('Erreur lors du retour du prêt', 'error');
  }
}

// Nouveau prêt
async function newLoan() {
  const code = prompt('Code de l\'article:');
  if (!code || !code.trim()) return;
  
  try {
    const item = await dbGet(code.trim());
    if (!item) {
      toast('Article non trouvé', 'error');
      return;
    }
    
    const person = prompt('Nom de l\'emprunteur:');
    if (!person || !person.trim()) return;
    
    const due = prompt('Date de retour prévue (YYYY-MM-DD):');
    if (!due) return;
    
    const note = prompt('Note (optionnel):') || '';
    
    await dbCreateLoan({
      code: item.code,
      name: item.name,
      person: person.trim(),
      due: due,
      note: note.trim()
    });
    
    toast('Prêt créé avec succès', 'success');
    loadLoans();
    updateDashboard();
    
  } catch (error) {
    console.error('Erreur création prêt:', error);
    toast('Erreur lors de la création du prêt', 'error');
  }
}

// Chargement des paramètres
async function loadSettings() {
  try {
    appState.settings = await dbGetSettings();
    $('#inputBuffer').value = appState.settings.buffer || 0;
    $('#inputDefaultTags').value = (appState.settings.defaultTags || []).join(', ');
    
    // Charger la config GitHub
    if (window.githubSync) {
      const config = window.githubSync.loadSaved();
      $('#ghOwner').value = config.owner || '';
      $('#ghRepo').value = config.repo || '';
      $('#ghPath').value = config.path || 'gstock-shared.json';
      $('#ghToken').value = config.token || '';
      
      // Mettre à jour le statut
      if (config.owner && config.repo && config.token) {
        appState.githubStatus = 'configured';
      }
    }
    
    // État du debug
    $('#chkDebug').checked = window.GSTOCK_DEBUG || false;
    
  } catch (error) {
    console.error('Erreur chargement paramètres:', error);
    toast('Erreur lors du chargement des paramètres', 'error');
  }
}

// Sauvegarde des paramètres
async function saveSettings() {
  try {
    const buffer = parseInt($('#inputBuffer').value) || 0;
    const tagsStr = $('#inputDefaultTags').value || '';
    const defaultTags = tagsStr.split(',').map(t => t.trim()).filter(t => t);
    
    await dbSetSettings({ buffer, defaultTags });
    appState.settings = { buffer, defaultTags };
    
    toast('Paramètres sauvegardés', 'success');
    updateDashboard();
    
  } catch (error) {
    console.error('Erreur sauvegarde paramètres:', error);
    toast('Erreur lors de la sauvegarde', 'error');
  }
}

// Gestion du mode debug
function toggleDebug() {
  const enabled = $('#chkDebug').checked;
  window.GSTOCK_DEBUG = enabled;
  localStorage.setItem('gstock.debug', enabled ? '1' : '0');
  
  // Émettre un événement pour le scanner
  window.dispatchEvent(new CustomEvent('gstock:debug-changed', {
    detail: { enabled }
  }));
  
  toast(`Mode debug ${enabled ? 'activé' : 'désactivé'}`, 'info');
}

// Export CSV
async function exportCSV() {
  try {
    const csv = await dbExport('csv');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gstock-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Export CSV téléchargé', 'success');
  } catch (error) {
    console.error('Erreur export CSV:', error);
    toast('Erreur lors de l\'export CSV', 'error');
  }
}

// Export JSON
async function exportJSON() {
  try {
    const data = await dbExportFull();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gstock-full-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Export JSON téléchargé', 'success');
  } catch (error) {
    console.error('Erreur export JSON:', error);
    toast('Erreur lors de l\'export JSON', 'error');
  }
}

// Import JSON
async function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!confirm('Cette opération va remplacer toutes les données actuelles. Continuer ?')) {
        return;
      }
      
      await dbImportFull(data);
      toast('Import réussi', 'success');
      
      // Recharger toutes les données
      await loadItems();
      await loadJournal();
      await loadLoans();
      await loadSettings();
      updateTagFilters();
      updateDashboard();
      
    } catch (error) {
      console.error('Erreur import JSON:', error);
      toast('Erreur lors de l\'import: ' + error.message, 'error');
    }
  };
  
  input.click();
}

// Chargement de la démo
async function loadDemo() {
  if (!confirm('Charger les données de démo ? Cela remplacera les données actuelles.')) {
    return;
  }
  
  try {
    const response = await fetch('data/demo.json');
    if (!response.ok) {
      throw new Error('Impossible de charger demo.json');
    }
    
    const data = await response.json();
    await dbImportFull(data);
    
    toast('Données de démo chargées', 'success');
    
    // Recharger toutes les données
    await loadItems();
    await loadJournal();
    await loadLoans();
    await loadSettings();
    updateTagFilters();
    updateDashboard();
    
  } catch (error) {
    console.error('Erreur chargement démo:', error);
    toast('Erreur lors du chargement de la démo: ' + error.message, 'error');
  }
}

// Gestion du fichier partagé
async function linkSharedFile() {
  if (!('showSaveFilePicker' in window)) {
    toast('Fonctionnalité non supportée sur ce navigateur', 'error');
    return;
  }
  
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'gstock-shared.json',
      types: [{
        description: 'JSON files',
        accept: { 'application/json': ['.json'] }
      }]
    });
    
    await dbLinkSharedFile(handle);
    $('#sharedFileStatus').textContent = 'Fichier lié: ' + handle.name;
    toast('Fichier partagé activé', 'success');
    
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Erreur fichier partagé:', error);
      toast('Erreur lors de la liaison du fichier', 'error');
    }
  }
}

// Gestion des étiquettes
function generateLabelsForAll() {
  if (appState.items.length === 0) {
    toast('Aucun article à imprimer', 'error');
    return;
  }
  
  generateLabels(appState.items);
}

function generateLabelsForSelection() {
  // Pour l'instant, on utilise les articles filtrés
  if (appState.filteredItems.length === 0) {
    toast('Aucun article sélectionné', 'error');
    return;
  }
  
  generateLabels(appState.filteredItems);
}

function generateLabels(items) {
  const preview = $('#labelsPreview');
  if (!preview) return;
  
  preview.innerHTML = '';
  
  items.forEach(item => {
    const labelDiv = document.createElement('div');
    labelDiv.className = 'label-card';
    
    // Nom de l'article (tronqué si trop long)
    const nameDiv = document.createElement('div');
    nameDiv.className = 'name';
    nameDiv.textContent = item.name.length > 20 ? item.name.substring(0, 17) + '...' : item.name;
    
    // Code-barres SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.className = 'barcode-svg';
    
    if (window.renderBarcodeSVG) {
      const success = window.renderBarcodeSVG(svg, item.code, {
        width: 180,
        height: 40,
        showText: false,
        fontSize: 8,
        quietZone: 5
      });
      
      if (!success) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="red" font-size="8">Erreur code-barres</text>';
      }
    } else {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="gray" font-size="8">Code-barres indisponible</text>';
    }
    
    // Code en texte
    const codeDiv = document.createElement('div');
    codeDiv.className = 'code-text';
    codeDiv.textContent = item.code;
    
    labelDiv.appendChild(nameDiv);
    labelDiv.appendChild(svg);
    labelDiv.appendChild(codeDiv);
    
    preview.appendChild(labelDiv);
  });
  
  toast(`${items.length} étiquettes générées`, 'success');
}

function printLabels() {
  window.print();
}

// Gestion du scanner
async function startScanner() {
  const video = $('#scanVideo');
  const startBtn = $('#btnScanStart');
  const stopBtn = $('#btnScanStop');
  
  if (!video || appState.scanning) return;
  
  try {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    appState.scanning = true;
    
    toast('Démarrage du scanner...', 'info');
    
    // Démarrer le scan avec gestion des codes inconnus
    const code = await window.scanUntilKnown(video, {
      onUnknownCode: (unknownCode) => {
        toast(`Code inconnu détecté: ${unknownCode}`, 'info');
        
        // Proposer de créer l'article après 3 secondes
        setTimeout(() => {
          if (appState.scanning && confirm(`Code inconnu: ${unknownCode}\nVoulez-vous créer un nouvel article ?`)) {
            createItemFromCode(unknownCode);
          }
        }, 3000);
      }
    });
    
    if (code) {
      toast(`Code scanné: ${code}`, 'success');
      
      // Ouvrir directement le dialog d'ajustement
      await adjustStock(code);
    }
    
  } catch (error) {
    console.error('Erreur scanner:', error);
    toast('Erreur scanner: ' + error.message, 'error');
  } finally {
    await stopScanner();
  }
}

async function stopScanner() {
  if (!appState.scanning) return;
  
  try {
    await window.stopScan();
    appState.scanning = false;
    
    $('#btnScanStart').disabled = false;
    $('#btnScanStop').disabled = true;
    
    toast('Scanner arrêté', 'info');
  } catch (error) {
    console.error('Erreur arrêt scanner:', error);
  }
}

async function toggleTorch() {
  if (!appState.scanning) {
    toast('Scanner non actif', 'error');
    return;
  }
  
  try {
    const enabled = await window.toggleTorch();
    toast(`Torche ${enabled ? 'activée' : 'désactivée'}`, 'info');
  } catch (error) {
    console.error('Erreur torche:', error);
    toast('Erreur contrôle torche', 'error');
  }
}

// Création d'article depuis un code scanné
async function createItemFromCode(code) {
  const name = prompt('Nom de l\'article:', '');
  if (!name || !name.trim()) return;
  
  const qty = prompt('Quantité initiale:', '0');
  if (qty === null) return;
  
  const threshold = prompt('Seuil d\'alerte:', '5');
  if (threshold === null) return;
  
  try {
    const item = {
      code: code,
      name: name.trim(),
      qty: parseInt(qty) || 0,
      threshold: parseInt(threshold) || 0,
      price: 0,
      location: '',
      tags: [],
      updated: Date.now()
    };
    
    await dbPut(item);
    
    if (item.qty > 0) {
      await dbAddMove({
        ts: Date.now(),
        type: 'ENTRY',
        code: item.code,
        name: item.name,
        qty: item.qty,
        note: 'Création depuis scan'
      });
    }
    
    toast(`Article créé: ${item.name}`, 'success');
    loadItems();
    updateTagFilters();
    updateDashboard();
    
    // Ouvrir le dialog d'ajustement
    await adjustStock(code);
    
  } catch (error) {
    console.error('Erreur création article depuis code:', error);
    toast('Erreur lors de la création', 'error');
  }
}

// Gestion GitHub
function enableGitHubSync() {
  if (!window.githubSync) {
    toast('Module GitHub non disponible', 'error');
    return;
  }
  
  const owner = $('#ghOwner').value.trim();
  const repo = $('#ghRepo').value.trim();
  const path = $('#ghPath').value.trim() || 'gstock-shared.json';
  const token = $('#ghToken').value.trim();
  
  if (!owner || !repo || !token) {
    toast('Veuillez remplir tous les champs GitHub', 'error');
    return;
  }
  
  try {
    window.githubSync.init({ owner, repo, path, token });
    appState.githubConfig = { owner, repo, path, token };
    appState.githubStatus = 'configured';
    
    toast('🔧 Configuration GitHub sauvegardée', 'success');
    updateDashboard();
    
  } catch (error) {
    console.error('Erreur config GitHub:', error);
    toast('Erreur configuration GitHub', 'error');
  }
}

async function pullFromGitHub() {
  if (!window.githubSync || appState.githubStatus === 'inactive') {
    toast('GitHub non configuré', 'error');
    return;
  }
  
  try {
    toast('📥 Pull depuis GitHub...', 'info');
    await window.githubSync.pull();
    
    // Recharger les données
    await loadItems();
    await loadJournal();
    await loadLoans();
    await loadSettings();
    updateTagFilters();
    updateDashboard();
    
    toast('📥 Pull GitHub réussi', 'success');
    
  } catch (error) {
    console.error('Erreur pull GitHub:', error);
    toast('❌ Erreur pull GitHub: ' + error.message, 'error');
  }
}

async function pushToGitHub() {
  if (!window.githubSync || appState.githubStatus === 'inactive') {
    toast('GitHub non configuré', 'error');
    return;
  }
  
  try {
    toast('📤 Push vers GitHub...', 'info');
    await window.githubSync.push();
    toast('📤 Push GitHub réussi', 'success');
    
  } catch (error) {
    console.error('Erreur push GitHub:', error);
    toast('❌ Erreur push GitHub: ' + error.message, 'error');
  }
}

function startGitHubAutoSync() {
  if (!window.githubSync || appState.githubStatus === 'inactive') {
    toast('GitHub non configuré', 'error');
    return;
  }
  
  try {
    window.githubSync.startAuto(30000); // 30 secondes
    appState.githubStatus = 'active';
    toast('🔄 Auto-sync GitHub activé', 'success');
    updateDashboard();
    
  } catch (error) {
    console.error('Erreur auto-sync GitHub:', error);
    toast('Erreur auto-sync GitHub', 'error');
  }
}

function stopGitHubAutoSync() {
  if (!window.githubSync) {
    toast('Module GitHub non disponible', 'error');
    return;
  }
  
  try {
    window.githubSync.stopAuto();
    appState.githubStatus = 'configured';
    toast('⏹️ Auto-sync GitHub arrêté', 'success');
    updateDashboard();
    
  } catch (error) {
    console.error('Erreur arrêt auto-sync GitHub:', error);
    toast('Erreur arrêt auto-sync GitHub', 'error');
  }
}

// Gestion du thème
function initTheme() {
  const toggle = $('#themeToggle');
  if (!toggle) return;
  
  const saved = localStorage.getItem('gstock.theme') || 'auto';
  toggle.value = saved;
  
  toggle.addEventListener('change', () => {
    const theme = toggle.value;
    localStorage.setItem('gstock.theme', theme);
    
    if (theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  });
}

// Raccourcis clavier
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+K pour la recherche
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      const search = $('#searchItems');
      if (search && appState.currentTab === 'items') {
        search.focus();
      }
    }
    
    // Raccourcis simples (sans modificateurs)
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return; // Ne pas intercepter si on tape dans un champ
    }
    
    switch (e.key.toLowerCase()) {
      case 'a':
        if (appState.currentTab === 'items') {
          e.preventDefault();
          addNewItem();
        }
        break;
      case 'r':
        if (appState.currentTab === 'items') {
          e.preventDefault();
          // Recharger les articles
          loadItems();
        }
        break;
    }
  });
}

// Initialisation de l'application
async function initApp() {
  try {
    // Initialiser la base de données
    await dbInit();
    
    // Initialiser le thème
    initTheme();
    
    // Initialiser les raccourcis clavier
    initKeyboardShortcuts();
    
    // Mettre à jour la version dans l'interface
    const versionEl = $('#appVersion');
    if (versionEl) {
      versionEl.textContent = window.APP_VERSION || '2.1.4';
    }
    
    // Événements de navigation
    $$('nav button[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });
    
    // Événements des boutons
    $('#btnAddItem')?.addEventListener('click', addNewItem);
    $('#searchItems')?.addEventListener('input', applyItemsFilters);
    $('#filterStatus')?.addEventListener('change', applyItemsFilters);
    $('#filterTag')?.addEventListener('change', applyItemsFilters);
    
    $('#btnFilterJournal')?.addEventListener('click', loadJournal);
    $('#btnExportCSV')?.addEventListener('click', exportCSV);
    $('#btnExportJSON')?.addEventListener('click', exportJSON);
    
    $('#btnNewLoan')?.addEventListener('click', newLoan);
    
    $('#btnScanStart')?.addEventListener('click', startScanner);
    $('#btnScanStop')?.addEventListener('click', stopScanner);
    $('#btnScanTorch')?.addEventListener('click', toggleTorch);
    
    $('#btnLabelsAll')?.addEventListener('click', generateLabelsForAll);
    $('#btnLabelsSelected')?.addEventListener('click', generateLabelsForSelection);
    $('#btnLabelsPrintA4')?.addEventListener('click', printLabels);
    
    $('#btnImportJSON')?.addEventListener('click', importJSON);
    $('#btnExportFull')?.addEventListener('click', exportJSON);
    $('#btnLinkSharedFile')?.addEventListener('click', linkSharedFile);
    $('#btnSaveSettings')?.addEventListener('click', saveSettings);
    $('#btnLoadDemo')?.addEventListener('click', loadDemo);
    $('#chkDebug')?.addEventListener('change', toggleDebug);
    
    $('#btnGHEnable')?.addEventListener('click', enableGitHubSync);
    $('#btnGHPull')?.addEventListener('click', pullFromGitHub);
    $('#btnGHPush')?.addEventListener('click', pushToGitHub);
    $('#btnGHStart')?.addEventListener('click', startGitHubAutoSync);
    $('#btnGHStop')?.addEventListener('click', stopGitHubAutoSync);
    
    // Événements du dialog
    $('#dlgClose')?.addEventListener('click', () => {
      $('#adjustDialog').close();
    });
    
    // Initialiser les dates du journal (derniers 30 jours)
    const today = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    const dateFrom = $('#dateFrom');
    const dateTo = $('#dateTo');
    if (dateFrom) dateFrom.value = monthAgo.toISOString().split('T')[0];
    if (dateTo) dateTo.value = today.toISOString().split('T')[0];
    
    // Charger les données initiales
    await loadItems();
    updateTagFilters();
    
    // Démarrer sur le tableau de bord
    switchTab('dashboard');
    
    toast('Application initialisée', 'success');
    
  } catch (error) {
    console.error('Erreur initialisation app:', error);
    toast('Erreur lors de l\'initialisation: ' + error.message, 'error');
  }
}

// Exposer les fonctions globales nécessaires
window.adjustStock = adjustStock;
window.editItem = editItem;
window.deleteItem = deleteItem;
window.returnLoan = returnLoan;

// Démarrer l'application quand le DOM est prêt
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
