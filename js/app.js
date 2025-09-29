/* Gstock - app.js (Scanner UX patch) */
(() => {
  'use strict';

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sr = $('#sr');

  // Thème
  const themeToggle = $('#themeToggle');
  if (themeToggle){
    themeToggle.value = (localStorage.getItem('gstock.theme') || 'auto');
    themeToggle.addEventListener('change', () => {
      const v = themeToggle.value;
      localStorage.setItem('gstock.theme', v);
      if (v === 'auto') {
        const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', v);
      }
    });
  }

  // Onglets
  const tabs = $$('nav button');
  const sections = {
    items: $('#tab-items'),
    scanner: $('#tab-scanner'),
    labels: $('#tab-labels'),
    journal: $('#tab-journal'),
    gear: $('#tab-gear'),
    settings: $('#tab-settings')
  };

  tabs.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

  async function showTab(name) {
    Object.entries(sections).forEach(([k, el]) => el.hidden = k !== name);
    if (name === 'items') await refreshTable();
    if (name === 'labels') await refreshLabelItems();
    if (name === 'journal') await refreshJournal();
    if (name === 'gear' && typeof refreshLoansTable === 'function') await refreshLoansTable();
    if (name === 'settings') initSettingsPanel();
  }

  // Raccourcis
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#searchItems')?.focus();
    }
    if (e.key.toLowerCase() === 'a') openAdjustDialog({type:'add'});
    if (e.key.toLowerCase() === 'r') openAdjustDialog({type:'remove'});
  });

  // ----------- ARTICLES -----------
  const itemsTbody = $('#itemsTbody');
  const searchItems = $('#searchItems');
  const filterStatus = $('#filterStatus');
  const filterTag = $('#filterTag');
  $('#btnAddItem')?.addEventListener('click', async () => {
    const name = prompt('Nom de l’article ?');
    if (!name) return;
    const code = prompt('Code-barres (laisser vide pour générer)') || await dbGenerateCode();
    const qty = parseInt(prompt('Quantité initiale ?', '0')||'0',10);
    const threshold = parseInt(prompt('Seuil d’alerte ?', '0')||'0',10);
    const tags = (prompt('Tags (séparés par des virgules)')||'').split(',').map(t=>t.trim()).filter(Boolean);
    await dbPut({id: code, code, name, qty, threshold, tags, updated: Date.now()});
    announce('Article créé');
    await refreshTable();
  });

  searchItems?.addEventListener('input', refreshTable);
  filterStatus?.addEventListener('change', refreshTable);
  filterTag?.addEventListener('change', refreshTable);

  function statusBadge(it, buffer=0){
    const s = it.qty - it.threshold;
    if (it.qty <= it.threshold) return `<span class="badge under">S
