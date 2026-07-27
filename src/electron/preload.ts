import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  connectCime: () => ipcRenderer.invoke('cime:connect'),
  disconnectCime: () => ipcRenderer.invoke('cime:disconnect'),
  testPalworld: () => ipcRenderer.invoke('palworld:test'),
  preparePalworld: () => ipcRenderer.invoke('palworld:prepare'),
  testEffect: (amount: number) => ipcRenderer.invoke('effect:test', amount),
  testExperimentalEffect: (effect: 'super_jump' | 'random_move') => ipcRenderer.invoke('effect:experimental', effect),
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  },
});
