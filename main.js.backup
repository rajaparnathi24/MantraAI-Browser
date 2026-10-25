const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

let win;
let tabs = [];
let closedTabs = [];
let activeTabId = null;
let nextTabId = 1;
let panelOpen = true;
let downloadItems = [];
const TOOLBAR_HEIGHT = 96;
const PANEL_WIDTH = 366;

const activeTab = () => tabs.find((tab) => tab.id === activeTabId);

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
  if (/^(chrome|devtools):\/\//i.test(value)) return value;
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
  const panelWidth = panelOpen ? Math.min(PANEL_WIDTH, Math.floor(width * .9)) : 0;
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
  view.webContents.on('page-title-updated',(_event,title)=>{ tab.title=title || tab.url || 'New Tab'; publishTabs(); });
  for (const event of ['did-navigate','did-navigate-in-page']) {
    view.webContents.on(event,(_event,url)=>{ tab.url=url || view.webContents.getURL(); tab.home=false; tab.verseHome=false; sendState(); });
  }
  for (const event of ['did-start-loading','did-stop-loading']) view.webContents.on(event,sendState);
  view.webContents.on('did-finish-load',()=>{
    view.webContents.insertCSS('::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}').catch(()=>{});
    sendState();
  });
  view.webContents.on('before-input-event',(event,input)=>browserShortcut(tab,event,input));
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
    webPreferences:{ preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false }
  });
  win.on('resize',resizeBrowser);
  win.on('closed',()=>{ win=null; tabs=[]; activeTabId=null; });
  win.webContents.on('did-finish-load',()=>{ resizeBrowser(); publishTabs(); sendState(); });
  session.defaultSession.on('will-download',(_event,item)=>{
    const download={id:Date.now(),name:item.getFilename(),state:'In progress',received:0,total:item.getTotalBytes()};
    downloadItems.unshift(download);
    const publish=()=>win?.webContents.send('browser:downloads',downloadItems);
    item.on('updated',()=>{ download.received=item.getReceivedBytes(); download.total=item.getTotalBytes(); publish(); });
    item.once('done',(_event,state)=>{ download.state=state==='completed'?'Complete':state==='cancelled'?'Canceled':'Failed'; publish(); });
    publish();
  });
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
  const privateWindow=new BrowserWindow({width:1200,height:800,title:'MantraAI Browser — Incognito',backgroundColor:'#080f1b',icon:path.join(__dirname,'assets','mantraai-logo-transparent.png'),webPreferences:{contextIsolation:true,nodeIntegration:false,session:privateSession}});
  privateWindow.loadURL('https://www.google.com');
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

app.whenReady().then(createWindow).catch((error)=>{
  console.error('MantraAI Browser failed to start:',error);
  dialog.showErrorBox('MantraAI Browser failed to start',error.stack||error.message||String(error));
});
app.on('window-all-closed',()=>{ if(process.platform!=='darwin')app.quit(); });
