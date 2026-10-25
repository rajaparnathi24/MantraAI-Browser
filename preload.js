
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  platform: process.platform,
  navigate: (address) =>
    ipcRenderer.send('browser:navigate', address),
  newTab: () => ipcRenderer.send('browser:new-tab'),
  selectTab: (id) => ipcRenderer.send('browser:select-tab', id),
  closeTab: (id) => ipcRenderer.send('browser:close-tab', id),
  reopenTab: () => ipcRenderer.send('browser:reopen-tab'),

  back: () => ipcRenderer.send('browser:back'),
  forward: () => ipcRenderer.send('browser:forward'),
  reload: () => ipcRenderer.send('browser:reload'),
  showHome: () => ipcRenderer.send('browser:home'),
  setPanelOpen: (open) => ipcRenderer.send('browser:panel-open', open),
  setModalOpen: (open) => ipcRenderer.send('browser:modal-open', open),
  windowAction: (action) => ipcRenderer.send('browser:window-action', action),
  setWindowTheme: (theme) => ipcRenderer.send('browser:window-theme', theme),
  openIncognito: () => ipcRenderer.send('browser:incognito'),
  desktopSite: () => ipcRenderer.send('browser:desktop-site'),
  chooseWallpaper: () => ipcRenderer.invoke('browser:choose-wallpaper'),
  downloadAction: (id, action) => ipcRenderer.invoke('browser:download-action', id, action),
  getDownloads: () => ipcRenderer.invoke('browser:get-downloads'),
  clearSiteData: () => ipcRenderer.invoke('browser:clear-site-data'),
  bookmarkFile: (mode, bookmarks) => ipcRenderer.invoke('browser:choose-bookmark-file', mode, bookmarks),
  extensions: (action, value) => ipcRenderer.invoke('browser:extensions', action, value),
  print: () => ipcRenderer.send('browser:print'),
  newWindow: () => ipcRenderer.send('browser:new-window'),
  zoom: (action) => ipcRenderer.invoke('browser:zoom', action),
  toggleFullscreen: () => ipcRenderer.send('browser:fullscreen'),
  toggleDevTools: () => ipcRenderer.send('browser:devtools'),
  savePage: () => ipcRenderer.invoke('browser:save-page'),
  clipboardAction: (action) => ipcRenderer.send('browser:clipboard-action', action),
  exit: () => ipcRenderer.send('browser:exit'),
  getProcessMetrics: () => ipcRenderer.invoke('browser:get-process-metrics'),
  auth: {
    getState: () => ipcRenderer.invoke('auth:get-state'),
    signUp: (email, password) => ipcRenderer.invoke('auth:sign-up', email, password),
    signIn: (email, password) => ipcRenderer.invoke('auth:sign-in', email, password),
    sendPasswordReset: (email) => ipcRenderer.invoke('auth:reset-password', email),
    signInWithGoogle: () => ipcRenderer.invoke('auth:google'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    onState: (callback) => ipcRenderer.on('auth:state', (_event, user) => callback(user))
  },
  findInPage: (query, forward = true, next = false) => ipcRenderer.send('browser:find', query, forward, next),
  stopFind: () => ipcRenderer.send('browser:stop-find'),

  onState: (callback) => {
    ipcRenderer.on('browser:state', (_event, state) => {
      callback(state);
    });
  },
  onTabs: (callback) => {
    ipcRenderer.on('browser:tabs', (_event, state) => callback(state));
  },
  onShortcut: (callback) => {
    ipcRenderer.on('browser:shortcut', (_event, action) => callback(action));
  },
  onFindResult: (callback) => {
    ipcRenderer.on('browser:find-result', (_event, result) => callback(result));
  },
  onDownloads: (callback) => {
    ipcRenderer.on('browser:downloads', (_event, downloads) => callback(downloads));
  },
});
