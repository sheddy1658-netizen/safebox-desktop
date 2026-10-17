const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Load your app's entry point (Change this if your login page is named differently)
    win.loadFile('login.html'); 
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ============================================
// DOWNLOAD HANDLER (Cross-platform Windows/Linux)
// ============================================
ipcMain.on('download-file', (event, url, filename) => {
    // Sanitize filename to prevent invalid characters on Windows
    const safeFilename = filename.replace(/[<>:"/\\|?*]+/g, '_');
    const downloadPath = path.join(app.getPath('downloads'), safeFilename);
    
    if (Notification.isSupported()) {
        new Notification({ title: 'SafeBox', body: `Downloading: ${safeFilename}` }).show();
    }

    let command = '';
    
    if (process.platform === 'win32') {
        // Windows: Use PowerShell to download. This bypasses Node's network timeout issues.
        // The -UseBasicParsing flag prevents it from hanging on older Windows versions.
        command = `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${downloadPath}' -Headers @{'ngrok-skip-browser-warning'='true'} -UseBasicParsing"`;
    } else {
        // Linux/Mac: Use native curl
        command = `curl -L -H "ngrok-skip-browser-warning: true" -o "${downloadPath}" "${url}"`;
    }

    console.log(`Executing download: ${filename}`);

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Download failed: ${error.message}`);
            if (Notification.isSupported()) {
                new Notification({ title: 'SafeBox', body: `Download failed: ${safeFilename}` }).show();
            }
            return;
        }
        
        console.log(`✅ Downloaded to: ${downloadPath}`);
        shell.showItemInFolder(downloadPath);
        
        if (Notification.isSupported()) {
            new Notification({ title: 'SafeBox', body: `Finished downloading: ${safeFilename}` }).show();
        }
    });
});