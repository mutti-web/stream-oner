'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avatarCaptureAPI', {
  onConfig: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on('avatar-capture-config', listener);
    return () => ipcRenderer.removeListener('avatar-capture-config', listener);
  },
  sendLevels: (data) => ipcRenderer.send('avatar-audio-levels', data),
  sendError: (message) => ipcRenderer.send('avatar-audio-error', message),
});
