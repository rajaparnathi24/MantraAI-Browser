
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
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
  windowAction: (action) => ipcRenderer.send('browser:window-action', action),
  openIncognito: () => ipcRenderer.send('browser:incognito'),
  desktopSite: () => ipcRenderer.send('browser:desktop-site'),
  chooseWallpaper: () => ipcRenderer.invoke('browser:choose-wallpaper'),
  print: () => ipcRenderer.send('browser:print'),
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
  }
});
