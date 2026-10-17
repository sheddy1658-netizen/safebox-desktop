// ============================================
// APP UPDATER - COMPLETE FIX FOR ANDROID WEBVIEW
// ============================================

class AppUpdater {
    constructor() {
        this.currentVersion = '1.0.0';
        this.updateUrl = '';
        this.apiEndpoint = '';
        this.checkInterval = null;
        this.isChecking = false;
        this.updateInfo = null;
        this.downloadProgress = 0;
        this.isDownloading = false;
        this._downloadCancelled = false;
    }

    configure(options) {
        this.currentVersion = options.currentVersion || '1.0.0';
        this.updateUrl = options.updateUrl || '';
        this.apiEndpoint = options.apiEndpoint || '';
        this.appName = options.appName || 'SafeBox';
        return this;
    }

    // ============================================
    // CHECK FOR UPDATES - FIXED
    // ============================================

    async checkForUpdates() {
        if (this.isChecking) return { hasUpdate: false };
        this.isChecking = true;

        try {
            console.log('🔍 Checking for updates...');
            
            // Check if online first
            if (!navigator.onLine) {
                console.log('📡 Offline - skipping update check');
                return { hasUpdate: false, error: 'Offline' };
            }
            
            // Use a timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(this.apiEndpoint, {
                headers: {
                    'Cache-Control': 'no-cache'
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error('Failed to fetch version info: ' + response.status);
            }
            
            const data = await response.json();
            console.log('📦 Server response:', data);
            
            if (data.version && this.isNewerVersion(data.version)) {
                return {
                    hasUpdate: true,
                    version: data.version,
                    releaseNotes: data.releaseNotes || 'New version available!',
                    downloadUrl: data.downloadUrl || this.updateUrl,
                    forceUpdate: data.forceUpdate || false,
                    fileSize: data.fileSize || 'Unknown'
                };
            }

            return { hasUpdate: false };

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('⏱️ Update check timed out');
            } else {
                console.error('Update check error:', error);
            }
            return { hasUpdate: false, error: error.message };
        } finally {
            this.isChecking = false;
        }
    }

    isNewerVersion(newVersion) {
        try {
            const current = this.currentVersion.split('.').map(Number);
            const newVer = newVersion.split('.').map(Number);
            
            for (let i = 0; i < Math.max(current.length, newVer.length); i++) {
                const c = current[i] || 0;
                const n = newVer[i] || 0;
                if (n > c) return true;
                if (n < c) return false;
            }
            return false;
        } catch (error) {
            console.error('Version comparison error:', error);
            return false;
        }
    }

    // ============================================
    // DOWNLOAD UPDATE - FIXED for Android WebView
    // ============================================

    async downloadUpdate(downloadUrl, onProgress) {
        if (this.isDownloading) return { success: false, message: 'Download already in progress' };
        this.isDownloading = true;
        this.downloadProgress = 0;
        this._downloadCancelled = false;

        try {
            console.log('📥 Downloading update from:', downloadUrl);
            
            // Check if online
            if (!navigator.onLine) {
                throw new Error('No internet connection');
            }
            
            // Show download UI
            this.showDownloadProgress();
            
            // Use fetch with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            const response = await fetch(downloadUrl, {
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error('Failed to download: ' + response.status);
            }
            
            // Get total size
            const contentLength = response.headers.get('content-length');
            const totalSize = contentLength ? parseInt(contentLength) : 0;
            
            // Read as stream
            const reader = response.body.getReader();
            const chunks = [];
            let downloaded = 0;
            
            while (true) {
                if (this._downloadCancelled) {
                    reader.cancel();
                    throw new Error('Download cancelled');
                }
                
                const { done, value } = await reader.read();
                if (done) break;
                
                chunks.push(value);
                downloaded += value.length;
                
                if (totalSize > 0) {
                    this.downloadProgress = Math.min((downloaded / totalSize) * 100, 100);
                    this.updateDownloadProgress(this.downloadProgress);
                    
                    if (onProgress) {
                        onProgress(this.downloadProgress);
                    }
                }
            }
            
            // Combine chunks
            const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
            
            // FIXED: Use Android bridge for download if available
            const saved = await this.saveFileToDevice(blob);
            
            this.isDownloading = false;
            this.hideDownloadProgress();
            
            if (saved) {
                this.showToast('✅ Update downloaded to Downloads/SafeBox', 'success');
                return { 
                    success: true, 
                    message: 'Download complete. Please install the APK.',
                    file: blob
                };
            } else {
                // Fallback: Use browser download
                await this.browserDownload(blob);
                return { 
                    success: true, 
                    message: 'Download complete. Please install the APK.',
                    file: blob
                };
            }

        } catch (error) {
            console.error('Download error:', error);
            this.isDownloading = false;
            this.hideDownloadProgress();
            
            let errorMsg = error.message || 'Download failed';
            if (error.name === 'AbortError') {
                errorMsg = 'Download timed out';
            }
            
            this.showToast('❌ ' + errorMsg, 'error');
            return { success: false, message: errorMsg };
        }
    }

    // ============================================
    // SAVE FILE TO DEVICE (Android Bridge)
    // ============================================

    async saveFileToDevice(blob) {
        try {
            // Check if Android bridge is available
            if (typeof window.Android !== 'undefined' && window.Android.saveFileToDevice) {
                console.log('📱 Using Android bridge to save APK');
                
                // Convert blob to base64
                const reader = new FileReader();
                const base64 = await new Promise((resolve, reject) => {
                    reader.onload = function() {
                        const result = reader.result;
                        const base64Data = result.split(',')[1];
                        resolve(base64Data);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                
                if (!base64 || base64.length === 0) {
                    throw new Error('Failed to convert to base64');
                }
                
                const fileName = 'safebox_update_' + this.currentVersion + '.apk';
                const result = window.Android.saveFileToDevice(fileName, base64, 'application/vnd.android.package-archive');
                
                if (result === true) {
                    console.log('✅ APK saved via Android bridge');
                    return true;
                } else {
                    console.warn('Android bridge save returned false');
                    return false;
                }
            }
            
            console.log('📱 Android bridge not available, using browser download');
            return false;
            
        } catch (error) {
            console.error('Android bridge save error:', error);
            return false;
        }
    }

    // ============================================
    // BROWSER DOWNLOAD FALLBACK
    // ============================================

    async browserDownload(blob) {
        try {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'safebox_update.apk';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            console.log('✅ APK downloaded via browser');
            return true;
        } catch (error) {
            console.error('Browser download error:', error);
            throw error;
        }
    }

    // ============================================
    // DOWNLOAD AND INSTALL
    // ============================================

    async downloadAndInstall() {
        if (!this.updateInfo) {
            const result = await this.checkForUpdates();
            if (!result.hasUpdate) {
                this.showToast('No update available', 'info');
                return;
            }
            this.updateInfo = result;
        }

        const result = await this.downloadUpdate(this.updateInfo.downloadUrl);

        if (result.success) {
            // Show installation instructions
            setTimeout(() => {
                this.showToast('📱 Please open the downloaded APK to install', 'info');
            }, 2000);
        }
    }

    // ============================================
    // SHOW UPDATE NOTIFICATION - FIXED
    // ============================================

    showUpdateNotification(updateInfo) {
        const existing = document.getElementById('updateNotification');
        if (existing) existing.remove();

        const dismissed = localStorage.getItem('update_dismissed_' + updateInfo.version);
        if (dismissed === 'true') return;

        this.updateInfo = updateInfo;

        const notification = document.createElement('div');
        notification.id = 'updateNotification';
        notification.innerHTML = `
            <div style="
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%);
                background: white;
                color: #333;
                padding: 20px;
                border-radius: 16px;
                box-shadow: 0 8px 40px rgba(0,0,0,0.2);
                z-index: 999999;
                max-width: 90%;
                width: 380px;
                animation: slideUp 0.4s ease;
                border-left: 4px solid #6C63FF;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                    <span style="font-size:28px;">🔄</span>
                    <div>
                        <div style="font-weight:700;font-size:17px;">Update Available!</div>
                        <div style="font-size:12px;color:#6a7a8e;">
                            Version ${updateInfo.version} 
                            ${updateInfo.fileSize ? '• ' + updateInfo.fileSize : ''}
                        </div>
                    </div>
                </div>
                <div style="font-size:13px;color:#6a7a8e;margin:8px 0;white-space:pre-line;max-height:120px;overflow-y:auto;background:#f8f9ff;padding:10px;border-radius:8px;">
                    ${updateInfo.releaseNotes || 'New update available with improvements and bug fixes.'}
                </div>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button onclick="appUpdater.downloadAndInstall()" style="
                        flex:1;
                        background: #6C63FF;
                        color: white;
                        border: none;
                        padding: 12px;
                        border-radius: 50px;
                        font-weight: 600;
                        cursor: pointer;
                        font-size: 14px;
                        font-family: inherit;
                    ">
                        📥 Download Update
                    </button>
                    ${!updateInfo.forceUpdate ? `
                        <button onclick="appUpdater.dismissUpdate()" style="
                            flex:1;
                            background: #f0f2f8;
                            color: #333;
                            border: none;
                            padding: 12px;
                            border-radius: 50px;
                            font-weight: 600;
                            cursor: pointer;
                            font-size: 14px;
                            font-family: inherit;
                        ">
                            Later
                        </button>
                    ` : ''}
                </div>
                ${updateInfo.forceUpdate ? `
                    <div style="font-size:12px;color:#dc3545;margin-top:8px;text-align:center;font-weight:600;">
                        ⚠️ This update is required
                    </div>
                ` : ''}
            </div>
            <style>
                @keyframes slideUp {
                    from { transform: translateX(-50%) translateY(40px); opacity: 0; }
                    to { transform: translateX(-50%) translateY(0); opacity: 1; }
                }
            </style>
        `;
        document.body.appendChild(notification);

        if (updateInfo.forceUpdate) {
            setTimeout(() => {
                this.downloadAndInstall();
            }, 10000);
        }
    }

    dismissUpdate() {
        const notification = document.getElementById('updateNotification');
        if (notification) {
            notification.remove();
        }
        if (this.updateInfo) {
            localStorage.setItem('update_dismissed_' + this.updateInfo.version, 'true');
        }
        this.showToast('⏳ Update dismissed', 'info');
    }

    // ============================================
    // DOWNLOAD PROGRESS UI
    // ============================================

    showDownloadProgress() {
        const existing = document.getElementById('updateProgress');
        if (existing) existing.remove();

        const progress = document.createElement('div');
        progress.id = 'updateProgress';
        progress.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: white;
            padding: 20px;
            border-radius: 16px;
            box-shadow: 0 8px 40px rgba(0,0,0,0.2);
            z-index: 999999;
            min-width: 280px;
            max-width: 90%;
            text-align: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        progress.innerHTML = `
            <h4 style="margin-bottom:8px;font-family:inherit;">📥 Downloading Update...</h4>
            <div style="width:100%;height:8px;background:#e0e5f0;border-radius:4px;overflow:hidden;">
                <div id="updateProgressBar" style="height:100%;background:#6C63FF;border-radius:4px;transition:width 0.3s;width:0%;"></div>
            </div>
            <p id="updateProgressText" style="font-size:12px;color:#6a7a8e;margin-top:8px;font-family:inherit;">0%</p>
            <button onclick="appUpdater.cancelDownload()" style="
                margin-top:8px;
                background: #dc3545;
                color: white;
                border: none;
                padding: 4px 12px;
                border-radius: 50px;
                font-size: 12px;
                cursor: pointer;
                font-family: inherit;
            ">Cancel</button>
        `;
        document.body.appendChild(progress);
    }

    updateDownloadProgress(percent) {
        const bar = document.getElementById('updateProgressBar');
        const text = document.getElementById('updateProgressText');
        if (bar) bar.style.width = Math.min(percent, 100) + '%';
        if (text) text.textContent = Math.round(percent) + '%';
    }

    hideDownloadProgress() {
        const el = document.getElementById('updateProgress');
        if (el) {
            el.style.transition = 'opacity 0.3s, transform 0.3s';
            el.style.opacity = '0';
            el.style.transform = 'translateX(-50%) translateY(30px)';
            setTimeout(() => {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 300);
        }
    }

    cancelDownload() {
        this._downloadCancelled = true;
        this.isDownloading = false;
        this.hideDownloadProgress();
        this.showToast('⛔ Download cancelled', 'warning');
    }

    // ============================================
    // AUTO CHECK
    // ============================================

    startAutoCheck(interval = 3600000) {
        if (this.checkInterval) return;
        
        // Check after 5 seconds
        setTimeout(() => {
            this.checkAndNotify();
        }, 5000);

        // Then check periodically
        this.checkInterval = setInterval(() => {
            this.checkAndNotify();
        }, interval);
        
        console.log('🔄 Auto-update checker started (interval: ' + (interval / 60000) + ' min)');
    }

    async checkAndNotify() {
        const result = await this.checkForUpdates();
        if (result.hasUpdate) {
            const dismissed = localStorage.getItem('update_dismissed_' + result.version);
            if (dismissed !== 'true') {
                this.updateInfo = result;
                this.showUpdateNotification(result);
            }
        }
        return result;
    }

    stopAutoCheck() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log('🔄 Auto-update checker stopped');
        }
    }

    async manualCheck() {
        const btn = document.getElementById('checkUpdateBtn');
        if (btn) {
            btn.textContent = '⏳ Checking...';
            btn.disabled = true;
        }
        
        const result = await this.checkAndNotify();
        
        if (btn) {
            btn.textContent = '🔄 Check Update';
            btn.disabled = false;
        }
        
        if (!result.hasUpdate) {
            this.showToast('✅ You have the latest version (' + this.currentVersion + ')', 'success');
        }
        
        return result;
    }

    // ============================================
    // TOAST - Uses global toast from app.js
    // ============================================

    showToast(msg, type = 'info') {
        // Use global toast function from app.js if available
        if (typeof window.toast === 'function') {
            window.toast(msg, type);
            return;
        }
        
        // Fallback toast implementation
        let el = document.getElementById('toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast';
            el.style.cssText = `
                position: fixed;
                bottom: 150px;
                left: 50%;
                transform: translateX(-50%) translateY(20px);
                background: #1e293b;
                color: white;
                padding: 12px 24px;
                border-radius: 50px;
                font-size: 14px;
                z-index: 999999;
                opacity: 0;
                transition: all 0.3s;
                pointer-events: none;
                max-width: 90%;
                text-align: center;
                box-shadow: 0 8px 24px rgba(0,0,0,0.2);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            `;
            document.body.appendChild(el);
        }
        
        const colors = { success: '#28a745', error: '#dc3545', warning: '#ffc107', info: '#1e293b' };
        el.style.background = colors[type] || colors.info;
        el.style.color = type === 'warning' ? '#000' : '#fff';
        
        el.textContent = msg;
        el.style.opacity = '1';
        el.style.transform = 'translateX(-50%) translateY(0)';
        clearTimeout(el._timeout);
        el._timeout = setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 300);
        }, 5000);
    }
}

const appUpdater = new AppUpdater();
window.appUpdater = appUpdater;

console.log('🔄 App updater loaded');
console.log('✅ Android bridge support for APK downloads');
console.log('✅ Offline mode detection');
console.log('✅ Timeout protection for update checks');