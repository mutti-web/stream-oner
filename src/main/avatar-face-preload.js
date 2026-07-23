'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avatarFaceAPI', {
  onConfig: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on('avatar-face-config', listener);
    return () => ipcRenderer.removeListener('avatar-face-config', listener);
  },
  sendPose: (data) => ipcRenderer.send('avatar-face-pose', data),
  sendError: (message) => ipcRenderer.send('avatar-face-error', message),
});
