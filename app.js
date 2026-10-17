// ============================================
// APP.JS - MAIN APPLICATION LOGIC
// WITH SYNC, SHARING, AND NGROK INTEGRATION
// LIVE SYNC: 20s foreground polling + pause/resume + events
// ============================================

// ============================================
// TOAST FUNCTION
// ============================================

function toast(msg, type = 'info') {
    const existing = document.querySelector('.toast-global');
    if (existing) existing.remove();
    
    const colors = { 
        success: '#10b981', 
        error: '#ef4444', 
        warning: '#f59e0b', 
        info: '#667eea' 
    };
    
    const toastEl = document.createElement('div');
    toastEl.className = 'toast-global';
    toastEl.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: #1e293b;
        color: white;
        padding: 12px 24px;
        border-radius: 50px;
        font-size: 14px;
        z-index: 999999;
        opacity: 0;
        transition: all 0.3s ease;
        pointer-events: none;
        max-width: 90%;
        text-align: center;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        border-left: 4px solid ${colors[type] || colors.info};
    `;
    toastEl.textContent = msg;
    document.body.appendChild(toastEl);
    
    requestAnimationFrame(() => {
        toastEl.style.opacity = '1';
        toastEl.style.transform = 'translateX(-50%) translateY(0)';
    });
    
    setTimeout(() => {
        toastEl.style.opacity = '0';
        toastEl.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => {
            if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
        }, 300);
    }, 3000);
}

function showToast(msg, type = 'info') {
    toast(msg, type);
}

// ============================================
// SESSION MANAGEMENT
// ============================================

function saveUserSession(userData) {
    try {
        if (!userData || !userData.id || !userData.username) {
            console.warn('Invalid user data for session');
            return false;
        }
        
        localStorage.setItem('user_id', String(userData.id));
        localStorage.setItem('username', userData.username);
        localStorage.setItem('user_session', JSON.stringify({
            id: userData.id,
            username: userData.username,
            loginTime: new Date().toISOString(),
            expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }));
        sessionStorage.setItem('user_session', JSON.stringify({
            id: userData.id,
            username: userData.username
        }));
        console.log('✅ User session saved');
        return true;
    } catch (error) {
        console.error('Session save error:', error);
        return false;
    }
}

function getUserSession() {
    try {
        let sessionData = sessionStorage.getItem('user_session');
        if (sessionData) {
            try {
                return JSON.parse(sessionData);
            } catch (e) {
                console.warn('Invalid session data in sessionStorage');
            }
        }
        
        const userData = localStorage.getItem('user_session');
        if (userData) {
            try {
                const parsed = JSON.parse(userData);
                if (new Date(parsed.expires) > new Date()) {
                    sessionStorage.setItem('user_session', JSON.stringify({
                        id: parsed.id,
                        username: parsed.username
                    }));
                    return parsed;
                } else {
                    localStorage.removeItem('user_session');
                    localStorage.removeItem('user_id');
                    localStorage.removeItem('username');
                }
            } catch (e) {
                console.warn('Invalid session data in localStorage');
            }
        }
        return null;
    } catch (error) {
        console.error('Session get error:', error);
        return null;
    }
}

function clearUserSession() {
    try {
        localStorage.removeItem('user_id');
        localStorage.removeItem('username');
        localStorage.removeItem('user_session');
        localStorage.removeItem('saved_username');
        localStorage.removeItem('saved_password');
        localStorage.removeItem('remember_me');
        sessionStorage.removeItem('user_session');
        console.log('👋 User session cleared');
    } catch (error) {
        console.error('Clear session error:', error);
    }
}

// ============================================
// AUTO-LOGIN SYSTEM
// ============================================

function checkAutoLogin() {
    try {
        const session = getUserSession();
        if (session && session.id && session.username) {
            console.log('🔄 Auto-login active for user:', session.username);
            return true;
        }
        
        const savedUsername = localStorage.getItem('saved_username');
        const savedPassword = localStorage.getItem('saved_password');
        const rememberMe = localStorage.getItem('remember_me');
        
        if (savedUsername && savedPassword && rememberMe === 'true') {
            console.log('🔄 Saved credentials found');
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Auto-login check error:', error);
        return false;
    }
}

function ensureLoggedIn() {
    try {
        const user = getCurrentUser();
        const session = getUserSession();
        const userId = localStorage.getItem('user_id');
        const username = localStorage.getItem('username');
        
        if (user || session || (userId && username)) {
            console.log('✅ User is logged in');
            if (userId && username && !user) {
                localStorage.setItem('user_id', userId);
                localStorage.setItem('username', username);
                sessionStorage.setItem('user_session', JSON.stringify({
                    id: parseInt(userId),
                    username: username,
                    loginTime: new Date().toISOString()
                }));
            }
            return true;
        }
        
        console.log('❌ No user session found');
        return false;
    } catch (error) {
        console.error('Ensure logged in error:', error);
        return false;
    }
}

// ============================================
// SYNC STATUS UI
// ============================================

function updateSyncStatusUI(status) {
    let syncEl = document.getElementById('syncStatusIndicator');
    
    if (!syncEl) {
        syncEl = document.createElement('div');
        syncEl.id = 'syncStatusIndicator';
        syncEl.style.cssText = `
            position: fixed;
            top: 12px;
            right: 12px;
            background: rgba(107, 114, 128, 0.9);
            color: #fff;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            z-index: 999;
            display: flex;
            align-items: center;
            gap: 6px;
            backdrop-filter: blur(8px);
            transition: all 0.3s;
            border: 1px solid rgba(255,255,255,0.1);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            cursor: pointer;
        `;
        syncEl.title = 'Tap to sync now';
        syncEl.onclick = () => triggerSync();
        document.body.appendChild(syncEl);
    }
    
    const states = {
        online: { color: 'rgba(16, 185, 129, 0.9)', text: 'Online', icon: '✅', textColor: '#fff' },
        offline: { color: 'rgba(245, 158, 11, 0.9)', text: 'Offline', icon: '📡', textColor: '#000' },
        syncing: { color: 'rgba(102, 126, 234, 0.9)', text: 'Syncing...', icon: '🔄', textColor: '#fff' },
        error: { color: 'rgba(239, 68, 68, 0.9)', text: 'Sync error', icon: '⚠️', textColor: '#fff' }
    };
    
    const state = states[status] || states.offline;
    syncEl.style.background = state.color;
    syncEl.style.color = state.textColor;
    syncEl.innerHTML = `<span>${state.icon}</span><span>${state.text}</span>`;
}

async function checkServerStatus() {
    try {
        if (typeof isServerOnline !== 'function') {
            updateSyncStatusUI('offline');
            return false;
        }
        
        const online = await isServerOnline();
        updateSyncStatusUI(online ? 'online' : 'offline');
        return online;
    } catch (e) {
        updateSyncStatusUI('offline');
        return false;
    }
}

// ============================================
// MANUAL SYNC TRIGGER
// ============================================

async function triggerSync() {
    if (typeof fullSync !== 'function') {
        toast('❌ Sync not available', 'error');
        return;
    }

    updateSyncStatusUI('syncing');

    try {
        const result = await fullSync();

        if (result.success) {
            updateSyncStatusUI('online');
            toast(`✅ ${result.message || 'Sync complete'}`, 'success');
            // fullSync dispatches `filesSynced` — page listeners re-render automatically.
        } else {
            updateSyncStatusUI(result.message === 'Server offline' ? 'offline' : 'error');
            toast(`⚠️ ${result.message}`, 'warning');
        }

        return result;
    } catch (e) {
        updateSyncStatusUI('error');
        toast('❌ Sync failed: ' + e.message, 'error');
    }
}

// ============================================
// VIEW FILE
// ============================================

function viewFile(id) {
    if (!id) {
        toast('❌ No file selected', 'error');
        return;
    }
    console.log('👁️ Viewing file ID:', id);
    window.location.href = `view.html?id=${id}`;
}

// ============================================
// GET FILE FROM DATABASE
// ============================================

async function getFileFromDB(id) {
    try {
        if (typeof openDB !== 'function') {
            console.error('openDB function not available');
            toast('❌ Database not initialized', 'error');
            return null;
        }
        
        const db = await openDB();
        const user = getCurrentUser();
        if (!user) {
            console.warn('No user found');
            return null;
        }
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.FILES], 'readonly');
            const store = transaction.objectStore(STORES.FILES);
            const request = store.get(id);
            
            request.onsuccess = async () => {
                const file = request.result;
                if (file && file.blob) {
                    const isPdf = file.extension === 'pdf' || 
                                 (file.original_name || '').toLowerCase().endsWith('.pdf') ||
                                 file.mime_type === 'application/pdf';
                    
                    if (isPdf) {
                        if (file.blob.type !== 'application/pdf') {
                            try {
                                const arrayBuffer = await file.blob.arrayBuffer();
                                file.blob = new Blob([arrayBuffer], { type: 'application/pdf' });
                            } catch (e) {
                                console.error('Error fixing PDF blob:', e);
                            }
                        }
                        file.mime_type = 'application/pdf';
                    }
                    resolve(file);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => {
                console.error('Get file error:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('getFile error:', error);
        toast('❌ Error loading file: ' + error.message, 'error');
        return null;
    }
}

// ============================================
// DOWNLOAD FILE
// ============================================

async function downloadFile(id) {
    try {
        const file = await getFileFromDB(id);
        if (!file) {
            toast('❌ File not found', 'error');
            return;
        }

        let blob = file.blob;
        if (!blob) {
            toast('❌ File data not available', 'error');
            return;
        }

        let fileName = file.original_name || 'file_' + id;
        let mimeType = file.mime_type || 'application/octet-stream';
        
        const extension = fileName.split('.').pop().toLowerCase();
        const mimeMap = {
            'pdf': 'application/pdf', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp',
            'mp4': 'video/mp4', 'webm': 'video/webm', 'avi': 'video/x-msvideo',
            'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'ppt': 'application/vnd.ms-powerpoint', 'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'txt': 'text/plain', 'html': 'text/html', 'css': 'text/css',
            'js': 'application/javascript', 'json': 'application/json'
        };
        
        if (mimeMap[extension]) mimeType = mimeMap[extension];

        if (extension === 'pdf' || mimeType === 'application/pdf') {
            if (!fileName.toLowerCase().endsWith('.pdf')) fileName = fileName + '.pdf';
            if (blob.type !== 'application/pdf') {
                try {
                    const arrayBuffer = await blob.arrayBuffer();
                    blob = new Blob([arrayBuffer], { type: 'application/pdf' });
                } catch (e) {}
            }
        }

        showDownloadProgress(fileName);

        if (typeof window.Android !== 'undefined' && window.Android.saveFileToDevice) {
            try {
                const reader = new FileReader();
                const base64 = await new Promise((resolve, reject) => {
                    reader.onload = function() {
                        const result = reader.result;
                        resolve(result.split(',')[1]);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                
                if (!base64 || base64.length === 0) throw new Error('Failed to convert file');
                
                const result = window.Android.saveFileToDevice(fileName, base64, mimeType);
                hideDownloadProgress();
                
                if (result === true) {
                    toast('✅ Saved to Downloads/SafeBox', 'success');
                    return;
                } else {
                    await browserDownload(blob, fileName);
                    return;
                }
            } catch (error) {
                console.error('Android save error:', error);
                hideDownloadProgress();
                await browserDownload(blob, fileName);
                return;
            }
        }

        await browserDownload(blob, fileName);

    } catch (error) {
        console.error('Download error:', error);
        hideDownloadProgress();
        toast('❌ Download failed: ' + error.message, 'error');
    }
}

async function browserDownload(blob, fileName) {
    try {
        let mimeType = blob.type || 'application/octet-stream';
        
        if (fileName.toLowerCase().endsWith('.pdf') && mimeType !== 'application/pdf') {
            try {
                const arrayBuffer = await blob.arrayBuffer();
                blob = new Blob([arrayBuffer], { type: 'application/pdf' });
                mimeType = 'application/pdf';
            } catch (e) {}
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        hideDownloadProgress();
        toast('✅ Downloaded: ' + fileName, 'success');
    } catch (error) {
        console.error('Browser download error:', error);
        throw error;
    }
}

// ============================================
// SHARE MODAL
// ============================================

function openShareModal(fileId) {
    let modal = document.getElementById('shareModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'shareModal';
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            backdrop-filter: blur(4px);
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        modal.innerHTML = `
            <div style="
                background: #1e293b;
                border-radius: 16px;
                padding: 24px;
                max-width: 440px;
                width: 100%;
                color: white;
                box-shadow: 0 30px 80px rgba(0,0,0,0.5);
                border: 1px solid rgba(255,255,255,0.08);
            ">
                <h3 style="margin:0 0 16px;color:#667eea;font-size:18px;">📤 Share File</h3>
                
                <label style="display:block;font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:6px;">
                    Recipient Username
                </label>
                <input type="text" id="shareRecipient" placeholder="Enter username..." 
                    style="width:100%;padding:12px;background:rgba(255,255,255,0.06);
                    border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;
                    font-size:14px;outline:none;font-family:inherit;box-sizing:border-box;"
                    autocomplete="off">
                
                <label style="display:block;font-size:13px;color:rgba(255,255,255,0.6);margin:14px 0 6px;">
                    Message (optional)
                </label>
                <textarea id="shareMessage" placeholder="Add a message..." rows="3"
                    style="width:100%;padding:12px;background:rgba(255,255,255,0.06);
                    border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;
                    font-size:14px;outline:none;font-family:inherit;resize:vertical;
                    box-sizing:border-box;"></textarea>
                
                <div id="shareStatus" style="margin-top:12px;font-size:13px;"></div>
                
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
                    <button onclick="closeShareModal()" style="
                        padding:10px 20px;background:rgba(239,68,68,0.2);color:#ef4444;
                        border:none;border-radius:8px;font-weight:600;cursor:pointer;
                        font-family:inherit;font-size:13px;
                    ">Cancel</button>
                    <button onclick="confirmShare()" id="shareConfirmBtn" style="
                        padding:10px 24px;background:#667eea;color:white;
                        border:none;border-radius:8px;font-weight:600;cursor:pointer;
                        font-family:inherit;font-size:13px;
                    ">📤 Share</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    document.getElementById('shareRecipient').value = '';
    document.getElementById('shareMessage').value = '';
    document.getElementById('shareStatus').innerHTML = '';
    document.getElementById('shareConfirmBtn').dataset.fileId = fileId;
    
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('shareRecipient').focus(), 100);
}

function closeShareModal() {
    const modal = document.getElementById('shareModal');
    if (modal) modal.style.display = 'none';
}

async function confirmShare() {
    const btn = document.getElementById('shareConfirmBtn');
    const fileId = parseInt(btn.dataset.fileId);
    const recipient = document.getElementById('shareRecipient').value.trim();
    const message = document.getElementById('shareMessage').value.trim();
    const statusEl = document.getElementById('shareStatus');
    
    if (!recipient) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ Enter a recipient username</span>';
        return;
    }
    
    if (!fileId) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ No file selected</span>';
        return;
    }
    
    btn.disabled = true;
    btn.textContent = '⏳ Sharing...';
    statusEl.innerHTML = '<span style="color:#667eea;">⏳ Sending share request...</span>';
    
    try {
        if (typeof shareFile !== 'function') {
            throw new Error('Share function not available');
        }
        
        const result = await shareFile(fileId, recipient, message);
        
        if (result.success) {
            statusEl.innerHTML = `<span style="color:#10b981;">✅ ${result.message}</span>`;
            toast(result.message, 'success');
            
            setTimeout(() => {
                closeShareModal();
            }, 1200);
        } else {
            statusEl.innerHTML = `<span style="color:#ef4444;">❌ ${result.message}</span>`;
        }
    } catch (e) {
        statusEl.innerHTML = `<span style="color:#ef4444;">❌ ${e.message}</span>`;
    } finally {
        btn.disabled = false;
        btn.textContent = '📤 Share';
    }
}

// ============================================
// RECEIVED FILES VIEW
// ============================================

async function loadReceivedFiles() {
    const grid = document.getElementById('receivedGrid') || document.getElementById('fileGrid');
    if (!grid) return;
    
    try {
        if (typeof getSharedFiles !== 'function') {
            grid.innerHTML = '<div class="empty-state"><h3>Shared files not available</h3></div>';
            return;
        }
        
        const shares = await getSharedFiles();
        
        if (!shares || shares.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <span class="icon">📭</span>
                    <h3>No files shared with you</h3>
                    <p style="color:#6a7a8e;">Files shared by others will appear here</p>
                </div>
            `;
            return;
        }
        
        grid.innerHTML = shares.map(share => {
            const file = share.file || {};
            const name = (file.original_name || 'Unnamed').replace(/"/g, '&quot;');
            const icon = typeof getFileIcon === 'function' ? getFileIcon(file) : '📄';
            const size = typeof formatSize === 'function' ? formatSize(file.size || 0) : '0 B';
            const from = share.sender_username || 'Unknown';
            const message = share.message ? `<div style="font-size:11px;color:#6a7a8e;font-style:italic;margin-top:4px;">"${share.message}"</div>` : '';
            
            return `
                <div class="file-card" data-id="${share.id}" style="border-left:3px solid #667eea;">
                    <div class="file-icon">${icon}</div>
                    <div class="file-name" title="${name}">${name}</div>
                    <div class="file-size">${size}</div>
                    <div style="font-size:11px;color:#667eea;font-weight:600;">👤 From: ${from}</div>
                    ${message}
                    <div class="file-actions">
                        <button onclick="acceptSharedFileHandler(${share.id})" class="btn btn-view" title="Accept">✅</button>
                        <button onclick="viewSharedFile(${share.file_id})" class="btn btn-view" title="View">👁️</button>
                        <button onclick="downloadSharedFile(${share.file_id})" class="btn btn-download" title="Download">⬇️</button>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (e) {
        console.error('Load received files error:', e);
        grid.innerHTML = `<div class="empty-state"><h3>Error: ${e.message}</h3></div>`;
    }
}

async function acceptSharedFileHandler(shareId) {
    if (typeof acceptSharedFile !== 'function') {
        toast('❌ Accept not available', 'error');
        return;
    }
    
    try {
        const result = await acceptSharedFile(shareId);
        toast(result.message, result.success ? 'success' : 'error');
        if (result.success) {
            await loadReceivedFiles();
            await updateDashboardCounts();
        }
    } catch (e) {
        toast('❌ ' + e.message, 'error');
    }
}

async function viewSharedFile(fileId) {
    if (typeof viewFile === 'function') {
        viewFile(fileId);
    } else {
        window.location.href = `view.html?id=${fileId}`;
    }
}

async function downloadSharedFile(fileId) {
    if (typeof downloadFile === 'function') {
        await downloadFile(fileId);
    }
}

// ============================================
// REFRESH FILES
// ============================================

async function refreshFiles() {
    console.log('🔄 Refreshing files...');
    const user = getCurrentUser();
    if (!user) {
        console.log('❌ No user logged in');
        return [];
    }
    
    try {
        if (typeof getFiles !== 'function') {
            console.error('getFiles not available');
            return [];
        }
        
        const files = await getFiles(currentFilter || 'all');
        currentFiles = files;
        console.log('📁 Loaded', files.length, 'files');
        return files;
    } catch (error) {
        console.error('Refresh error:', error);
        return [];
    }
}

// ============================================
// FILE PAGE
// ============================================

let currentFiles = [];
let currentFilter = 'all';

async function initFiles() {
    console.log('🚀 Initializing files page...');
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'login.html';
        return;
    }
    
    if (typeof getFiles !== 'function') {
        toast('❌ Database not initialized', 'error');
        return;
    }
    
    await loadFiles('all');
    setupFileListeners();
    updateDashboardCounts();
    console.log('✅ Files page initialized');
}

async function loadFiles(filter = 'all') {
    console.log('📁 Loading files with filter:', filter);
    currentFilter = filter;
    const user = getCurrentUser();
    if (!user) return;
    
    if (filter === 'shared' || filter === 'received') {
        return loadReceivedFiles();
    }
    
    try {
        if (typeof getFiles !== 'function') {
            throw new Error('getFiles function not available');
        }
        
        const files = await getFiles(filter);
        currentFiles = files;
        console.log('📁 Found', files.length, 'files');
        
        const grid = document.getElementById('fileGrid');
        const count = document.getElementById('fileCount');
        
        if (count) count.textContent = files.length;
        if (!grid) return;
        
        if (files.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <span class="icon">📭</span>
                    <h3>No files found</h3>
                    <p style="color:#6a7a8e;margin-bottom:12px;">
                        Upload your first file from the Backup page!
                    </p>
                    <a href="backup.html" class="btn btn-primary" style="margin-top:8px;">
                        📤 Upload Files
                    </a>
                </div>
            `;
            return;
        }
        
        grid.innerHTML = files.map(file => {
            const name = (file.original_name || 'Unnamed').replace(/"/g, '&quot;');
            const icon = typeof getFileIcon === 'function' ? getFileIcon(file) : '📄';
            const size = typeof formatSize === 'function' ? formatSize(file.size) : (file.size || 0) + ' bytes';
            const date = file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString() : '';
            
            const isShared = file.source_type === 'shared' && !file.is_own;
            const fromBadge = isShared 
                ? `<div style="font-size:10px;color:#667eea;font-weight:600;margin-top:2px;">👤 From: ${file.owner_username || 'Unknown'}</div>` 
                : '';
            const borderStyle = isShared ? 'border-left:3px solid #667eea;' : '';
            
            return `
                <div class="file-card" data-id="${file.id}" style="${borderStyle}">
                    <div class="file-icon">${icon}</div>
                    <div class="file-name" title="${name}">${name}</div>
                    <div class="file-size">${size}</div>
                    <div class="file-date">${date}</div>
                    ${fromBadge}
                    <div class="file-actions">
                        <button onclick="viewFile(${file.id})" class="btn btn-view" title="View">👁️</button>
                        <button onclick="downloadFile(${file.id})" class="btn btn-download" title="Download">⬇️</button>
                        <button onclick="backupOffline(${file.id})" class="btn btn-backup" title="Backup">💾</button>
                        <button onclick="openShareModal(${file.id})" class="btn btn-share" title="Share">📤</button>
                        <button onclick="deleteFileHandler(${file.id})" class="btn btn-delete" title="Delete">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');
        
        console.log('✅ Files rendered');
        
    } catch (error) {
        console.error('❌ Load files error:', error);
        const grid = document.getElementById('fileGrid');
        if (grid) {
            grid.innerHTML = `
                <div class="empty-state">
                    <span class="icon">⚠️</span>
                    <h3>Error loading files</h3>
                    <p style="color:#dc3545;">${error.message}</p>
                    <button onclick="loadFiles('${filter}')" class="btn btn-primary" style="margin-top:8px;">
                        🔄 Retry
                    </button>
                </div>
            `;
        }
        toast('❌ Error loading files: ' + error.message, 'error');
    }
}

function setupFileListeners() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const filter = this.dataset.filter || 'all';
            loadFiles(filter);
        });
    });
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function() {
            const query = this.value.toLowerCase();
            const filtered = currentFiles.filter(f => 
                (f.original_name || '').toLowerCase().includes(query)
            );
            renderFilteredFiles(filtered);
        }, 300));
    }
}

function renderFilteredFiles(files) {
    const grid = document.getElementById('fileGrid');
    if (!grid) return;
    
    if (files.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <span class="icon">🔍</span>
                <h3>No files match</h3>
                <p style="color:#6a7a8e;">Try a different search term</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = files.map(file => {
        const name = (file.original_name || 'Unnamed').replace(/"/g, '&quot;');
        const icon = typeof getFileIcon === 'function' ? getFileIcon(file) : '📄';
        const size = typeof formatSize === 'function' ? formatSize(file.size) : (file.size || 0) + ' bytes';
        const date = file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString() : '';
        return `
            <div class="file-card" data-id="${file.id}">
                <div class="file-icon">${icon}</div>
                <div class="file-name" title="${name}">${name}</div>
                <div class="file-size">${size}</div>
                <div class="file-date">${date}</div>
                <div class="file-actions">
                    <button onclick="viewFile(${file.id})" class="btn btn-view">👁️</button>
                    <button onclick="downloadFile(${file.id})" class="btn btn-download">⬇️</button>
                    <button onclick="backupOffline(${file.id})" class="btn btn-backup">💾</button>
                    <button onclick="openShareModal(${file.id})" class="btn btn-share">📤</button>
                    <button onclick="deleteFileHandler(${file.id})" class="btn btn-delete">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

async function backupOffline(id) {
    try {
        if (typeof backupFileOffline !== 'function') {
            throw new Error('backupFileOffline not available');
        }
        
        const file = await getFileFromDB(id);
        if (!file) {
            toast('❌ File not found', 'error');
            return;
        }
        if (!file.blob) {
            toast('❌ File data not available', 'error');
            return;
        }
        
        const fileData = {
            name: file.original_name,
            type: file.mime_type || 'application/octet-stream',
            id: file.id
        };
        
        const result = await backupFileOffline(fileData, file.blob);
        if (result && result.success) {
            toast('💾 Backup saved offline', 'success');
            setTimeout(() => updateStorageAfterAction(), 500);
        }
        return result;
    } catch (error) {
        console.error('Backup error:', error);
        toast('❌ Backup failed: ' + error.message, 'error');
    }
}

async function deleteFileHandler(id) {
    if (!confirm('Delete this file?')) return;
    
    try {
        if (typeof deleteFile !== 'function') {
            throw new Error('deleteFile not available');
        }
        
        const result = await deleteFile(id);
        toast(result.message, result.success ? 'success' : 'error');
        if (result.success) {
            await refreshFiles();
            await loadFiles(currentFilter);
            setTimeout(() => updateStorageAfterAction(), 300);
        }
    } catch (error) {
        console.error('Delete error:', error);
        toast('Error deleting file', 'error');
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// ============================================
// STORAGE UPDATE
// ============================================

async function updateStorageDisplay() {
    const user = getCurrentUser();
    if (!user) return;
    
    try {
        if (typeof getStorageInfo !== 'function') return;
        
        const storage = await getStorageInfo(user.id);
        if (!storage) return;
        
        const storageBar = document.getElementById('storageBar');
        const storageUsedText = document.getElementById('storageUsedText');
        const storagePercent = document.getElementById('storagePercent');
        const storagePercentDisplay = document.getElementById('storagePercentDisplay');
        const storageRemaining = document.getElementById('storageRemaining');
        
        if (storageBar) {
            const percentage = Math.min(storage.percentage, 100);
            storageBar.style.width = percentage + '%';
            
            if (percentage > 80) storageBar.style.background = '#dc3545';
            else if (percentage > 60) storageBar.style.background = '#f59e0b';
            else storageBar.style.background = '#6C63FF';
        }
        
        if (storageUsedText) storageUsedText.textContent = storage.usedGB.toFixed(1) + ' GB / ' + storage.limitGB.toFixed(1) + ' GB';
        if (storagePercent) storagePercent.textContent = Math.round(storage.percentage) + '%';
        if (storagePercentDisplay) storagePercentDisplay.textContent = Math.round(storage.percentage) + '%';
        if (storageRemaining) storageRemaining.textContent = storage.remainingGB.toFixed(1) + ' GB remaining';
        
    } catch (error) {
        console.error('Error updating storage:', error);
    }
}

async function updateStorageAfterAction() {
    await updateStorageDisplay();
    await updateDashboardCounts();
    if (document.getElementById('fileGrid')) {
        await loadFiles(currentFilter || 'all');
    }
}

// ============================================
// UPDATE DASHBOARD COUNTS
// ============================================

async function updateDashboardCounts() {
    const user = getCurrentUser();
    if (!user) return;
    
    try {
        if (typeof getFiles !== 'function') return;
        
        const files = await getFiles();
        
        const fileCount = document.getElementById('fileCount');
        if (fileCount) fileCount.textContent = files.length;
        
        const images = files.filter(f => f.file_type === 'picture');
        const videos = files.filter(f => f.file_type === 'video');
        const docs = files.filter(f => f.file_type === 'document');
        
        const imageCount = document.getElementById('imageCount');
        const videoCount = document.getElementById('videoCount');
        const docCount = document.getElementById('docCount');
        
        if (imageCount) imageCount.textContent = images.length;
        if (videoCount) videoCount.textContent = videos.length;
        if (docCount) docCount.textContent = docs.length;
        
        try {
            if (typeof getSharedByMe === 'function' && typeof getSharedFiles === 'function') {
                const sent = await getSharedByMe();
                const received = await getSharedFiles();
                const sharedCount = document.getElementById('sharedCount');
                const receivedCount = document.getElementById('receivedCount');
                if (sharedCount) sharedCount.textContent = sent?.length || 0;
                if (receivedCount) receivedCount.textContent = received?.length || 0;
            }
        } catch (e) {}
        
        await updateStorageDisplay();
    } catch (error) {
        console.error('Dashboard update error:', error);
    }
}

// ============================================
// BACKUP PAGE
// ============================================

function initBackup() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    
    if (fileInput) {
        const newFileInput = fileInput.cloneNode(true);
        fileInput.parentNode.replaceChild(newFileInput, fileInput);
        
        if (dropZone) {
            dropZone.addEventListener('click', function(e) {
                e.preventDefault();
                const input = document.getElementById('fileInput');
                if (input) input.click();
            });
        }
        
        newFileInput.addEventListener('change', function(e) {
            if (this.files.length > 0) {
                handleBackupFiles(this.files);
                this.value = '';
            }
        });
    }
    
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleBackupFiles(e.dataTransfer.files);
            }
        });
    }
}

async function handleBackupFiles(files) {
    const user = getCurrentUser();
    if (!user) {
        alert('Please login first');
        window.location.href = 'login.html';
        return;
    }
    
    if (typeof saveFile !== 'function') {
        toast('❌ Database not ready', 'error');
        return;
    }
    
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressStatus = document.getElementById('progressStatus');
    
    if (progressContainer) progressContainer.style.display = 'block';
    if (progressStatus) {
        progressStatus.textContent = '📴 Saving to SafeBox...';
        progressStatus.style.color = '#6C63FF';
    }
    
    let successCount = 0;
    let failCount = 0;
    let total = files.length;
    const savedFileIds = [];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const percent = Math.round(((i + 1) / total) * 100);
        
        if (progressBar) progressBar.style.width = percent + '%';
        if (progressText) progressText.textContent = `${percent}% - ${file.name}`;
        
        try {
            const result = await saveFile(file, file);
            if (result.success) {
                successCount++;
                savedFileIds.push(result.id);
            } else {
                failCount++;
            }
        } catch (error) {
            failCount++;
            console.error('Error saving:', file.name, error);
        }
    }
    
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = `Complete: ${successCount} saved, ${failCount} failed`;
    if (progressStatus) {
        progressStatus.textContent = '✅ Upload complete!';
        progressStatus.style.color = '#28a745';
    }
    
    toast(`✅ Backup Complete!\nSuccess: ${successCount}\nFailed: ${failCount}`, 
          failCount > 0 ? 'warning' : 'success');
    
    setTimeout(async () => {
        if (progressContainer) progressContainer.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
        
        await refreshFiles();
        await loadFiles(currentFilter);
        await updateDashboardCounts();
        await updateStorageDisplay();
        
        if (savedFileIds.length > 0) {
            toast(`📁 ${savedFileIds.length} files now in your files`, 'success');
        }
    }, 1500);
}

// ============================================
// APP VERSION
// ============================================

async function getAppVersion() {
    try {
        const response = await fetch('https://fantasy-open-sanctuary.ngrok-free.dev/safe-box/version.json', {
            headers: {
                'ngrok-skip-browser-warning': 'true',
                'Cache-Control': 'no-cache'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.version) {
                localStorage.setItem('app_version', data.version);
                return data.version;
            }
        }
    } catch (error) {
        console.log('Could not fetch version from server, using cached');
    }
    
    return localStorage.getItem('app_version') || '1.0.0';
}

function showVersionInfo() {
    const version = localStorage.getItem('app_version') || '1.0.0';
    document.querySelectorAll('.app-version').forEach(el => {
        el.textContent = 'v' + version;
    });
}

// ============================================
// DOWNLOAD PROGRESS UI
// ============================================

function showDownloadProgress(fileName) {
    const existing = document.getElementById('downloadProgress');
    if (existing) existing.remove();

    const progress = document.createElement('div');
    progress.id = 'downloadProgress';
    progress.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: white;
        padding: 16px 24px;
        border-radius: 16px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.2);
        z-index: 999999;
        min-width: 280px;
        max-width: 90%;
        animation: slideUp 0.3s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    progress.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
            <span style="font-size:20px;">⬇️</span>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${fileName}</div>
                <div style="font-size:12px;color:#6a7a8e;" id="downloadStatus">Starting download...</div>
            </div>
            <span style="font-size:14px;font-weight:700;color:#6C63FF;" id="downloadPercent">0%</span>
        </div>
        <div style="width:100%;height:4px;background:#e0e5f0;border-radius:2px;overflow:hidden;">
            <div id="downloadBar" style="width:0%;height:100%;background:#6C63FF;border-radius:2px;transition:width 0.3s;"></div>
        </div>
    `;
    document.body.appendChild(progress);
    window._downloadCancelled = false;
}

function updateDownloadProgress(percent, status) {
    const bar = document.getElementById('downloadBar');
    const percentEl = document.getElementById('downloadPercent');
    const statusEl = document.getElementById('downloadStatus');
    if (bar) bar.style.width = Math.min(percent, 100) + '%';
    if (percentEl) percentEl.textContent = Math.min(percent, 100) + '%';
    if (statusEl) statusEl.textContent = status || 'Downloading...';
}

function hideDownloadProgress() {
    const el = document.getElementById('downloadProgress');
    if (el) {
        el.style.transition = 'opacity 0.3s, transform 0.3s';
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(30px)';
        setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);
    }
    window._downloadCancelled = true;
}

function cancelDownload() {
    window._downloadCancelled = true;
    hideDownloadProgress();
    toast('⛔ Download cancelled', 'warning');
}

// ============================================
// SYNC ON PAGE LOAD
// ============================================

async function startSyncAfterLogin() {
    const user = getCurrentUser();
    if (!user) return;

    // initializeSync() does: fullSync + validatePendingShares + startBackgroundSync(20s)
    // It's idempotent — safe to call from any page.
    if (typeof initializeSync === 'function') {
        try {
            await initializeSync();
            updateSyncStatusUI('online');
        } catch (e) {
            console.warn('initializeSync error:', e);
            updateSyncStatusUI('offline');
        }
    }

    // Status badge refresh (per-page, harmless)
    setInterval(checkServerStatus, 30000);
}

// ============================================
// GLOBAL FALLBACKS
// ============================================

if (typeof formatSize !== 'function') {
    window.formatSize = function(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };
}

if (typeof getFileIcon !== 'function') {
    window.getFileIcon = function(file) {
        if (!file) return '📄';
        const ext = (file.extension || file.original_name?.split('.').pop() || '').toLowerCase();
        const icons = {
            'pdf': '📄', 'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️',
            'gif': '🖼️', 'webp': '🖼️', 'mp4': '🎬', 'webm': '🎬',
            'doc': '📝', 'docx': '📝', 'xls': '📊', 'xlsx': '📊',
            'ppt': '📽️', 'pptx': '📽️', 'txt': '📃', 'html': '🌐',
            'css': '🎨', 'js': '⚡', 'json': '📋', 'zip': '📦'
        };
        return icons[ext] || '📄';
    };
}

// ============================================
// EVENT LISTENERS
// ============================================

window.addEventListener('filesSynced', (e) => {
    const d = e.detail || {};
    console.log('📥 Files synced event:', d);

    if (d.downloaded > 0) {
        toast(`📥 ${d.downloaded} new file(s) received`, 'success');
    }

    // Update counts + storage only.
    // Each page (files.html, dashboard.html) re-renders its own list on this event.
    updateDashboardCounts();
    updateStorageDisplay();
});

window.addEventListener('sharesValidated', (e) => {
    const d = e.detail || {};
    if (d.validated > 0) {
        toast(`✅ ${d.validated} pending share(s) validated`, 'success');
    }
});

// ============================================
// AUTO-INIT
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    const isLoggedIn = checkAutoLogin();
    
    const currentPage = window.location.pathname.split('/').pop();
    const loginPages = ['login.html', 'register.html'];
    
    if (isLoggedIn && loginPages.includes(currentPage)) {
        console.log('🔄 Already logged in, redirecting');
        window.location.href = 'dashboard.html';
        return;
    }
    
    showVersionInfo();
    setTimeout(updateStorageDisplay, 2000);
    setTimeout(updateDashboardCounts, 2500);
    
    if (isLoggedIn && !loginPages.includes(currentPage)) {
        setTimeout(startSyncAfterLogin, 800);
    }
    
    console.log('✅ App initialized');
});

// ============================================
// EXPOSE FUNCTIONS
// ============================================

// Core
window.toast = toast;
window.showToast = showToast;
window.viewFile = viewFile;
window.downloadFile = downloadFile;
window.backupOffline = backupOffline;
window.deleteFileHandler = deleteFileHandler;
window.loadFiles = loadFiles;
window.handleBackupFiles = handleBackupFiles;
window.initFiles = initFiles;
window.initBackup = initBackup;
window.cancelDownload = cancelDownload;
window.showVersionInfo = showVersionInfo;

// Session
window.saveUserSession = saveUserSession;
window.getUserSession = getUserSession;
window.clearUserSession = clearUserSession;
window.checkAutoLogin = checkAutoLogin;
window.ensureLoggedIn = ensureLoggedIn;

// Storage
window.updateDashboardCounts = updateDashboardCounts;
window.updateStorageDisplay = updateStorageDisplay;
window.updateStorageAfterAction = updateStorageAfterAction;

// Progress
window.showDownloadProgress = showDownloadProgress;
window.updateDownloadProgress = updateDownloadProgress;
window.hideDownloadProgress = hideDownloadProgress;
window.browserDownload = browserDownload;
window.refreshFiles = refreshFiles;
window.getFileFromDB = getFileFromDB;

// Sync
window.updateSyncStatusUI = updateSyncStatusUI;
window.checkServerStatus = checkServerStatus;
window.triggerSync = triggerSync;
window.startSyncAfterLogin = startSyncAfterLogin;

// Sharing
window.openShareModal = openShareModal;
window.closeShareModal = closeShareModal;
window.confirmShare = confirmShare;
window.loadReceivedFiles = loadReceivedFiles;
window.acceptSharedFileHandler = acceptSharedFileHandler;
window.viewSharedFile = viewSharedFile;
window.downloadSharedFile = downloadSharedFile;

console.log('✅ app.js fully loaded');
console.log('🔗 Sync status UI: top-right corner (tap to sync)');
console.log('📤 Share modal: click 📤 on any file');
console.log('📥 Received files: loadReceivedFiles()');
console.log('🔄 Auto-sync: 20s foreground loop via initializeSync()');
console.log('🌐 Backend: Ngrok tunnel');