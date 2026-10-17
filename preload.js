const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('Android', {
    startMonitoredDownload: (url, filename, mimeType, fileId) => {
        ipcRenderer.send('download-file', url, filename);
    },
    downloadFileToSafeBox: (url, filename, mimeType) => {
        ipcRenderer.send('download-file', url, filename);
    },
    scheduleBackgroundSync: (minutes) => {
        console.log(`[Desktop] Background sync scheduled for ${minutes} mins`);
    },
    cancelBackgroundSync: () => {
        console.log(`[Desktop] Background sync cancelled`);
    }
});
