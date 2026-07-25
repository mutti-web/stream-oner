'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avatarFaceAPI', {
  onConfig: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on('avatar-face-config', listener);
    return () => ipcRenderer.removeListener('avatar-face-config', listener);
  },
  onRecalibrate: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('avatar-face-recalibrate', listener);
    return () => ipcRenderer.removeListener('avatar-face-recalibrate', listener);
  },
  sendPose: (data) => ipcRenderer.send('avatar-face-pose', data),
  sendPreview: (data) => ipcRenderer.send('avatar-face-preview', data),
  sendError: (message) => ipcRenderer.send('avatar-face-error', message),
});
