import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setMode: (mode: 'personal' | 'party-host') => ipcRenderer.invoke('mode:set', mode),
  connectChzzk: () => ipcRenderer.invoke('chzzk:connect'),
  disconnectChzzk: () => ipcRenderer.invoke('chzzk:disconnect'),
  testPalworld: () => ipcRenderer.invoke('palworld:test'),
  preparePalworld: () => ipcRenderer.invoke('palworld:prepare'),
  testEffect: (amount: number) => ipcRenderer.invoke('effect:test', amount),
  startParty: () => ipcRenderer.invoke('party:start'),
  stopParty: () => ipcRenderer.invoke('party:stop'),
  removePartyMember: (memberId: string) => ipcRenderer.invoke('party:remove-member', memberId),
  listPalworldPlayers: () => ipcRenderer.invoke('party:list-players'),
  testPartyTarget: (playerName: string) => ipcRenderer.invoke('party:test-target', playerName),
  copyText: (value: string) => ipcRenderer.invoke('clipboard:write', value),
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  },
});
