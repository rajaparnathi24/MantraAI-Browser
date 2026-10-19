const api = window.browserAPI;
const $ = (id) => document.getElementById(id);
const panel = $('assistant-panel');
const home = $('home');
const defaultHome = $('default-home');
const quickPanel = $('panel-content');
const contentView = $('content-view');
let panelOpen = true;
let activeUrl = '';
let bookmarks = JSON.parse(localStorage.getItem('mantra-bookmarks') || '[]');
let historyItems = JSON.parse(localStorage.getItem('mantra-history') || '[]');
let downloads = [];
let tabs = [];
let activeTabId = null;
const WALLPAPERS = {
  default:'assets/home-wallpaper.svg',
  dusk:'assets/dusk-wallpaper.svg',
  blue:'assets/blue-hour-wallpaper.svg'
};
let rotationTimer = null;
let lastFindQuery = '';

function renderTabs() {
  const strip = $('tab-strip');
  strip.classList.toggle('empty', tabs.length === 0);
  strip.innerHTML = tabs.map((tab) => `<div class="tab${tab.id === activeTabId ? ' active' : ''}" data-tab-id="${tab.id}" title="${escapeAttr(tab.title)}"><span class="tab-favicon">${tab.home ? '<img src="assets/mantraai-logo-transparent.png" alt="">' : '◉'}</span><span class="tab-title">${escapeHtml(tab.title || 'New Tab')}</span><button class="tab-close" data-close-tab="${tab.id}" aria-label="Close tab">×</button></div>`).join('');
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
  $('panel-toggle').title = open ? 'Close MantraAI panel' : 'Open MantraAI panel';
  api.setPanelOpen(open);
}

function showHome() {
  home.hidden = false;
  defaultHome.hidden = true;
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
  $('panel-content').scrollTo({top:0});
  contentView.scrollTo({top:0});
  home.hidden = false;
  defaultHome.hidden = true;
  selectSideItem(name);
  quickPanel.hidden = true;
  contentView.hidden = false;
  const titles = {chat:'MantraAI Chat',bookmarks:'Bookmarks',history:'History',downloads:'Downloads',extensions:'Extensions',settings:'Settings',notes:'Notes',reading:'Reading List'};
  const title = titles[name] || 'MantraAI';
  let body = '';
  if (name === 'bookmarks') {
    body = bookmarks.length ? bookmarks.map((item) => `<button class="content-row" data-open-url="${escapeAttr(item.url)}">☆ &nbsp;${escapeHtml(item.title || item.url)}<small> &nbsp; ${escapeHtml(item.url)}</small></button>`).join('') : '<div class="empty">Your saved pages will appear here.</div>';
  } else if (name === 'history') {
    body = historyItems.length ? historyItems.map((item) => `<button class="content-row" data-open-url="${escapeAttr(item.url)}">◷ &nbsp;${escapeHtml(item.title || item.url)}<small> &nbsp; ${escapeHtml(item.url)}</small></button>`).join('') : '<div class="empty">Pages you visit will appear here.</div>';
  } else if (name === 'downloads') {
    body = downloads.length ? downloads.map((item) => `<div class="content-row">↓ &nbsp;${escapeHtml(item.name)}<small> &nbsp; ${escapeHtml(item.state)}</small></div>`).join('') : '<div class="empty">Your downloads will appear here.</div>';
  } else if (name === 'settings') {
    body = `<label for="theme-select">Appearance</label><select id="theme-select"><option value="dark">Midnight Saffron</option><option value="light">Light</option></select><label for="homepage-input">Homepage</label><input id="homepage-input" value="${escapeAttr(localStorage.getItem('mantra-homepage') || 'https://www.google.com')}"><label for="wallpaper-select">New tab wallpaper</label><select id="wallpaper-select"><option value="default">Midnight Sunrise · Default</option><option value="dusk">Saffron Dusk</option><option value="blue">Blue Hour</option><option value="custom">Your image…</option></select><button class="content-row" id="choose-wallpaper">Choose an image from this device</button><label class="setting-check"><input type="checkbox" id="wallpaper-rotate"> Random wallpaper every 30 minutes</label><p id="wallpaper-message"></p><button class="save-action" id="save-settings">Save settings</button><p id="settings-message"></p>`;
  } else if (name === 'extensions') {
    body = '<div class="empty">Extensions are managed by Chromium.</div>';
  } else if (name === 'notes') {
    body = `<textarea id="notes-text" rows="10" placeholder="Write a note..." style="width:100%;resize:vertical;background:#0d1926;border:1px solid #34495d;border-radius:8px;color:#f0f0ef;padding:12px">${escapeHtml(localStorage.getItem('mantra-notes') || '')}</textarea><button class="save-action" id="save-notes">Save note</button>`;
  } else if (name === 'reading') {
    body = '<div class="empty">Save a page to your reading list to find it here.</div>';
  } else {
    body = '<div class="empty">Ask anything and explore the web with MantraAI.</div>';
  }
  contentView.innerHTML = `<h2>${title}</h2><p>Make your browsing feel more like yours.</p>${body}`;
  contentView.querySelectorAll('[data-open-url]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.openUrl)));
  if (name === 'settings') {
    const theme = contentView.querySelector('#theme-select');
    theme.value = localStorage.getItem('mantra-theme') || 'dark';
    theme.addEventListener('change', () => { document.body.classList.toggle('light-theme', theme.value === 'light'); localStorage.setItem('mantra-theme', theme.value); });
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
    contentView.querySelector('#save-settings').addEventListener('click', () => {
      const value = contentView.querySelector('#homepage-input').value.trim();
      try { const url = new URL(value); if (!['http:','https:'].includes(url.protocol)) throw new Error(); localStorage.setItem('mantra-homepage', url.href); contentView.querySelector('#settings-message').textContent = 'Homepage saved.'; }
      catch { contentView.querySelector('#settings-message').textContent = 'Enter a valid HTTP or HTTPS website URL.'; }
    });
  }
  if (name === 'notes') contentView.querySelector('#save-notes').addEventListener('click', () => { localStorage.setItem('mantra-notes', contentView.querySelector('#notes-text').value); toast('Note saved'); });
}

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
function navigate(value) {
  const address = String(value || '').trim();
  if (!address) return;
  activeUrl = address; $('address').value = address;
  home.hidden = true; defaultHome.hidden = true; contentView.hidden = true; quickPanel.hidden = false;
  api.navigate(address);
}
function runSearch(value) { if (value?.trim()) navigate(`https://www.google.com/search?q=${encodeURIComponent(value.trim())}`); }
function toggleBookmark() {
  if (!activeUrl) { toast('Open a page to bookmark it'); return; }
  const found = bookmarks.findIndex((item) => item.url === activeUrl);
  if (found >= 0) { bookmarks.splice(found, 1); toast('Bookmark removed'); }
  else { bookmarks.unshift({url:activeUrl,title:activeUrl}); toast('Page bookmarked'); }
  localStorage.setItem('mantra-bookmarks', JSON.stringify(bookmarks));
  const saved = bookmarks.some((item) => item.url === activeUrl);
  $('bookmark-toggle').textContent = saved ? '★' : '☆';
  $('bookmark-toggle').setAttribute('aria-pressed', String(saved));
  $('bookmark-toggle').title = saved ? 'Remove bookmark' : 'Bookmark this page';
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

$('address-form').addEventListener('submit', (event) => { event.preventDefault(); navigate($('address').value); });
$('back').addEventListener('click', () => api.back());
$('forward').addEventListener('click', () => api.forward());
$('reload').addEventListener('click', () => api.reload());
$('home-search').addEventListener('submit', (event) => { event.preventDefault(); runSearch($('home-query').value); });
$('assistant-form').addEventListener('submit', (event) => { event.preventDefault(); const q = $('assistant-query').value.trim(); if (q) runSearch(q); });
$('panel-toggle').addEventListener('click', () => setPanel(!panelOpen));
$('panel-close').addEventListener('click', () => setPanel(false));
$('new-tab').addEventListener('click', () => api.newTab());
$('sidebar-new-tab').addEventListener('click', () => api.newTab());
document.querySelectorAll('[data-panel]').forEach((button) => button.addEventListener('click', () => { if (button.closest('.toolbar-tools')) setPanel(true); updateContent(button.dataset.panel); }));
document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
  const action = button.dataset.action; const field = $('assistant-query');
  const prompts = {search:'Search the web for ',summarize:'Summarize ',write:'Help me write ',code:'Help me code '};
  field.value = prompts[action] || ''; field.focus();
}));
document.querySelectorAll('.trending-grid button').forEach((button) => button.addEventListener('click', () => runSearch(button.textContent.replace('⌕','').trim())));
document.querySelectorAll('.favorites button[data-url]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.url)));
$('add-favorite').addEventListener('click', () => { const url = prompt('Enter a website address'); if (url) navigate(url); });
$('incognito-button').addEventListener('click', () => api.openIncognito());
$('desktop-button').addEventListener('click', () => { api.desktopSite(); toast('Desktop view enabled for the current page'); });
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
    historyItems = [{url:state.url,title:state.url,time:Date.now()}, ...historyItems.filter((item) => item.url !== state.url)].slice(0,80);
    localStorage.setItem('mantra-history', JSON.stringify(historyItems));
  }
  const saved = bookmarks.some((item) => item.url === activeUrl);
  $('bookmark-toggle').textContent = saved ? '★' : '☆';
  $('bookmark-toggle').setAttribute('aria-pressed', String(saved));
  $('bookmark-toggle').title = saved ? 'Remove bookmark' : 'Bookmark this page';
});
api.onTabs((state) => { tabs = state.tabs; activeTabId = state.activeId; renderTabs(); });
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
api.onDownloads((items) => { downloads = items; if (!contentView.hidden && document.querySelector('.content-view h2')?.textContent === 'Downloads') updateContent('downloads'); });

document.querySelectorAll('.window-actions button').forEach((button,index) => button.addEventListener('click', () => api.windowAction(['minimize','maximize','close'][index])));
document.addEventListener('keydown', (event) => {
  const key=event.key.toLowerCase();
  const modifier=event.ctrlKey||event.metaKey;
  if(event.key==='Escape'){if(!$('page-find').hidden)closeFindBar();else setPanel(false);}
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
document.body.classList.toggle('light-theme', localStorage.getItem('mantra-theme') === 'light');
applyWallpaper(localStorage.getItem('mantra-wallpaper') || 'default');
configureWallpaperRotation();
setPanel(true);
