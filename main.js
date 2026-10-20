const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, shell, safeStorage } = require('electron');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');

let win;
let tabs = [];
let closedTabs = [];
let activeTabId = null;
let nextTabId = 1;
let panelOpen = false;
let modalOpen = false;
let downloadItems = [];
const activeDownloads = new Map();
let downloadTrackingAttached = false;
let firebaseConfig = {};
let authSession = null;
let authRefreshInFlight = null;
const TOOLBAR_HEIGHT = 96;
const PANEL_WIDTH = 366;
const extensionListPath = () => path.join(app.getPath('userData'), 'unpacked-extensions.json');
function readExtensionPaths() { try { const list=JSON.parse(fs.readFileSync(extensionListPath(),'utf8')); return Array.isArray(list)?list.filter((item)=>typeof item==='string'):[]; } catch { return []; } }
function writeExtensionPaths(paths) { fs.mkdirSync(path.dirname(extensionListPath()),{recursive:true}); fs.writeFileSync(extensionListPath(),JSON.stringify(paths,null,2),'utf8'); }
function attachIncognitoNavigationSecurity(contents) {
  const isWebNavigation = (target) => {
    try { const protocol=new URL(target).protocol; return protocol==='http:'||protocol==='https:'; }
    catch { return false; }
  };
  contents.on('will-navigate',(event,target)=>{ if(!isWebNavigation(target))event.preventDefault(); });
  contents.on('will-redirect',(event,target,_isInPlace,isMainFrame)=>{ if(isMainFrame&&!isWebNavigation(target))event.preventDefault(); });
}

const activeTab = () => tabs.find((tab) => tab.id === activeTabId);

const FIREBASE_CONFIG_FIELDS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_MESSAGING_SENDER_ID',
  'GOOGLE_OAUTH_CLIENT_ID'
];

function filterFirebaseConfig(config) {
  return Object.fromEntries(FIREBASE_CONFIG_FIELDS
    .filter((key) => typeof config?.[key] === 'string' && config[key].trim())
    .map((key) => [key, config[key].trim()]));
}

function readDevelopmentFirebaseConfig() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return {};
  const config = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    config[match[1]] = value;
  }
  return filterFirebaseConfig(config);
}

function readInstalledFirebaseConfig() {
  const configPath = path.join(app.getPath('userData'), 'firebase-config.json');
  try {
    return filterFirebaseConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read Firebase client config:', error.message);
    return {};
  }
}

function readFirebaseConfig() {
  return app.isPackaged ? readInstalledFirebaseConfig() : readDevelopmentFirebaseConfig();
}

function firebaseConfigHint() {
  return app.isPackaged
    ? 'Add the Firebase values to firebase-config.json in this app’s user-data folder, then restart MantraAI Browser.'
    : 'Add the Firebase values to the local .env file, then restart MantraAI Browser.';
}

const sessionPath = () => path.join(app.getPath('userData'), 'firebase-auth-session.bin');
async function persistAuthSession() {
  if (!authSession || !await safeStorage.isAsyncEncryptionAvailable()) return;
  fs.mkdirSync(path.dirname(sessionPath()), { recursive:true });
  fs.writeFileSync(sessionPath(), await safeStorage.encryptStringAsync(JSON.stringify(authSession)));
}
async function loadAuthSession() {
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) return;
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(fs.readFileSync(sessionPath()));
    authSession = JSON.parse(result);
    if (shouldReEncrypt) await persistAuthSession();
  } catch { authSession = null; }
}
function publicUser() {
  if (!authSession) return null;
  const { uid, email, displayName, photoUrl } = authSession.user;
  return { uid, email, displayName, photoUrl };
}
function publishAuthState() {
  if (win && !win.isDestroyed()) win.webContents.send('auth:state', publicUser());
}
function focusBrowserWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
async function clearAuthSession() {
  authSession = null;
  try { fs.rmSync(sessionPath(), { force:true }); } catch {}
  publishAuthState();
}

function authErrorMessage(error) {
  const code = String(error?.message || error || 'UNKNOWN').split(':')[0];
  const known = {
    EMAIL_EXISTS:'An account with this email already exists.',
    INVALID_EMAIL:'Enter a valid email address.',
    WEAK_PASSWORD:'Choose a stronger password with at least 6 characters.',
    EMAIL_NOT_FOUND:'No account was found with that email.',
    INVALID_LOGIN_CREDENTIALS:'The email or password is incorrect.',
    INVALID_PASSWORD:'The email or password is incorrect.',
    USER_DISABLED:'This account has been disabled.',
    OPERATION_NOT_ALLOWED:'This sign-in method is not enabled in Firebase Authentication.',
    TOO_MANY_ATTEMPTS_TRY_LATER:'Too many attempts. Try again later.',
    NETWORK_REQUEST_FAILED:'Could not connect. Check your internet connection and try again.',
    INVALID_IDP_RESPONSE:'Google sign-in did not return a valid identity token.',
    CONFIGURATION_NOT_FOUND:'Enable this sign-in provider in Firebase Authentication.',
    OAUTH_CANCELLED:'Google sign-in was cancelled.',
    OAUTH_TIMEOUT:'Google sign-in timed out. Please try again.',
    OAUTH_STATE_MISMATCH:'Google sign-in could not be verified. Please try again.',
    GOOGLE_TOKEN_EXCHANGE_FAILED:'Google sign-in could not be completed. Check the desktop OAuth client settings.'
  };
  if (known[code]) return known[code];
  if (code === 'FIREBASE_NOT_CONFIGURED') return firebaseConfigHint();
  if (code === 'GOOGLE_NOT_CONFIGURED') return `Add GOOGLE_OAUTH_CLIENT_ID to your Firebase config. ${firebaseConfigHint()}`;
  if (/fetch failed|ENOTFOUND|ECONN/.test(String(error?.message || error))) return 'Could not connect. Check your internet connection and try again.';
  return 'Sign-in failed. Check your connection and Firebase Authentication settings.';
}

async function firebaseRequest(endpoint, body, form = false) {
  const apiKey = firebaseConfig.FIREBASE_API_KEY;
  if (!apiKey) throw new Error('FIREBASE_NOT_CONFIGURED');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method:'POST', headers:{ 'Content-Type':form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body:form ? new URLSearchParams(body).toString() : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'AUTH_REQUEST_FAILED');
  return data;
}

async function setAuthSession(data) {
  authSession = {
    idToken:data.idToken,
    refreshToken:data.refreshToken,
    expiresAt:Date.now() + Math.max(0, Number(data.expiresIn || 3600) - 60) * 1000,
    user:{ uid:data.localId, email:data.email || '', displayName:data.displayName || '', photoUrl:data.photoUrl || '' }
  };
  await persistAuthSession();
  publishAuthState();
  return publicUser();
}

async function refreshAuthSession(force = false) {
  if (!authSession || !firebaseConfig.FIREBASE_API_KEY) return authSession;
  if (!force && authSession.expiresAt > Date.now()) return authSession;
  if (authRefreshInFlight) return authRefreshInFlight;
  authRefreshInFlight = (async () => {
    try {
      const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseConfig.FIREBASE_API_KEY)}`, {
        method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'refresh_token',refresh_token:authSession.refreshToken}).toString()
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = data.error?.message || '';
        if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND/.test(code)) await clearAuthSession();
        throw new Error(code || 'TOKEN_REFRESH_FAILED');
      }
      authSession.idToken = data.id_token;
      authSession.refreshToken = data.refresh_token;
      authSession.expiresAt = Date.now() + Math.max(0, Number(data.expires_in || 3600) - 60) * 1000;
      await persistAuthSession();
      return authSession;
    } finally { authRefreshInFlight = null; }
  })();
  return authRefreshInFlight;
}

function googleDesktopSignIn() {
  const clientId = firebaseConfig.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return Promise.reject(new Error('GOOGLE_NOT_CONFIGURED'));
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    let settled = false;
    let callbackAccepted = false;
    const finish = (error, idToken) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      error ? reject(error) : resolve(idToken);
    };
    const server = http.createServer(async (request, response) => {
      const callback = new URL(request.url, 'http://127.0.0.1');
      if (callback.pathname !== '/oauth2callback') { response.writeHead(404).end('Not found'); return; }
      if (callback.searchParams.get('state') !== state) { response.writeHead(400).end('Sign-in state did not match. Return to the sign-in page and try again.'); return; }
      if (callbackAccepted) { response.writeHead(409).end('This sign-in request has already been received.'); return; }
      const code = callback.searchParams.get('code');
      if (!code) { response.writeHead(400).end('Google sign-in was cancelled. You can close this tab.'); finish(new Error('OAUTH_CANCELLED')); return; }
      callbackAccepted = true;
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      response.end('<!doctype html><title>MantraAI Browser</title><p style="font:16px Segoe UI,Arial;color:#142033">Sign-in complete. Returning to MantraAI Browser…</p>');
      try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({code,client_id:clientId,redirect_uri:redirectUri,code_verifier:verifier,grant_type:'authorization_code'}).toString()
        });
        const tokenData = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !tokenData.id_token) throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
        finish(null, tokenData.id_token);
      } catch (error) { finish(error); }
    });
    const timeout = setTimeout(() => finish(new Error('OAUTH_TIMEOUT')), 5 * 60 * 1000);
    server.once('error', (error) => finish(error));
    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      for (const [key,value] of Object.entries({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid email profile',state,code_challenge:challenge,code_challenge_method:'S256'})) authUrl.searchParams.set(key,value);
      try { await shell.openExternal(authUrl.href); }
      catch (error) { finish(error); }
    });
  });
}

function closeTab(id) {
  const index=tabs.findIndex((tab)=>tab.id===id);
  if(index<0)return;
  const [tab]=tabs.splice(index,1);
  if(!tab.home&&tab.url){
    const history=tab.view.webContents.navigationHistory;
    closedTabs.push({entries:history.getAllEntries(),index:history.getActiveIndex(),url:tab.url,title:tab.title});
    if(closedTabs.length>20)closedTabs.shift();
  }
  win?.contentView.removeChildView(tab.view);
  tab.view.webContents.close();
  if(!tabs.length){activeTabId=null;createTab({verseHome:true});}
  else if(activeTabId===id)activeTabId=tabs[Math.max(0,index-1)].id;
  resizeBrowser();sendState();
}

function normalizeAddress(value) {
  value = String(value || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
  }
  if (!/\s/.test(value) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(value)) return 'https://' + value;
  return 'https://www.google.com/search?q=' + encodeURIComponent(value);
}

function publishTabs() {
  if (!win) return;
  win.webContents.send('browser:tabs', {
    activeId: activeTabId,
    tabs: tabs.filter((tab) => !tab.verseHome).map(({ id, title, url, home }) => ({ id, title: title || 'New Tab', url: home ? '' : url, home }))
  });
}

function sendState() {
  const tab = activeTab();
  if (!win || !tab) return;
  const history = tab.view.webContents.navigationHistory;
  win.webContents.send('browser:state', {
    tabId: tab.id,
    title:tab.title || 'New Tab',
    url: tab.home ? '' : tab.view.webContents.getURL(),
    canGoBack: !tab.home && history.canGoBack(),
    canGoForward: !tab.home && history.canGoForward(),
    loading: !tab.home && tab.view.webContents.isLoading(),
    home: tab.home,
    verseHome: tab.verseHome
  });
  publishTabs();
}

function resizeBrowser() {
  if (!win) return;
  const [width, height] = win.getContentSize();
  if (modalOpen) {
    for (const tab of tabs) {
      tab.view.setBounds({ x:0, y:TOOLBAR_HEIGHT, width:0, height:0 });
    }
    return;
  }
  const panelWidth = panelOpen ? Math.min(width, width <= 900 ? 320 : PANEL_WIDTH) : 0;
  for (const tab of tabs) {
    if (tab.id === activeTabId && !tab.home) {
      tab.view.setBounds({ x:0, y:TOOLBAR_HEIGHT, width:Math.max(0,width-panelWidth), height:Math.max(0,height-TOOLBAR_HEIGHT) });
    } else {
      tab.view.setBounds({ x:0, y:TOOLBAR_HEIGHT, width:0, height:0 });
    }
  }
}

function createTab({ url = null, activate = true, verseHome = false } = {}) {
  if (!verseHome) {
    const landingTabs = tabs.filter((tab) => tab.verseHome);
    for (const landingTab of landingTabs) {
      win?.contentView.removeChildView(landingTab.view);
      landingTab.view.webContents.close();
    }
    tabs = tabs.filter((tab) => !tab.verseHome);
  }
  const id = nextTabId++;
  const view = new WebContentsView({ webPreferences:{ contextIsolation:true, nodeIntegration:false, sandbox:true } });
  const tab = { id, view, title:'New Tab', url:'', home:true, verseHome:Boolean(verseHome), desktopSite:false };
  tabs.push(tab);
  win.contentView.addChildView(view);
  view.webContents.on('page-title-updated',(_event,title)=>{ tab.title=title || tab.url || 'New Tab'; publishTabs(); if(activeTabId===tab.id)sendState(); });
  for (const event of ['did-navigate','did-navigate-in-page']) {
    view.webContents.on(event,(_event,url)=>{ tab.url=url || view.webContents.getURL();tab.home=false;tab.verseHome=false;sendState(); });
  }
  for (const event of ['did-start-loading','did-stop-loading']) view.webContents.on(event,sendState);
  view.webContents.on('did-finish-load',()=>{
    view.webContents.insertCSS('::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}').catch(()=>{});
    sendState();
  });
  view.webContents.on('before-input-event',(event,input)=>browserShortcut(tab,event,input));
  view.webContents.on('will-navigate',(event,target)=>{
    try { const protocol=new URL(target).protocol; if(protocol!=='http:'&&protocol!=='https:')event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  view.webContents.on('will-redirect',(event,target,_isInPlace,isMainFrame)=>{
    if(!isMainFrame)return;
    try { const protocol=new URL(target).protocol; if(protocol!=='http:'&&protocol!=='https:'){event.preventDefault();return;} }
    catch { event.preventDefault();return; }
  });
  view.webContents.on('found-in-page',(_event,result)=>{
    if(activeTabId===tab.id)win?.webContents.send('browser:find-result',{activeMatchOrdinal:result.activeMatchOrdinal,matches:result.matches});
  });
  view.webContents.setWindowOpenHandler(({ url: targetUrl })=>{
    const normalized=normalizeAddress(targetUrl);
    if (normalized) createTab({ url:normalized });
    return { action:'deny' };
  });
  if (activate) activeTabId=id;
  resizeBrowser();
  publishTabs();
  sendState();
  if (url) navigateTab(tab,url);
  return tab;
}

function navigateTab(tab, address) {
  const url=normalizeAddress(address);
  if (!url || !tab) return;
  tab.home=false;
  tab.verseHome=false;
  tab.url=url;
  tab.title=url;
  resizeBrowser();
  publishTabs();
  tab.view.webContents.loadURL(url).catch((error)=>console.error(error));
}

function browserShortcut(tab,event,input) {
  if (input.type !== 'keyDown' || !tab) return;
  const key=input.key.toLowerCase();
  const modifier=input.control||input.meta;
  const history=tab.view.webContents.navigationHistory;
  const send=(action)=>{event.preventDefault();win?.webContents.send('browser:shortcut',action);};
  if(input.alt&&key==='arrowleft') { event.preventDefault();if(history.canGoBack())history.goBack(); }
  else if(input.alt&&key==='arrowright') { event.preventDefault();if(history.canGoForward())history.goForward(); }
  else if(modifier&&input.shift&&key==='n') send('incognito');
  else if(modifier&&input.shift&&key==='t') send('reopen-tab');
  else if(modifier&&key==='t') send('new-tab');
  else if(modifier&&key==='w') send('close-tab');
  else if(modifier&&key==='tab') {
    event.preventDefault();
    const index=tabs.findIndex((item)=>item.id===activeTabId);
    const next=(index+(input.shift?-1:1)+tabs.length)%tabs.length;
    if(tabs[next]){activeTabId=tabs[next].id;resizeBrowser();sendState();}
  }
  else if((modifier&&key==='r')||key==='f5'){event.preventDefault();if(!tab.home)tab.view.webContents.reload();}
  else if(modifier&&key==='l')send('focus-address');
  else if(modifier&&key==='f')send('find');
  else if(modifier&&key==='d')send('bookmark');
  else if(modifier&&key==='h')send('history');
  else if(modifier&&key==='j')send('downloads');
  else if(modifier&&key===',')send('settings');
  else if(modifier&&key==='p'){event.preventDefault();tab.view.webContents.print();}
  else if(modifier&&(key==='+'||key==='=')){event.preventDefault();tab.view.webContents.setZoomLevel(tab.view.webContents.getZoomLevel()+1);}
  else if(modifier&&key==='-'){event.preventDefault();tab.view.webContents.setZoomLevel(tab.view.webContents.getZoomLevel()-1);}
  else if(modifier&&key==='0'){event.preventDefault();tab.view.webContents.setZoomLevel(0);}
}

function createWindow() {
  win = new BrowserWindow({
    width:1536, height:1024, minWidth:760, minHeight:560,
    title:'MantraAI Browser', titleBarStyle:'hidden', backgroundColor:'#080f1b',
    icon:path.join(__dirname,'assets','mantraai-logo-transparent.png'),
    webPreferences:{ preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true }
  });
  win.on('resize',resizeBrowser);
  win.on('closed',()=>{ win=null; tabs=[]; activeTabId=null; });
  win.webContents.on('did-finish-load',()=>{ resizeBrowser(); publishTabs(); sendState(); });
  if (!downloadTrackingAttached) {
    downloadTrackingAttached = true;
    session.defaultSession.on('will-download',(_event,item)=>{
    const id=crypto.randomUUID();
    const download={id,name:item.getFilename(),state:'In progress',received:0,total:item.getTotalBytes(),path:item.getSavePath(),canResume:false,paused:false};
    activeDownloads.set(id,item);
    downloadItems.unshift(download);
    const publish=()=>win?.webContents.send('browser:downloads',downloadItems);
    item.on('updated',(_event,state)=>{ download.received=item.getReceivedBytes(); download.total=item.getTotalBytes(); download.path=item.getSavePath(); download.canResume=item.canResume(); download.paused=state==='progressing'&&item.isPaused(); download.state=state==='interrupted'?'Interrupted':download.paused?'Paused':'In progress'; publish(); });
    item.once('done',(_event,state)=>{ download.received=item.getReceivedBytes(); download.total=item.getTotalBytes(); download.path=item.getSavePath(); download.canResume=item.canResume(); download.state=state==='completed'?'Complete':state==='cancelled'?'Canceled':'Interrupted'; activeDownloads.delete(id); publish(); });
    publish();
    });
  }
  createTab({ activate:true });
  win.loadFile(path.join(__dirname,'index.html'));
}

ipcMain.on('browser:navigate',(_event,address)=>navigateTab(activeTab(),address));
ipcMain.on('browser:new-tab',()=>createTab());
ipcMain.on('browser:select-tab',(_event,id)=>{
  if (tabs.some((tab)=>tab.id===id)) { activeTabId=id; resizeBrowser(); sendState(); }
});
ipcMain.on('browser:close-tab',(_event,id)=>{
  closeTab(id);
});
ipcMain.on('browser:reopen-tab',async()=>{
  const closed=closedTabs.pop();
  if(!closed){createTab();return;}
  const tab=createTab();
  if(closed.entries?.length){
    tab.home=false;
    tab.url=closed.url||closed.entries[closed.index]?.url||'';
    tab.title=closed.title||tab.url||'New Tab';
    resizeBrowser();
    try{await tab.view.webContents.navigationHistory.restore({entries:closed.entries,index:closed.index});}
    catch(error){console.error(error);if(tab.url)navigateTab(tab,tab.url);}
    sendState();
  }
});
ipcMain.on('browser:home',()=>{
  const tab=activeTab();
  if (tab) { tab.home=true; tab.verseHome=false; tab.title='New Tab'; tab.url=''; resizeBrowser(); sendState(); }
});
ipcMain.on('browser:panel-open',(_event,open)=>{ panelOpen=Boolean(open); resizeBrowser(); });
ipcMain.on('browser:modal-open',(_event,open)=>{ modalOpen=Boolean(open); resizeBrowser(); });
ipcMain.on('browser:back',()=>{ const history=activeTab()?.view.webContents.navigationHistory; if(history?.canGoBack())history.goBack(); });
ipcMain.on('browser:forward',()=>{ const history=activeTab()?.view.webContents.navigationHistory; if(history?.canGoForward())history.goForward(); });
ipcMain.on('browser:reload',()=>{ const tab=activeTab(); if(tab&&!tab.home)tab.view.webContents.reload(); });
ipcMain.on('browser:find',(_event,query,forward,next)=>{
  const tab=activeTab();
  if(tab&&!tab.home&&query)tab.view.webContents.findInPage(query,{forward:Boolean(forward),findNext:Boolean(next)});
});
ipcMain.on('browser:stop-find',()=>activeTab()?.view.webContents.stopFindInPage('clearSelection'));
ipcMain.on('browser:window-action',(_event,action)=>{
  if(!win)return;
  if(action==='minimize')win.minimize();
  else if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();
  else if(action==='close')win.close();
});
ipcMain.on('browser:incognito',()=>{
  const privateSession=session.fromPartition(`incognito-${Date.now()}`,{cache:false});
  const createPrivateWindow=(initialUrl='https://www.google.com')=>{
    const privateWindow=new BrowserWindow({width:1200,height:800,title:'MantraAI Browser — Incognito',backgroundColor:'#080f1b',icon:path.join(__dirname,'assets','mantraai-logo-transparent.png'),webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,session:privateSession}});
    attachIncognitoNavigationSecurity(privateWindow.webContents);
    privateWindow.webContents.setWindowOpenHandler(({url})=>{
      const target=normalizeAddress(url);
      if(target)createPrivateWindow(target);
      return {action:'deny'};
    });
    privateWindow.loadURL(initialUrl);
    return privateWindow;
  };
  createPrivateWindow();
});
ipcMain.on('browser:desktop-site',()=>{
  const tab=activeTab();
  if(!tab)return;
  const contents=tab.view.webContents;
  const ua=contents.getUserAgent().replace(/\sMantraAI-Desktop\/1/g,'');
  tab.desktopSite=!tab.desktopSite;
  contents.setUserAgent(tab.desktopSite?`${ua} MantraAI-Desktop/1`:ua);
  if(!tab.home)contents.reload();
});
ipcMain.handle('browser:choose-wallpaper',async()=>{
  if(!win)return null;
  const result=await dialog.showOpenDialog(win,{
    title:'Choose a MantraAI wallpaper',
    properties:['openFile'],
    filters:[{name:'Image files',extensions:['png','jpg','jpeg','webp','bmp','gif']}]
  });
  return result.canceled||!result.filePaths[0]?null:pathToFileURL(result.filePaths[0]).href;
});
ipcMain.on('browser:print',()=>activeTab()?.view.webContents.print());
ipcMain.on('browser:new-window', () => createWindow());
ipcMain.handle('browser:zoom', (_event, action) => {
  const tab = activeTab();
  if (!tab || tab.home) return 1.0;
  let factor = tab.view.webContents.getZoomFactor();
  if (action === 'in') factor = Math.min(3.0, Math.round((factor + 0.1) * 10) / 10);
  else if (action === 'out') factor = Math.max(0.5, Math.round((factor - 0.1) * 10) / 10);
  else if (action === 'reset') factor = 1.0;
  tab.view.webContents.setZoomFactor(factor);
  return factor;
});
ipcMain.on('browser:fullscreen', () => {
  if (win) win.setFullScreen(!win.isFullScreen());
});
ipcMain.on('browser:devtools', () => {
  const tab = activeTab();
  if (tab) tab.view.webContents.toggleDevTools();
});
ipcMain.handle('browser:save-page', async () => {
  const tab = activeTab();
  if (!tab || tab.home) return false;
  const result = await dialog.showSaveDialog(win, {
    title: 'Save page as',
    defaultPath: `${tab.title || 'page'}.html`,
    filters: [{ name: 'HTML Files', extensions: ['html', 'htm'] }]
  });
  if (result.canceled || !result.filePath) return false;
  await tab.view.webContents.savePage(result.filePath, 'HTMLComplete');
  return true;
});
ipcMain.on('browser:clipboard-action', (_event, action) => {
  const tab = activeTab();
  if (!tab || tab.home) return;
  if (action === 'cut') tab.view.webContents.cut();
  else if (action === 'copy') tab.view.webContents.copy();
  else if (action === 'paste') tab.view.webContents.paste();
});
ipcMain.on('browser:exit', () => app.quit());
ipcMain.handle('browser:get-process-metrics', () => {
  return app.getAppMetrics().map(m => ({
    pid: m.pid,
    type: m.type,
    cpuPercent: Math.round(m.cpu.percentCPUUsage * 10) / 10,
    memoryMb: Math.round((m.memory.workingSetSize / 1024) * 10) / 10
  }));
});

function trustedBrowserSender(event) { return Boolean(win && !win.isDestroyed() && event.sender === win.webContents); }
ipcMain.handle('browser:get-downloads', (event) => { if (!trustedBrowserSender(event)) throw new Error('Unauthorized'); return downloadItems; });
ipcMain.handle('browser:download-action', async (event, id, action) => {
  if (!trustedBrowserSender(event) || typeof id !== 'string') throw new Error('Unauthorized');
  const item = activeDownloads.get(id);
  const record = downloadItems.find((entry) => entry.id === id);
  if (action === 'open' || action === 'reveal') {
    if (!record?.path || !fs.existsSync(record.path)) throw new Error('The downloaded file is not available on disk.');
    if (action === 'open') return shell.openPath(record.path);
    shell.showItemInFolder(record.path); return '';
  }
  if (!item) return false;
  if (action === 'pause' && !item.isPaused()) item.pause();
  else if (action === 'resume' && (item.isPaused() || item.canResume())) item.resume();
  else if (action === 'cancel') item.cancel();
  else throw new Error('Unsupported download action.');
  return true;
});
ipcMain.handle('browser:clear-site-data', async (event) => {
  if (!trustedBrowserSender(event)) throw new Error('Unauthorized');
  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData({ storages:['cookies','localstorage','indexdb','serviceworkers','cachestorage'] });
  return true;
});
ipcMain.handle('browser:choose-bookmark-file', async (event, mode, bookmarks) => {
  if (!trustedBrowserSender(event)) throw new Error('Unauthorized');
  if (mode === 'import') {
    const result = await dialog.showOpenDialog(win, { title:'Import bookmarks', properties:['openFile'], filters:[{name:'Bookmark HTML',extensions:['html','htm']}] });
    if (result.canceled || !result.filePaths[0]) return null;
    const html = await fs.promises.readFile(result.filePaths[0], 'utf8');
    const entries = [...html.matchAll(/<A\b([^>]*)>([\s\S]*?)<\/A>/gi)].map((match) => {
      const href = match[1].match(/HREF\s*=\s*["']([^"']+)["']/i)?.[1];
      const title = match[2].replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').trim();
      try { const url = new URL(href); return ['http:','https:'].includes(url.protocol) ? {url:url.href,title:title||url.hostname} : null; } catch { return null; }
    }).filter(Boolean);
    return entries;
  }
  if (!Array.isArray(bookmarks)) throw new Error('Invalid bookmarks.');
  const result = await dialog.showSaveDialog(win, { title:'Export bookmarks', defaultPath:'mantraai-bookmarks.html', filters:[{name:'Bookmark HTML',extensions:['html']}] });
  if (result.canceled || !result.filePath) return false;
  const safe = bookmarks.filter((entry) => entry && typeof entry.url === 'string' && /^https?:\/\//i.test(entry.url)).map((entry) => `<DT><A HREF="${entry.url.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">${String(entry.title||entry.url).replace(/[&<>]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</A>`).join('\n');
  await fs.promises.writeFile(result.filePath, `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${safe}\n</DL><p>`, 'utf8');
  return true;
});
ipcMain.handle('browser:extensions', async (event, action, value) => {
  if (!trustedBrowserSender(event)) throw new Error('Unauthorized');
  const ses = session.defaultSession.extensions;
  if (action === 'list') return ses.getAllExtensions().map(({id,name,version,description}) => ({id,name,version,description}));
  if (action === 'add') {
    const result = await dialog.showOpenDialog(win, { title:'Load an unpacked extension', properties:['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const extension = await ses.loadExtension(result.filePaths[0]);
    const paths=readExtensionPaths(); if(!paths.includes(result.filePaths[0])){paths.push(result.filePaths[0]);writeExtensionPaths(paths);}
    return {id:extension.id,name:extension.name,version:extension.version,description:extension.description};
  }
  if (action === 'remove' && typeof value === 'string' && ses.getExtension(value)) { const extension=ses.getExtension(value); ses.removeExtension(value); writeExtensionPaths(readExtensionPaths().filter((extensionPath)=>extensionPath!==extension.path)); return true; }
  throw new Error('Unsupported extension action.');
});

function isTrustedAuthSender(event) { return Boolean(win && !win.isDestroyed() && event.sender === win.webContents); }
ipcMain.handle('auth:get-state', async (event) => {
  if (!isTrustedAuthSender(event)) throw new Error('Unauthorized');
  if (authSession && authSession.expiresAt <= Date.now()) {
    try { await refreshAuthSession(true); } catch (error) { console.warn('Could not refresh saved Firebase session:', error.message); }
  }
  return {
    configured:Boolean(firebaseConfig.FIREBASE_API_KEY),
    googleConfigured:Boolean(firebaseConfig.GOOGLE_OAUTH_CLIENT_ID),
    configHint:firebaseConfigHint(),
    user:publicUser()
  };
});
ipcMain.handle('auth:sign-up', async (event, email, password) => {
  if (!isTrustedAuthSender(event)) throw new Error('Unauthorized');
  try { return await setAuthSession(await firebaseRequest('accounts:signUp',{email,password,returnSecureToken:true})); }
  catch (error) { throw new Error(authErrorMessage(error)); }
});
ipcMain.handle('auth:sign-in', async (event, email, password) => {
  if (!isTrustedAuthSender(event)) throw new Error('Unauthorized');
  try { return await setAuthSession(await firebaseRequest('accounts:signInWithPassword',{email,password,returnSecureToken:true})); }
  catch (error) { throw new Error(authErrorMessage(error)); }
});
ipcMain.handle('auth:google', async (event) => {
  if (!isTrustedAuthSender(event)) throw new Error('Unauthorized');
  try {
    const idToken = await googleDesktopSignIn();
    const data = await firebaseRequest('accounts:signInWithIdp',{
      postBody:new URLSearchParams({id_token:idToken,providerId:'google.com'}).toString(),
      requestUri:'http://localhost',returnSecureToken:true,returnIdpCredential:true
    });
    const user = await setAuthSession(data);
    focusBrowserWindow();
    return user;
  } catch (error) { throw new Error(authErrorMessage(error)); }
});
ipcMain.handle('auth:logout', async (event) => {
  if (!isTrustedAuthSender(event)) throw new Error('Unauthorized');
  await clearAuthSession();
  return true;
});


function extractExternalUrl(args) {
  return args.find((arg) => /^https?:\/\//i.test(arg)) || null;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const externalUrl = extractExternalUrl(commandLine);

    if (!win || win.isDestroyed()) createWindow();
    focusBrowserWindow();

    if (externalUrl) {
      const tab = tabs.find((item) => item.id === activeTabId);
      if (tab) navigateTab(tab, externalUrl);
      else createTab({ activate: true, url: externalUrl });
    }
  });

  app.whenReady().then(async () => {
    firebaseConfig = readFirebaseConfig();
    await loadAuthSession();

    for (const extensionPath of readExtensionPaths()) {
      try {
        await session.defaultSession.extensions.loadExtension(extensionPath);
      } catch (error) {
        console.warn('Could not restore unpacked extension:', error.message);
      }
    }

    createWindow();

    const startupUrl = extractExternalUrl(process.argv);
    if (startupUrl) {
      const tab = tabs.find((item) => item.id === activeTabId);
      if (tab) navigateTab(tab, startupUrl);
    }
  }).catch((error) => {
    console.error('MantraAI Browser failed to start:', error);
    dialog.showErrorBox(
      'MantraAI Browser failed to start',
      error.stack || error.message || String(error)
    );
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
