import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  connectChzzk: () => ipcRenderer.invoke('chzzk:connect'),
  disconnectChzzk: () => ipcRenderer.invoke('chzzk:disconnect'),
  testPalworld: () => ipcRenderer.invoke('palworld:test'),
  preparePalworld: () => ipcRenderer.invoke('palworld:prepare'),
  testEffect: (amount: number) => ipcRenderer.invoke('effect:test', amount),
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  },
});
