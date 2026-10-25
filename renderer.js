const api = window.browserAPI;
const $ = (id) => document.getElementById(id);
const chromeMenu = $('chrome-menu');
const home = $('home');
const defaultHome = $('default-home');
const panel = $('assistant-panel');
const quickPanel = $('panel-content');
const contentView = $('content-view');
let panelOpen = false;
let activeUrl = '';
let activeTitle = '';
let bookmarks = readStoredArray('mantra-bookmarks');
let historyItems = readStoredArray('mantra-history');
let readingItems = readStoredArray('mantra-reading-list');
let tabGroups = readStoredArray('mantra-tab-groups');
let notesItems = readStoredArray('mantra-notes-list');
if (!notesItems.length && localStorage.getItem('mantra-notes')) notesItems=[{id:cryptoRandomId(),title:localStorage.getItem('mantra-notes-title')||'Note',body:localStorage.getItem('mantra-notes'),time:Date.now()}];
let activeNoteId = notesItems[0]?.id || null;
let downloads = [];
let tabs = [];
let activeTabId = null;
let authUser = null;
let authConfigured = false;
let googleConfigured = false;
let authConfigHint = 'See README.md for Firebase configuration instructions, then restart MantraAI Browser.';
let authMode = 'login';
let authBusy = false;
const WALLPAPERS = {
  default:'assets/home-wallpaper.svg',
  dusk:'assets/dusk-wallpaper.svg',
  blue:'assets/blue-hour-wallpaper.svg'
};
let rotationTimer = null;
let lastFindQuery = '';

function readStoredArray(key) { try { const value=JSON.parse(localStorage.getItem(key)||'[]'); return Array.isArray(value)?value:[]; } catch { return []; } }

const DEFAULT_HOME_SHORTCUTS = [
  { name: 'Google', url: 'https://www.google.com' },
  { name: 'YouTube', url: 'https://www.youtube.com' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'Gmail', url: 'https://mail.google.com' },
  { name: 'ChatGPT', url: 'https://chatgpt.com' }
];

function normalizeShortcutUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function loadHomeShortcuts() {
  const saved = localStorage.getItem('mantra-home-shortcuts');
  if (saved === null) return DEFAULT_HOME_SHORTCUTS.map((item) => ({ ...item }));
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return DEFAULT_HOME_SHORTCUTS.map((item) => ({ ...item }));
    return parsed.map((item) => ({ name: String(item.name || '').trim().slice(0, 32), url: normalizeShortcutUrl(item.url) }))
      .filter((item) => item.name && item.url).slice(0, 24);
  } catch { return DEFAULT_HOME_SHORTCUTS.map((item) => ({ ...item })); }
}

let homeShortcuts = loadHomeShortcuts();

function getFaviconCandidates(url, preferred = '') {
  try {
    const pageUrl = new URL(url);
    if (!['http:', 'https:'].includes(pageUrl.protocol)) return preferred ? [preferred] : [];
    return [...new Set([
      preferred,
      new URL('/favicon.ico', pageUrl.origin).href,
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(pageUrl.hostname)}&sz=64`
    ].filter(Boolean))];
  } catch { return preferred ? [preferred] : []; }
}

function getLearnedFavicon(url) {
  try {
    const origin = new URL(url).origin;
    const candidates = [
      ...historyItems.map((item) => ({ url: item.url, favicon: item.favicon })),
      ...tabs.map((tab) => ({ url: tab.url, favicon: tab.favicon }))
    ];
    return candidates.find((item) => {
      if (!item.favicon) return false;
      try { return new URL(item.url).origin === origin; } catch { return false; }
    })?.favicon || '';
  } catch { return ''; }
}

function bindFaviconFallbacks(root, selector, onExhausted) {
  root.querySelectorAll(selector).forEach((image) => {
    let fallbacks = JSON.parse(image.dataset.fallbacks || '[]');
    image.addEventListener('error', () => {
      if (fallbacks.length) { image.src = fallbacks.shift(); return; }
      onExhausted(image);
    });
  });
}

function saveHomeShortcuts() {
  localStorage.setItem('mantra-home-shortcuts', JSON.stringify(homeShortcuts));
  renderHomeShortcuts();
}

function renderHomeShortcuts() {
  const host = $('favorites');
  host.innerHTML = homeShortcuts.map((item, index) => {
    const favicons = getFaviconCandidates(item.url, getLearnedFavicon(item.url));
    const favicon = favicons.shift() || 'data:,';
    return `<div class="favorite-card" data-shortcut-card="${index}">
      <button class="favorite-open" type="button" data-shortcut-open="${index}" title="Open ${escapeAttr(item.name)}" aria-label="Open ${escapeAttr(item.name)}"><img class="favorite-icon" src="${escapeAttr(favicon)}" data-fallbacks="${escapeAttr(JSON.stringify(favicons))}" alt=""><span>${escapeHtml(item.name)}</span></button>
      <button class="favorite-menu-toggle" type="button" data-shortcut-menu="${index}" aria-label="Options for ${escapeAttr(item.name)}" aria-expanded="false" title="Shortcut options">⋮</button>
      <div class="shortcut-menu" data-shortcut-menu-content="${index}" role="menu" hidden><button type="button" role="menuitem" data-shortcut-edit="${index}">Edit shortcut</button><button type="button" role="menuitem" data-shortcut-remove="${index}">Remove shortcut</button></div>
    </div>`;
  }).join('') + `<div class="favorite-card add-favorite-card"><button id="add-favorite" class="favorite-open" type="button" aria-label="Add a shortcut"><span class="favorite-icon add">+</span><span>Add</span></button></div>`;

  bindFaviconFallbacks(host, '.favorite-icon[src]', (image) => {
    image.replaceWith(Object.assign(document.createElement('span'), { className: 'favorite-icon favorite-fallback', textContent: '✦', ariaHidden: 'true' }));
  });
}

let shortcutEditIndex = null;

function openShortcutEditor(index = null) {
  if (index === null && homeShortcuts.length >= 24) { toast('You can save up to 24 shortcuts'); return; }
  const item = index === null ? { name: '', url: '' } : homeShortcuts[index];
  if (!item) return;
  $('favorites').querySelectorAll('.shortcut-menu').forEach((menu) => { menu.hidden = true; });
  $('favorites').querySelectorAll('.favorite-menu-toggle').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  shortcutEditIndex = index;
  $('shortcut-editor-title').textContent = index === null ? 'Add a shortcut' : 'Edit shortcut';
  $('shortcut-name').value = item.name;
  $('shortcut-url').value = item.url;
  $('shortcut-error').textContent = '';
  $('shortcut-editor').hidden = false;
  $('shortcut-name').focus();
  $('shortcut-name').select();
}

function closeShortcutEditor() {
  $('shortcut-editor').hidden = true;
  shortcutEditIndex = null;
}

function saveShortcutEditor(event) {
  event.preventDefault();
  const name = $('shortcut-name').value.trim().slice(0, 32);
  const url = normalizeShortcutUrl($('shortcut-url').value);
  const error = $('shortcut-error');
  if (!name) { error.textContent = 'Enter a name for this shortcut.'; $('shortcut-name').focus(); return; }
  if (!url) { error.textContent = 'Enter a valid website address, such as example.com.'; $('shortcut-url').focus(); return; }
  const duplicateIndex = homeShortcuts.findIndex((item, index) => index !== shortcutEditIndex && item.url === url);
  if (duplicateIndex !== -1) { error.textContent = 'This website is already in your shortcuts.'; $('shortcut-url').focus(); return; }

  const shortcut = { name, url };
  if (shortcutEditIndex === null) homeShortcuts.push(shortcut);
  else homeShortcuts[shortcutEditIndex] = shortcut;
  saveHomeShortcuts();
  closeShortcutEditor();
}

function renderTabs() {
  const strip = $('tab-strip');
  strip.classList.toggle('empty', tabs.length === 0);
  strip.innerHTML = tabs.map((tab) => {
    let fallback = '✦';
    try { if (tab.url) fallback = new URL(tab.url).hostname.replace(/^www\./i, '').charAt(0).toUpperCase() || fallback; } catch {}
    const isMantraAITab = tab.home || /mantraai/i.test(tab.title || '') || /^file:/i.test(tab.url || '');
    const favicons = isMantraAITab ? [] : getFaviconCandidates(tab.url, tab.favicon);
    const favicon = favicons.shift();
    const icon = isMantraAITab
      ? '<img src="assets/mantraai-logo-transparent.png" alt="">'
      : `<span class="tab-favicon-fallback"${favicon ? ' hidden' : ''} aria-hidden="true">${escapeHtml(fallback)}</span>${favicon ? `<img class="tab-site-icon" src="${escapeAttr(favicon)}" data-fallbacks="${escapeAttr(JSON.stringify(favicons))}" alt="" aria-hidden="true">` : ''}`;
    return `<div class="tab${tab.id === activeTabId ? ' active' : ''}" data-tab-id="${tab.id}" title="${escapeAttr(tab.title)}"><span class="tab-favicon">${icon}</span><span class="tab-title">${escapeHtml(tab.title || 'New Tab')}</span><button class="tab-close" data-close-tab="${tab.id}" aria-label="Close tab">×</button></div>`;
  }).join('');
  bindFaviconFallbacks(strip, '.tab-site-icon', (image) => {
    image.hidden = true;
    image.parentElement.querySelector('.tab-favicon-fallback').hidden = false;
  });
  strip.querySelectorAll('.tab[data-tab-id]').forEach((button) => button.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-tab]')) return;
    api.selectTab(Number(button.dataset.tabId));
  }));
  strip.querySelectorAll('[data-close-tab]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation(); api.closeTab(Number(button.dataset.closeTab));
  }));
}

function setPanel(open) {
  panelOpen = open;
  panel.classList.toggle('closed', !open);
  document.body.classList.toggle('panel-closed', !open);
  home.classList.toggle('panel-open', open);
  defaultHome.classList.toggle('panel-open', open);
  $('panel-toggle').setAttribute('aria-expanded', String(open));
  $('panel-toggle').title = open ? 'Close Sidebar' : 'Open Sidebar';
  api.setPanelOpen(open);
}

function applyTheme(value) {
  const theme = value === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('light-theme', theme === 'light');
  document.body.classList.toggle('native-window-controls', api.platform === 'win32');
  localStorage.setItem('mantra-theme', theme);
  api.setWindowTheme(theme);

  const selector = contentView.querySelector('#theme-select');
  if (selector && selector.value !== theme) selector.value = theme;

  const toggle = $('theme-toggle');
  if (toggle) {
    const label = theme === 'dark' ? 'Light Theme' : 'Dark Theme';
    toggle.querySelector('use')?.setAttribute('href', theme === 'dark' ? '#icon-sun' : '#icon-moon');
    $('theme-toggle-label').textContent = label;
    toggle.setAttribute('aria-label', `Switch to ${label}`);
    toggle.setAttribute('title', `Switch to ${label}`);
    toggle.setAttribute('aria-pressed', String(theme === 'light'));
  }
}

function showHome() {
  home.hidden = false;
  defaultHome.hidden = true;
  $('panel-view-back').disabled = true;
  home.scrollTo({top:0,behavior:'smooth'});
  $('panel-content').scrollTo({top:0});
  contentView.scrollTo({top:0});
  api.showHome();
  selectSideItem('home');
  contentView.hidden = true;
  quickPanel.hidden = false;
}

function selectSideItem(name) {
  document.querySelectorAll('.side-item[data-panel]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.panel === name);
  });
}

function updateContent(name) {
  if (name === 'home') { showHome(); return; }
  $('panel-view-back').disabled = false;
  $('panel-content').scrollTo({top:0});
  contentView.scrollTo({top:0});
  home.hidden = false;
  defaultHome.hidden = true;
  selectSideItem(name);
  quickPanel.hidden = true;
  contentView.hidden = false;
  contentView.dataset.panel = name;
  const titles = {chat:'MantraAI Chat',openTabs:'Open Tabs',bookmarks:'Bookmarks',history:'History',downloads:'Downloads',extensions:'Extensions',settings:'Settings',notes:'Notes',reading:'Reading List'};
  const title = titles[name] || 'MantraAI';
  let body = '';
  if (['openTabs','bookmarks','history','downloads','reading','extensions'].includes(name)) {
    body = `<input class="collection-search" type="search" placeholder="Search ${titles[name].toLowerCase()}" aria-label="Search ${titles[name]}"><div class="collection-actions">${name === 'openTabs' ? '<button class="content-row" data-group-create>Create tab group</button>' : ''}${name === 'bookmarks' ? '<button class="content-row" data-bookmark-add>Bookmark current page</button><button class="content-row" data-bookmark-import>Import bookmarks</button><button class="content-row" data-bookmark-export>Export bookmarks</button>' : ''}${name === 'history' ? '<button class="content-row" data-history-clear>Clear browsing data</button>' : ''}${name === 'reading' ? '<button class="content-row" data-reading-add>Save current page</button>' : ''}${name === 'extensions' ? '<button class="content-row" data-extension-add>Load unpacked extension</button><button class="content-row" data-extension-store>Open Chrome Web Store</button><small>Electron supports only a subset of Chrome extension APIs; some extensions may not work.</small>' : ''}</div><div class="collection-list"></div>`;
  } else if (name === 'settings') {
    body = `<input id="settings-search" type="search" placeholder="Search settings" aria-label="Search settings"><div class="settings-group"><div class="settings-account"><strong>Account</strong><div id="settings-account-state"></div><button id="settings-auth-action" class="content-row" type="button">Sign in or add an account</button></div></div><div class="settings-group"><label for="theme-select">Appearance</label><select id="theme-select"><option value="dark">Midnight Saffron</option><option value="light">Light</option></select><label for="homepage-input">Homepage</label><input id="homepage-input" value="${escapeAttr(localStorage.getItem('mantra-homepage') || 'https://www.google.com')}"><label for="wallpaper-select">New tab wallpaper</label><select id="wallpaper-select"><option value="default">Midnight Sunrise · Default</option><option value="dusk">Saffron Dusk</option><option value="blue">Blue Hour</option><option value="custom">Your image…</option></select><button class="content-row" id="choose-wallpaper">Choose an image from this device</button><label class="setting-check"><input type="checkbox" id="wallpaper-rotate"> Random wallpaper every 30 minutes</label><p id="wallpaper-message"></p></div><div class="settings-group"><label for="search-engine">Default search engine</label><select id="search-engine"><option value="google">Google</option><option value="bing">Bing</option><option value="duckduckgo">DuckDuckGo</option><option value="custom">Custom URL template</option></select><input id="search-template" placeholder="https://example.com/search?q={searchTerms}"><button id="clear-site-data" class="content-row">Clear cookies, cache &amp; site data</button></div><button class="save-action" id="save-settings">Save settings</button><p id="settings-message"></p><button id="settings-logout" class="settings-logout" type="button" hidden>Log out</button>`;
  } else if (name === 'notes') {
    body = `<div class="notes-actions"><input id="notes-search" type="search" placeholder="Search notes"><button id="notes-new" class="content-row">New note</button></div><div id="notes-list"></div><div class="notes-editor"><input id="notes-title" placeholder="Note title"><textarea id="notes-text" rows="10" placeholder="Write a note..."></textarea><button id="notes-delete" class="content-row">Delete note</button><small id="notes-save-state">Saved automatically</small></div>`;
  } else {
    body = '<div class="empty">MantraAI Chat needs an AI service configuration. Web Search is available without an account and uses your selected search engine.</div>';
  }
  contentView.innerHTML = `<h2>${title}</h2>${['settings','notes'].includes(name) ? '' : `<p>${name==='openTabs'?'Switch between your open pages and organize tabs into local groups.':name==='extensions'?'Manage unpacked extensions supported by this Electron build.':'Search and manage your saved browser data.'}</p>`}${body}`;
  if (['openTabs','bookmarks','history','downloads','reading','extensions'].includes(name)) renderCollection(name, '');
  if (!['openTabs','bookmarks','history','downloads','reading','extensions'].includes(name)) contentView.querySelectorAll('[data-open-url]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.openUrl)));
  if (name === 'settings') {
    updateSettingsAuth();
    contentView.querySelector('#settings-auth-action').addEventListener('click', openAuth);
    contentView.querySelector('#settings-logout').addEventListener('click', async () => {
      try { await api.auth.logout(); toast('You have been logged out'); }
      catch { toast('Could not log out. Please try again.'); }
    });
    const theme = contentView.querySelector('#theme-select');
    theme.value = localStorage.getItem('mantra-theme') || 'dark';
    theme.addEventListener('change', () => applyTheme(theme.value));
    const wallpaper = contentView.querySelector('#wallpaper-select');
    wallpaper.value = localStorage.getItem('mantra-wallpaper') || 'default';
    contentView.querySelector('#wallpaper-rotate').checked = localStorage.getItem('mantra-rotate-wallpaper') === 'true';
    contentView.querySelector('#choose-wallpaper').addEventListener('click', chooseWallpaper);
    wallpaper.addEventListener('change', () => {
      if (wallpaper.value === 'custom' && !localStorage.getItem('mantra-custom-wallpaper')) { chooseWallpaper(); return; }
      applyWallpaper(wallpaper.value);
    });
    contentView.querySelector('#wallpaper-rotate').addEventListener('change', (event) => {
      localStorage.setItem('mantra-rotate-wallpaper', String(event.target.checked));
      configureWallpaperRotation();
    });
    const searchEngine=contentView.querySelector('#search-engine');
    searchEngine.value=localStorage.getItem('mantra-search-engine')||'google';
    const searchTemplate=contentView.querySelector('#search-template');
    searchTemplate.value=localStorage.getItem('mantra-search-template')||'';
    searchTemplate.hidden=searchEngine.value!=='custom';
    searchEngine.addEventListener('change',()=>{searchTemplate.hidden=searchEngine.value!=='custom';});
    contentView.querySelector('#clear-site-data').addEventListener('click',async()=>{if(!confirm('Clear cookies, cache, and website storage for regular browsing?'))return;try{await api.clearSiteData();historyItems=[];saveCollection('mantra-history',historyItems);toast('Browsing data cleared');}catch(error){toast(error.message||'Could not clear browsing data');}});
    contentView.querySelector('#settings-search').addEventListener('input',(event)=>{const query=event.target.value.toLowerCase();contentView.querySelectorAll('.settings-group').forEach((group)=>{group.hidden=query&&!group.textContent.toLowerCase().includes(query);});});
    contentView.querySelector('#save-settings').addEventListener('click', () => {
      const value = contentView.querySelector('#homepage-input').value.trim();
      try { const url = new URL(value); if (!['http:','https:'].includes(url.protocol)) throw new Error(); if(searchEngine.value==='custom'&&!searchTemplate.value.includes('{searchTerms}'))throw new Error('Custom search template must include {searchTerms}.'); if(searchEngine.value==='custom'){const template=searchTemplate.value.replace('{searchTerms}','test');const parsed=new URL(template);if(!['https:','http:'].includes(parsed.protocol))throw new Error('Use an HTTP or HTTPS search template.');} localStorage.setItem('mantra-homepage', url.href);localStorage.setItem('mantra-search-engine',searchEngine.value);localStorage.setItem('mantra-search-template',searchTemplate.value.trim()); contentView.querySelector('#settings-message').textContent = 'Settings saved.'; }
      catch(error) { contentView.querySelector('#settings-message').textContent = error.message||'Enter a valid HTTP or HTTPS website URL.'; }
    });
  }
  if (['openTabs','bookmarks','history','downloads','reading','extensions'].includes(name)) bindCollection(name);
  if (name === 'notes') {
    const save = () => { const item=notesItems.find((note)=>note.id===activeNoteId);if(item){item.title=contentView.querySelector('#notes-title').value;item.body=contentView.querySelector('#notes-text').value;item.time=Date.now();saveCollection('mantra-notes-list',notesItems);localStorage.setItem('mantra-notes-title',item.title);localStorage.setItem('mantra-notes',item.body);contentView.querySelector('#notes-save-state').textContent='Saved';renderNotes(contentView.querySelector('#notes-search').value);} };
    contentView.querySelector('#notes-title').addEventListener('input', save);
    contentView.querySelector('#notes-text').addEventListener('input', save);
    contentView.querySelector('#notes-search').addEventListener('input',(event)=>renderNotes(event.target.value));
    contentView.querySelector('#notes-new').addEventListener('click',()=>{const item={id:cryptoRandomId(),title:'',body:'',time:Date.now()};notesItems.unshift(item);activeNoteId=item.id;saveCollection('mantra-notes-list',notesItems);renderNotes('');});
    contentView.querySelector('#notes-delete').addEventListener('click',()=>{notesItems=notesItems.filter((note)=>note.id!==activeNoteId);activeNoteId=notesItems[0]?.id||null;saveCollection('mantra-notes-list',notesItems);renderNotes(contentView.querySelector('#notes-search').value);});
    renderNotes('');
  }
}

function renderNotes(query='') {
  const list=contentView.querySelector('#notes-list');if(!list)return;const q=query.toLowerCase();const visible=notesItems.filter((note)=>`${note.title} ${note.body}`.toLowerCase().includes(q));
  list.innerHTML=visible.length?visible.map((note)=>`<button class="content-row note-row ${note.id===activeNoteId?'note-active':''}" data-note-id="${escapeAttr(note.id)}">${escapeHtml(note.title||'Untitled note')}<small>${escapeHtml(note.body.slice(0,90))}</small></button>`).join(''):'<div class="empty">No notes yet. Create a note to get started.</div>';
  const active=notesItems.find((note)=>note.id===activeNoteId);const editor=contentView.querySelector('.notes-editor');if(editor)editor.hidden=!active;
  if(active){const titleInput=contentView.querySelector('#notes-title');const bodyInput=contentView.querySelector('#notes-text');if(titleInput.value!==active.title)titleInput.value=active.title;if(bodyInput.value!==active.body)bodyInput.value=active.body;}
  list.querySelectorAll('[data-note-id]').forEach((button)=>button.addEventListener('click',()=>{activeNoteId=button.dataset.noteId;renderNotes(contentView.querySelector('#notes-search').value);}));
}

function renderCollection(name, query) {
  const host = contentView.querySelector('.collection-list'); if (!host) return;
  const q = query.trim().toLowerCase();
  let items = [];
  if (name === 'openTabs') items = tabs.map((tab)=>({...tab, group:tabGroups.find((group)=>group.tabs.includes(tab.id))?.name||''})).filter((item)=>!item.verseHome);
  if (name === 'bookmarks') items = bookmarks;
  if (name === 'history') items = historyItems;
  if (name === 'downloads') items = downloads;
  if (name === 'reading') items = readingItems;
  if (name === 'extensions') { api.extensions('list').then((list)=>{ if(contentView.dataset.panel==='extensions') renderExtensionRows(list,q); }).catch((error)=>{host.innerHTML=`<div class="empty">Could not load extensions: ${escapeHtml(error.message)}</div>`;}); return; }
  items = items.filter((item)=>`${item.title||item.name||''} ${item.url||item.path||''} ${item.group||''} ${item.state||''}`.toLowerCase().includes(q));
  if (!items.length) { host.innerHTML=`<div class="empty">${q?'No matching items.':({openTabs:'No open tabs.',bookmarks:'Your saved pages will appear here.',history:'Pages you visit will appear here.',downloads:'Your downloads will appear here.',reading:'Save a page to your reading list to find it here.'}[name])}</div>`; return; }
  host.innerHTML = items.map((item)=>{
    if(name==='openTabs') return `<div class="collection-entry ${item.id===activeTabId?'entry-active':''}"><button class="entry-open" data-tab-open="${item.id}">${item.id===activeTabId?'●':'○'} ${escapeHtml(item.title||'New Tab')}<small>${escapeHtml(item.url||'New Tab')}${item.group?` · ${escapeHtml(item.group)}`:''}</small></button><select data-tab-group="${item.id}" aria-label="Tab group"><option value="">No group</option>${tabGroups.map((g)=>`<option value="${escapeAttr(g.id)}" ${g.tabs.includes(item.id)?'selected':''}>${escapeHtml(g.name)}</option>`).join('')}</select><button data-tab-close="${item.id}" aria-label="Close tab">×</button></div>`;
    if(name==='bookmarks') return `<div class="collection-entry"><button class="entry-open" data-open-url="${escapeAttr(item.url)}">☆ ${escapeHtml(item.title||item.url)}<small>${escapeHtml(item.url)}</small></button><button data-bookmark-edit="${escapeAttr(item.url)}">Edit</button><button data-bookmark-delete="${escapeAttr(item.url)}">×</button></div>`;
    if(name==='history') {
      let hostName = '';
      try {
        const pageUrl = new URL(item.url);
        hostName = pageUrl.hostname.replace(/^www\./i,'');
      }
      catch { hostName = item.url || ''; }
      const isMantraAIPage = /mantraai/i.test(item.title || '') || /^file:/i.test(item.url || '');
      const iconCandidates = isMantraAIPage ? ['assets/mantraai-logo-transparent.png'] : getFaviconCandidates(item.url, item.favicon);
      const iconUrl = iconCandidates.shift() || 'data:,';
      const initial = (hostName[0] || '?').toUpperCase();
      const siteName = historySiteName(hostName,item.title);
      return `<div class="collection-entry history-entry"><button class="entry-open history-open" data-open-url="${escapeAttr(item.url)}" aria-label="Open ${escapeAttr(siteName)}"><span class="history-site-icon"><img src="${escapeAttr(iconUrl)}" data-fallbacks="${escapeAttr(JSON.stringify(iconCandidates))}" alt="" loading="lazy"><span hidden>${escapeHtml(initial)}</span></span><span class="history-entry-body"><strong class="history-entry-title">${escapeHtml(siteName)}</strong><small class="history-entry-meta">${new Date(item.time||Date.now()).toLocaleString()}</small></span></button><button data-history-delete="${escapeAttr(item.url)}" aria-label="Remove history item">×</button></div>`;
    }
    if(name==='downloads') { const percent=item.total?Math.min(100,Math.round(item.received/item.total*100)):0; return `<div class="collection-entry"><div class="entry-label">↓ ${escapeHtml(item.name)}<small>${escapeHtml(item.state)} · ${formatBytes(item.received)} / ${item.total?formatBytes(item.total):'Unknown size'} ${item.total&&['In progress','Paused'].includes(item.state)?`· ${percent}%`:''}<br>${escapeHtml(item.path||'')}</small></div>${['In progress','Paused'].includes(item.state)?`<button data-download="${item.id}" data-download-action="${item.paused?'resume':'pause'}">${item.paused?'Resume':'Pause'}</button><button data-download="${item.id}" data-download-action="cancel">Cancel</button>`:''}${item.state==='Interrupted'&&item.canResume?`<button data-download="${item.id}" data-download-action="resume">Resume</button>`:''}${item.state==='Complete'?`<button data-download="${item.id}" data-download-action="open">Open</button><button data-download="${item.id}" data-download-action="reveal">Show</button>`:''}</div>`; }
    return `<div class="collection-entry"><button class="entry-open" data-open-url="${escapeAttr(item.url)}">${item.read?'✓':'◉'} ${escapeHtml(item.title||item.url)}<small>${escapeHtml(item.url)}</small></button><button data-reading-toggle="${escapeAttr(item.url)}">${item.read?'Unread':'Read'}</button><button data-reading-delete="${escapeAttr(item.url)}">×</button></div>`;
  }).join('');
  if (name === 'history') host.querySelectorAll('.history-site-icon img').forEach((img)=>{
    let fallbacks = JSON.parse(img.dataset.fallbacks || '[]');
    img.addEventListener('error',()=>{
      if (fallbacks.length) { img.src = fallbacks.shift(); return; }
      img.hidden=true;
      img.nextElementSibling.hidden=false;
    });
  });
}
function formatBytes(bytes) { if(!Number(bytes))return '0 B'; const units=['B','KB','MB','GB']; const unit=Math.min(Math.floor(Math.log(bytes)/Math.log(1024)),units.length-1); return `${(bytes/1024**unit).toFixed(unit?1:0)} ${units[unit]}`; }
function historySiteName(hostName, pageTitle) {
  const host = String(hostName || '').toLowerCase();
  if (host === 'mail.google.com') return 'Gmail';
  if (host.endsWith('google.com')) return 'Google';
  if (host === 'youtube.com' || host === 'youtu.be') return 'YouTube';
  const known = {'takeuforward.org':'takeUforward','github.com':'GitHub','chatgpt.com':'ChatGPT','openai.com':'OpenAI','stackoverflow.com':'Stack Overflow','reddit.com':'Reddit','wikipedia.org':'Wikipedia','microsoft.com':'Microsoft','outlook.com':'Outlook','amazon.com':'Amazon','facebook.com':'Facebook','instagram.com':'Instagram','linkedin.com':'LinkedIn'};
  if (known[host]) return known[host];
  if (pageTitle && !/^https?:\/\//i.test(pageTitle)) return String(pageTitle).trim();
  return hostName || pageTitle || 'Website';
}
function saveCollection(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function bindCollection(name) {
  const search=contentView.querySelector('.collection-search'); let searchTimer=null; search?.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>renderCollection(name,search.value),100);});
  const actionHost=contentView.querySelector('.collection-actions');
  const listHost=contentView.querySelector('.collection-list');
  const handleClick=async (event)=>{
    const button=event.target.closest('button'); if(!button)return;
    const run=async (fn)=>{try{await fn();renderCollection(name,search?.value||'');}catch(error){toast(error.message||'Action failed');}};
    if(button.hasAttribute('data-open-url')) navigate(button.dataset.openUrl);
    else if(button.hasAttribute('data-tab-open')) api.selectTab(Number(button.dataset.tabOpen));
    else if(button.hasAttribute('data-tab-close')) api.closeTab(Number(button.dataset.tabClose));
    else if(button.hasAttribute('data-group-create')) { const groupName=prompt('Tab group name'); if(groupName?.trim()){tabGroups.push({id:cryptoRandomId(),name:groupName.trim(),tabs:[]});saveCollection('mantra-tab-groups',tabGroups);renderCollection(name,search?.value||'');} }
    else if(button.hasAttribute('data-bookmark-add')) toggleBookmark();
    else if(button.hasAttribute('data-bookmark-delete')) { bookmarks=bookmarks.filter((item)=>item.url!==button.dataset.bookmarkDelete);saveCollection('mantra-bookmarks',bookmarks);renderCollection(name,search?.value||''); }
    else if(button.hasAttribute('data-bookmark-edit')) { const item=bookmarks.find((entry)=>entry.url===button.dataset.bookmarkEdit); if(item){const title=prompt('Bookmark title',item.title);if(title===null)return;const url=prompt('Bookmark URL',item.url);if(url===null)return;try{const parsed=new URL(url.trim());if(!['http:','https:'].includes(parsed.protocol))throw new Error();item.title=title.trim()||parsed.href;item.url=parsed.href;saveCollection('mantra-bookmarks',bookmarks);renderCollection(name,search?.value||'');}catch{toast('Enter a valid HTTP or HTTPS URL');}} }
    else if(button.hasAttribute('data-bookmark-import')) await run(async()=>{const imported=await api.bookmarkFile('import');if(imported){const seen=new Set(bookmarks.map((entry)=>entry.url));bookmarks=[...imported.filter((entry)=>!seen.has(entry.url)),...bookmarks];saveCollection('mantra-bookmarks',bookmarks);}});
    else if(button.hasAttribute('data-bookmark-export')) await run(async()=>{await api.bookmarkFile('export',bookmarks);});
    else if(button.hasAttribute('data-history-delete')) { historyItems=historyItems.filter((item)=>item.url!==button.dataset.historyDelete);saveCollection('mantra-history',historyItems);renderCollection(name,search?.value||''); }
    else if(button.hasAttribute('data-history-clear')) await run(async()=>{if(confirm('Clear saved history, cookies, cache, and site storage for regular browsing?')){historyItems=[];saveCollection('mantra-history',historyItems);await api.clearSiteData();}});
    else if(button.hasAttribute('data-reading-add')) {if(activeUrl&&!readingItems.some((item)=>item.url===activeUrl)){readingItems.unshift({url:activeUrl,title:activeTitle||activeUrl,time:Date.now(),read:false});saveCollection('mantra-reading-list',readingItems);renderCollection(name,search?.value||'');}}
    else if(button.hasAttribute('data-reading-toggle')) {const item=readingItems.find((entry)=>entry.url===button.dataset.readingToggle);if(item){item.read=!item.read;saveCollection('mantra-reading-list',readingItems);renderCollection(name,search?.value||'');}}
    else if(button.hasAttribute('data-reading-delete')) {readingItems=readingItems.filter((item)=>item.url!==button.dataset.readingDelete);saveCollection('mantra-reading-list',readingItems);renderCollection(name,search?.value||'');}
    else if(button.hasAttribute('data-download')) await run(()=>api.downloadAction(button.dataset.download,button.dataset.downloadAction));
    else if(button.hasAttribute('data-extension-add')) await run(async()=>{const ext=await api.extensions('add');if(ext)toast(`Loaded ${ext.name}; compatibility depends on Electron-supported APIs.`);});
    else if(button.hasAttribute('data-extension-store')) api.navigate('https://chromewebstore.google.com/');
    else if(button.hasAttribute('data-extension-remove')) await run(()=>api.extensions('remove',button.dataset.extensionRemove));
  };
  actionHost?.addEventListener('click',handleClick);
  listHost?.addEventListener('click',handleClick);
  listHost?.addEventListener('change',(event)=>{const select=event.target.closest('[data-tab-group]');if(!select)return;const id=Number(select.dataset.tabGroup);tabGroups.forEach((group)=>group.tabs=group.tabs.filter((tabId)=>tabId!==id));if(select.value)tabGroups.find((group)=>group.id===select.value)?.tabs.push(id);saveCollection('mantra-tab-groups',tabGroups);renderCollection(name,search?.value||'');});
}
function cryptoRandomId(){return `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;}
function renderExtensionRows(list,query){const host=contentView.querySelector('.collection-list');if(!host)return;const rows=list.filter((item)=>`${item.name} ${item.description} ${item.version}`.toLowerCase().includes(query));host.innerHTML=rows.length?rows.map((item)=>`<div class="collection-entry"><div class="entry-label">${escapeHtml(item.name)}<small>Version ${escapeHtml(item.version)} · ${escapeHtml(item.description||'Unpacked extension')}</small></div><button data-extension-remove="${escapeAttr(item.id)}">Remove</button></div>`).join(''):'<div class="empty">No compatible extensions loaded.</div>';}

function applyWallpaper(name) {
  const wallpaper = name === 'custom' ? localStorage.getItem('mantra-custom-wallpaper') : WALLPAPERS[name];
  if (!wallpaper) return;
  home.style.backgroundImage = `url("${wallpaper}")`;
  defaultHome.style.backgroundImage = `url("${wallpaper}")`;
  localStorage.setItem('mantra-wallpaper', name);
  const select = contentView.querySelector('#wallpaper-select');
  if (select) select.value = name;
}

async function chooseWallpaper() {
  const wallpaper = await api.chooseWallpaper();
  if (!wallpaper) return;
  localStorage.setItem('mantra-custom-wallpaper', wallpaper);
  applyWallpaper('custom');
  const message = contentView.querySelector('#wallpaper-message');
  if (message) message.textContent = 'Your wallpaper is now active.';
}

function configureWallpaperRotation() {
  if (rotationTimer) clearInterval(rotationTimer);
  rotationTimer = null;
  if (localStorage.getItem('mantra-rotate-wallpaper') !== 'true') return;
  rotationTimer = setInterval(() => {
    const options = Object.keys(WALLPAPERS);
    if (localStorage.getItem('mantra-custom-wallpaper')) options.push('custom');
    const current = localStorage.getItem('mantra-wallpaper') || 'default';
    const choices = options.filter((option) => option !== current);
    applyWallpaper(choices[Math.floor(Math.random() * choices.length)] || 'default');
  }, 30 * 60 * 1000);
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function escapeAttr(value) { return escapeHtml(value); }
function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div'); node.className = 'toast'; node.textContent = message; document.body.appendChild(node);
  setTimeout(() => node.remove(), 2300);
}
function showAuthMessage(message, success = false) {
  const status = $('auth-message');
  status.textContent = message || '';
  status.classList.toggle('success', success);
}
function authErrorText(error) {
  return String(error?.message || 'Authentication failed. Please try again.')
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '');
}
function updateSettingsAuth() {
  if (contentView.dataset.panel !== 'settings') return;
  const state = contentView.querySelector('#settings-account-state');
  const signIn = contentView.querySelector('#settings-auth-action');
  const logout = contentView.querySelector('#settings-logout');
  if (!state || !signIn || !logout) return;
  state.innerHTML = authUser
    ? `<span class="account-status">Signed in</span><strong>${escapeHtml(authUser.displayName || authUser.email || 'MantraAI account')}</strong>${authUser.displayName && authUser.email ? `<small>${escapeHtml(authUser.email)}</small>` : ''}`
    : '<span class="account-status signed-out">Not signed in</span><small>Sign in is optional. Browsing works without an account.</small>';
  signIn.hidden = Boolean(authUser);
  logout.hidden = !authUser;
}
function updateSidebarAccount() {
  $('sidebar-account-card').hidden = Boolean(authUser);
}
function renderAuth(user) {
  authUser = user || null;
  $('auth-form-view').hidden = Boolean(authUser);
  const signedIn = $('auth-signed-in');
  signedIn.hidden = !authUser;
  signedIn.innerHTML = authUser ? `<strong>${escapeHtml(authUser.displayName || 'Signed in')}</strong><span>${escapeHtml(authUser.email || '')}</span>` : '';
  const greeting = $('account-greeting');
  const avatarImage = $('account-avatar-image');
  const avatarInitial = $('account-avatar-initial');
  greeting.hidden = !authUser;
  if (authUser) {
    const name = String(authUser.displayName || authUser.email?.split('@')[0] || 'there').trim();
    $('account-greeting-name').textContent = name.split(/\s+/)[0] || 'there';
    avatarInitial.textContent = (name[0] || 'U').toLocaleUpperCase();
    const photoUrl = /^https:\/\//i.test(authUser.photoUrl || '') ? authUser.photoUrl : '';
    avatarImage.hidden = !photoUrl;
    avatarInitial.hidden = Boolean(photoUrl);
    if (photoUrl) avatarImage.src = photoUrl;
    else avatarImage.removeAttribute('src');
  }
  updateSettingsAuth();
  updateSidebarAccount();
}
function setAuthMode(mode) {
  authMode = mode;
  $('auth-form-actions').classList.toggle('signup-mode', mode === 'signup');
  $('auth-forgot-password').hidden = mode === 'signup';
  $('auth-title').textContent = mode === 'signup' ? 'Create your account' : 'Your browser, your account';
  $('email-submit').textContent = mode === 'signup' ? 'Create account' : 'Log in';
  $('auth-mode-toggle').textContent = mode === 'signup' ? 'Log in' : 'Create an account';
  $('auth-password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  showAuthMessage('');
}
function setAuthBusy(busy) {
  authBusy = busy;
  $('google-sign-in').disabled = busy;
  $('email-submit').disabled = busy;
  $('auth-mode-toggle').disabled = busy;
  $('auth-forgot-password').disabled = busy;
  $('auth-email').disabled = busy;
  $('auth-password').disabled = busy;
  $('email-submit').textContent = busy ? 'Please wait…' : (authMode === 'signup' ? 'Create account' : 'Log in');
}
function openAuth() {
  $('auth-modal').hidden = false;
  if (!authUser) setAuthMode('login');
  showAuthMessage(!authConfigured ? authConfigHint : '');
  if (!authUser) $('auth-email').focus();
}
function closeAuth() { $('auth-modal').hidden = true; }
async function performAuth(action) {
  if (authBusy) return;
  if (!authConfigured) { showAuthMessage(authConfigHint); return; }
  setAuthBusy(true);
  showAuthMessage('');
  try {
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    if (!email || !$('auth-email').checkValidity()) throw new Error('Enter a valid email address.');
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');
    const user = action === 'signup' ? await api.auth.signUp(email, password) : await api.auth.signIn(email, password);
    renderAuth(user);
    $('auth-password').value = '';
    showHome();
    closeAuth();
    toast(action === 'signup' ? 'Your account is ready' : 'Welcome back');
  } catch (error) { showAuthMessage(authErrorText(error)); }
  finally { setAuthBusy(false); }
}
async function performPasswordReset() {
  if (authBusy) return;
  if (!authConfigured) { showAuthMessage(authConfigHint); return; }
  const email = $('auth-email').value.trim();
  if (!email || !$('auth-email').checkValidity()) {
    showAuthMessage('Enter your email address first.');
    $('auth-email').focus();
    return;
  }
  setAuthBusy(true);
  showAuthMessage('');
  try {
    await api.auth.sendPasswordReset(email);
    showAuthMessage(`If an account exists for ${email}, a password reset email has been sent.`, true);
  } catch (error) {
    const message = authErrorText(error);
    if (/EMAIL_NOT_FOUND|No account was found/i.test(message)) showAuthMessage(`If an account exists for ${email}, a password reset email has been sent.`, true);
    else showAuthMessage(message);
  } finally { setAuthBusy(false); }
}
function navigate(value) {
  const address = String(value || '').trim();
  if (!address) return;
  activeUrl = address; $('address').value = address;
  home.hidden = true; defaultHome.hidden = true; contentView.hidden = true; quickPanel.hidden = false;
  api.navigate(address);
}
function runSearch(value) { if (!value?.trim()) return; const query=value.trim();const engine=localStorage.getItem('mantra-search-engine')||'google';const urls={google:'https://www.google.com/search?q={searchTerms}',bing:'https://www.bing.com/search?q={searchTerms}',duckduckgo:'https://duckduckgo.com/?q={searchTerms}'};const template=engine==='custom'?localStorage.getItem('mantra-search-template'):urls[engine];if(!template){toast('Set a valid search engine in Settings first');return;}navigate(template.replace('{searchTerms}',encodeURIComponent(query))); }
function toggleBookmark() {
  if (!activeUrl) { toast('Open a page to bookmark it'); return; }
  const found = bookmarks.findIndex((item) => item.url === activeUrl);
  if (found >= 0) { bookmarks.splice(found, 1); toast('Bookmark removed'); }
  else { bookmarks.unshift({url:activeUrl,title:activeUrl}); toast('Page bookmarked'); }
  localStorage.setItem('mantra-bookmarks', JSON.stringify(bookmarks));
  const saved = bookmarks.some((item) => item.url === activeUrl);
  $('bookmark-toggle').setAttribute('aria-pressed', String(saved));
  $('bookmark-toggle').title = saved ? 'Remove bookmark' : 'Bookmark this page';
  if(contentView.dataset.panel==='bookmarks')renderCollection('bookmarks',contentView.querySelector('.collection-search')?.value||'');
}
function openFindBar() {
  $('page-find').hidden = false;
  $('find-query').focus();
  $('find-query').select();
}
function runFind(forward = true) {
  const query = $('find-query').value;
  if (!query) { $('find-count').textContent = '0 / 0'; api.stopFind(); return; }
  const next = query === lastFindQuery;
  lastFindQuery = query;
  api.findInPage(query, forward, next);
}
function closeFindBar() {
  $('page-find').hidden = true;
  $('find-query').value = '';
  $('find-count').textContent = '0 / 0';
  lastFindQuery = '';
  api.stopFind();
}

renderHomeShortcuts();

$('address-form').addEventListener('submit', (event) => { event.preventDefault(); navigate($('address').value); });
$('back').addEventListener('click', () => api.back());
$('forward').addEventListener('click', () => api.forward());
$('reload').addEventListener('click', () => api.reload());
const homeSearch = $('home-search');
const homeQuery = $('home-query');
const homeSearchButton = $('home-search-submit');
const updateHomeSearchAction = () => {
  const hasQuery = Boolean(homeQuery.value.trim());
  homeSearch.classList.toggle('has-query', hasQuery);
  homeSearchButton.setAttribute('aria-label', 'Search with MantraAI Mode');
  homeSearchButton.title = 'Search with MantraAI Mode';
};
homeQuery.addEventListener('input', updateHomeSearchAction);
updateHomeSearchAction();
homeSearch.addEventListener('submit', (event) => { event.preventDefault(); runSearch(homeQuery.value); });
$('panel-toggle').addEventListener('click', () => setPanel(!panelOpen));
$('auth-close').addEventListener('click', closeAuth);
$('sidebar-auth-action').addEventListener('click', openAuth);
$('account-greeting').addEventListener('click', openAuth);
$('auth-modal').addEventListener('click', (event) => { if (event.target === $('auth-modal')) closeAuth(); });
$('auth-mode-toggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));
$('auth-forgot-password').addEventListener('click', performPasswordReset);
$('email-auth-form').addEventListener('submit', (event) => { event.preventDefault(); performAuth(authMode); });
$('google-sign-in').addEventListener('click', async () => {
  if (authBusy) return;
  if (!authConfigured) { showAuthMessage(authConfigHint); return; }
  if (!googleConfigured) { showAuthMessage(`Google sign-in is not configured. ${authConfigHint}`); return; }
  setAuthBusy(true); showAuthMessage('Complete Google sign-in in your browser…');
  try { const user = await api.auth.signInWithGoogle(); renderAuth(user); showHome(); closeAuth(); toast('Welcome to MantraAI Browser'); }
  catch (error) { showAuthMessage(authErrorText(error)); }
  finally { setAuthBusy(false); }
});
$('auth-modal').addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAuth(); });
$('panel-close').addEventListener('click', () => setPanel(false));
$('panel-view-back').addEventListener('click', showHome);
$('new-tab').addEventListener('click', () => api.newTab());
$('sidebar-new-tab').addEventListener('click', () => api.newTab());
document.querySelectorAll('[data-panel]').forEach((button) => button.addEventListener('click', () => { if (button.closest('.toolbar-tools')) setPanel(true); updateContent(button.dataset.panel); }));
document.querySelectorAll('.trending-grid button').forEach((button) => button.addEventListener('click', () => runSearch(button.textContent.replace('⌕','').trim())));
$('favorites').addEventListener('click', (event) => {
  const menuToggle = event.target.closest('[data-shortcut-menu]');
  if (menuToggle) {
    const index = menuToggle.dataset.shortcutMenu;
    const menu = $('favorites').querySelector(`[data-shortcut-menu-content="${index}"]`);
    const willOpen = menu.hidden;
    $('favorites').querySelectorAll('.shortcut-menu').forEach((item) => { item.hidden = true; });
    $('favorites').querySelectorAll('.favorite-menu-toggle').forEach((item) => item.setAttribute('aria-expanded', 'false'));
    menu.hidden = !willOpen;
    menuToggle.setAttribute('aria-expanded', String(willOpen));
    event.stopPropagation();
    return;
  }
  const edit = event.target.closest('[data-shortcut-edit]');
  if (edit) { openShortcutEditor(Number(edit.dataset.shortcutEdit)); return; }
  const remove = event.target.closest('[data-shortcut-remove]');
  if (remove) {
    homeShortcuts.splice(Number(remove.dataset.shortcutRemove), 1);
    saveHomeShortcuts();
    return;
  }
  const open = event.target.closest('[data-shortcut-open]');
  if (open) { const item = homeShortcuts[Number(open.dataset.shortcutOpen)]; if (item) navigate(item.url); return; }
  if (event.target.closest('#add-favorite')) openShortcutEditor();
});
$('shortcut-editor-form').addEventListener('submit', saveShortcutEditor);
$('shortcut-editor-close').addEventListener('click', closeShortcutEditor);
$('shortcut-editor-cancel').addEventListener('click', closeShortcutEditor);
$('shortcut-editor').addEventListener('click', (event) => { if (event.target === $('shortcut-editor')) closeShortcutEditor(); });
$('shortcut-editor').addEventListener('keydown', (event) => { if (event.key === 'Escape') closeShortcutEditor(); });
document.addEventListener('click', (event) => {
  if (event.target.closest('#favorites')) return;
  $('favorites').querySelectorAll('.shortcut-menu').forEach((item) => { item.hidden = true; });
  $('favorites').querySelectorAll('.favorite-menu-toggle').forEach((item) => item.setAttribute('aria-expanded', 'false'));
});
$('incognito-button').addEventListener('click', () => api.openIncognito());
$('desktop-button').addEventListener('click', () => { api.desktopSite(); toast('Desktop view enabled for the current page'); });
$('theme-toggle').addEventListener('click', () => applyTheme(document.body.classList.contains('light-theme') ? 'dark' : 'light'));
$('bookmark-toggle').addEventListener('click', toggleBookmark);
$('find-query').addEventListener('input', () => { lastFindQuery = ''; runFind(true); });
$('find-query').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); runFind(!event.shiftKey); } });
$('find-next').addEventListener('click', () => runFind(true));
$('find-prev').addEventListener('click', () => runFind(false));
$('find-close').addEventListener('click', closeFindBar);

api.onState((state) => {
  if (state.url !== undefined && !$('address').matches(':focus')) $('address').value = state.url;
  $('back').disabled = !state.canGoBack; $('forward').disabled = !state.canGoForward;
  if (state.url && state.url !== activeUrl) activeUrl = state.url;
  if (!state.url) activeUrl = '';
  activeTitle=state.title||state.url||'New Tab';
  if (state.home) {
    const showVerse = Boolean(state.verseHome);
    home.hidden = showVerse;
    defaultHome.hidden = !showVerse;
    quickPanel.hidden = false; contentView.hidden = true;
    selectSideItem('home');
  } else {
    home.hidden = true; defaultHome.hidden = true;
  }
  if (state.url && !['chrome://','devtools://'].some((prefix) => state.url.startsWith(prefix))) {
    const previous = historyItems.find((item) => item.url === state.url);
    historyItems = [{url:state.url,title:state.title||state.url,favicon:state.favicon||previous?.favicon||'',time:Date.now()}, ...historyItems.filter((item) => item.url !== state.url)].slice(0,500);
    localStorage.setItem('mantra-history', JSON.stringify(historyItems));
    if (!contentView.hidden && contentView.dataset.panel === 'history') renderCollection('history',contentView.querySelector('.collection-search')?.value||'');
  }
  const saved = bookmarks.some((item) => item.url === activeUrl);
  $('bookmark-toggle').setAttribute('aria-pressed', String(saved));
  $('bookmark-toggle').title = saved ? 'Remove bookmark' : 'Bookmark this page';
});
api.onTabs((state) => { tabs = state.tabs; activeTabId = state.activeId; renderTabs(); renderHomeShortcuts(); if(contentView.dataset.panel==='openTabs')renderCollection('openTabs',contentView.querySelector('.collection-search')?.value||''); });
api.onFindResult((result) => { $('find-count').textContent = result.matches ? `${result.activeMatchOrdinal} / ${result.matches}` : '0 / 0'; });
api.onShortcut((action) => {
  if (action === 'new-tab') api.newTab();
  else if (action === 'close-tab' && activeTabId !== null) api.closeTab(activeTabId);
  else if (action === 'reopen-tab') api.reopenTab();
  else if (action === 'incognito') api.openIncognito();
  else if (action === 'focus-address') { $('address').focus(); $('address').select(); }
  else if (action === 'find') openFindBar();
  else if (action === 'bookmark') toggleBookmark();
  else if (['history','downloads','settings'].includes(action)) { setPanel(true); updateContent(action); }
});
api.onDownloads((items) => { downloads = items; if (!contentView.hidden && contentView.dataset.panel === 'downloads') renderCollection('downloads',contentView.querySelector('.collection-search')?.value||''); });
api.getDownloads().then((items)=>{downloads=items;if(contentView.dataset.panel==='downloads')renderCollection('downloads',contentView.querySelector('.collection-search')?.value||'');}).catch(()=>{});
api.auth.onState(renderAuth);
api.auth.getState().then((state) => {
  authConfigured = state.configured;
  googleConfigured = state.googleConfigured;
  authConfigHint = state.configHint || authConfigHint;
  renderAuth(state.user);
}).catch(() => {
  renderAuth(null);
  showAuthMessage('Could not load account status. Restart MantraAI Browser and try again.');
});

document.querySelectorAll('.window-actions button').forEach((button,index) => button.addEventListener('click', () => api.windowAction(['minimize','maximize','close'][index])));
document.addEventListener('keydown', (event) => {
  if(event.key==='Escape'){
    if(!$('page-find').hidden){closeFindBar();return;}
    if(!$('auth-modal').hidden){closeAuth();return;}
    if(panelOpen){setPanel(false);return;}
  }
  const key=event.key.toLowerCase();
  const modifier=event.ctrlKey||event.metaKey;
  if(event.altKey&&key==='arrowleft'){event.preventDefault();api.back();}
  else if(event.altKey&&key==='arrowright'){event.preventDefault();api.forward();}
  else if(modifier&&event.shiftKey&&key==='n'){event.preventDefault();api.openIncognito();}
  else if(modifier&&event.shiftKey&&key==='t'){event.preventDefault();api.reopenTab();}
  else if(modifier&&key==='t'){event.preventDefault();api.newTab();}
  else if(modifier&&key==='w'&&activeTabId!==null){event.preventDefault();api.closeTab(activeTabId);}
  else if(modifier&&key==='tab'){event.preventDefault();const index=tabs.findIndex((tab)=>tab.id===activeTabId);const next=(index+(event.shiftKey?-1:1)+tabs.length)%tabs.length;if(tabs[next])api.selectTab(tabs[next].id);}
  else if((modifier&&key==='r')||key==='f5'){event.preventDefault();api.reload();}
  else if(modifier&&key==='l'){event.preventDefault();$('address').focus();$('address').select();}
  else if(modifier&&key==='d'){event.preventDefault();toggleBookmark();}
  else if(modifier&&key==='f'){event.preventDefault();openFindBar();}
  else if(modifier&&key==='h'){event.preventDefault();setPanel(true);updateContent('history');}
  else if(modifier&&key==='j'){event.preventDefault();setPanel(true);updateContent('downloads');}
  else if(modifier&&key===','){event.preventDefault();setPanel(true);updateContent('settings');}
  else if(modifier&&key==='p'){event.preventDefault();api.print();}
});
applyTheme(localStorage.getItem('mantra-theme') || 'dark');
applyWallpaper(localStorage.getItem('mantra-wallpaper') || 'default');
configureWallpaperRotation();
setPanel(false);
