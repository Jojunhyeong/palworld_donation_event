import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config: unknown) => ipcRenderer.invoke('config:save', config),
  connectChzzk: () => ipcRenderer.invoke('chzzk:connect'),
  disconnectChzzk: () => ipcRenderer.invoke('chzzk:disconnect'),
  savePalworldConfig: (config: unknown) => ipcRenderer.invoke('palworld:save', config),
  testPalworld: () => ipcRenderer.invoke('palworld:test'),
  testEffect: (amount: number) => ipcRenderer.invoke('effect:test', amount),
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  },
});
