// ============================================
// INDEXEDDB - COMPLETE DATABASE LAYER WITH BACKEND SYNC
// BACKEND: https://allapp.nport.link
// ROUTER: index.php?route=action
// MAX FILE SIZE: 800MB
// OFFLINE-FIRST: Local saves show immediately
// LIVE SYNC: 10s idle / 2s burst / SSE push + pause/resume + events
// DOWNLOAD: raw fast path → parallel chunked fallback → base64 fallback
// SHARE: files > 100 MB are shared via server-generated URL (48h expiry)
// UPLOAD: parallel chunked upload (6 chunks × 16MB) for files > 10MB
// DEVICE: downloadFileToDevice() hands URL to Android DownloadManager
// SYNC: downloads and uploads run in parallel (uploads can't block downloads)
// BACKGROUND: WorkManager wakes the app every ~15 min after close
// CHAT: 1-to-1 messaging over the same SSE stream (chat_messages store)
// ============================================

const DB_NAME = 'SafeBoxDB';
const DB_VERSION = 16;

const STORES = {
    USERS: 'users',
    FILES: 'files',
    SHARED_FILES: 'shared_files',
    OFFLINE_BACKUPS: 'offline_backups',
    SECURITY_QUESTIONS: 'security_questions',
    LOGIN_HISTORY: 'login_history',
    SYNC_QUEUE: 'sync_queue',
    FILE_STATS: 'file_stats',
    SHARE_SESSIONS: 'share_sessions',
    PENDING_SHARES: 'pending_shares',
    PENDING_DELETES: 'pending_deletes',
    CHAT: 'chat_messages'
};

const BACKEND_URL = 'https://allapp.nport.link/backend_db/index.php?route=';
const API_URL = BACKEND_URL;

// ============================================
// CONFIG
// ============================================

const DEFAULT_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024; // 10GB
const MAX_FILE_SIZE = 800 * 1024 * 1024;               // 800MB
const CHUNK_SIZE = 16 * 1024 * 1024;                    // 16MB chunks
const CHUNK_THRESHOLD = 10 * 1024 * 1024;              // 10MB — above this, chunk
const DOWNLOAD_CONCURRENCY = 4;
const CHUNK_DOWNLOAD_CONCURRENCY = 3;
const CHUNK_UPLOAD_CONCURRENCY = 6;

const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024;        // 100 MB
const SHARE_LINK_TTL_HOURS = 48;

const NATIVE_SYNC_INTERVAL_MINUTES = 15;
const UPLOAD_RETRY_STUCK_AFTER_MS = 10 * 60 * 1000;

// ============================================
// LOCAL USER ID GENERATOR
// ============================================

function getNextLocalUserId() {
    const KEY = 'safebox_next_local_id';
    let next = parseInt(localStorage.getItem(KEY) || '1');
    if (isNaN(next) || next < 1) next = 1;
    next++;
    localStorage.setItem(KEY, String(next));
    console.log('🔢 Assigned local user ID:', next);
    return next;
}

// ============================================
// FETCH HELPER
// ============================================

async function apiFetch(endpoint, options = {}) {
    const headers = {
        ...(options.headers || {}),
        'ngrok-skip-browser-warning': 'true'
    };

    if (options.body && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    try {
        const response = await fetch(BACKEND_URL + endpoint, {
            ...options,
            headers,
            mode: 'cors',
            credentials: 'same-origin',
            cache: 'no-store'
        });
        return response;
    } catch (error) {
        console.error('❌ API request failed:', BACKEND_URL + endpoint, error);
        throw error;
    }
}

// ============================================
// CHECK SERVER STATUS
// ============================================

async function isServerOnline() {
    try {
        const response = await apiFetch('test', { method: 'GET' });
        return response.ok;
    } catch (error) {
        console.log('📡 Server offline:', error.message);
        return false;
    }
}

// ============================================
// NATIVE BACKGROUND SYNC HELPERS
// ============================================

function enableNativeBackgroundSync() {
    try {
        if (window.Android && typeof window.Android.scheduleBackgroundSync === 'function') {
            window.Android.scheduleBackgroundSync(NATIVE_SYNC_INTERVAL_MINUTES);
            console.log('📱 Native background sync enabled (every ' + NATIVE_SYNC_INTERVAL_MINUTES + ' min)');
        }
    } catch (e) {
        console.warn('📱 enableNativeBackgroundSync failed:', e.message);
    }
}

function disableNativeBackgroundSync() {
    try {
        if (window.Android && typeof window.Android.cancelBackgroundSync === 'function') {
            window.Android.cancelBackgroundSync();
            console.log('📱 Native background sync disabled');
        }
    } catch (e) {
        console.warn('📱 disableNativeBackgroundSync failed:', e.message);
    }
}

// ============================================
// SECURITY QUESTIONS
// ============================================

const SECURITY_QUESTIONS = [
    'What is your mother\'s maiden name?',
    'What was the name of your first pet?',
    'What is your favorite book?',
    'What city were you born in?',
    'What is your favorite color?',
    'What was your first school?',
    'What is your favorite movie?',
    'What is your best friend\'s name?',
    'What is your favorite food?',
    'What is your dream job?'
];

// ============================================
// OPEN DATABASE
// ============================================

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            
            if (!db.objectStoreNames.contains(STORES.USERS)) {
                const store = db.createObjectStore(STORES.USERS, { keyPath: 'id' });
                store.createIndex('username', 'username', { unique: true });
                store.createIndex('is_active', 'is_active', { unique: false });
                store.createIndex('created_at', 'created_at', { unique: false });
                store.createIndex('synced', 'synced', { unique: false });
            } else {
                const store = request.transaction.objectStore(STORES.USERS);
                if (!store.indexNames.contains('is_active')) store.createIndex('is_active', 'is_active', { unique: false });
                if (!store.indexNames.contains('created_at')) store.createIndex('created_at', 'created_at', { unique: false });
                if (!store.indexNames.contains('synced')) store.createIndex('synced', 'synced', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORES.FILES)) {
                const store = db.createObjectStore(STORES.FILES, { keyPath: 'id', autoIncrement: true });
                store.createIndex('user_id', 'user_id', { unique: false });
                store.createIndex('file_type', 'file_type', { unique: false });
                store.createIndex('uploaded_at', 'uploaded_at', { unique: false });
                store.createIndex('shared', 'shared', { unique: false });
                store.createIndex('extension', 'extension', { unique: false });
                store.createIndex('original_name', 'original_name', { unique: false });
                store.createIndex('is_backup', 'is_backup', { unique: false });
                store.createIndex('synced', 'synced', { unique: false });
                store.createIndex('server_file_id', 'server_file_id', { unique: false });
                store.createIndex('sync_status', 'sync_status', { unique: false });
            } else {
                const store = request.transaction.objectStore(STORES.FILES);
                if (!store.indexNames.contains('sync_status')) {
                    store.createIndex('sync_status', 'sync_status', { unique: false });
                }
            }
            
            if (!db.objectStoreNames.contains(STORES.SHARED_FILES)) {
                const store = db.createObjectStore(STORES.SHARED_FILES, { keyPath: 'id', autoIncrement: true });
                store.createIndex('file_id', 'file_id', { unique: false });
                store.createIndex('recipient_id', 'recipient_id', { unique: false });
                store.createIndex('sender_id', 'sender_id', { unique: false });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('shared_at', 'shared_at', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORES.OFFLINE_BACKUPS)) {
                const store = db.createObjectStore(STORES.OFFLINE_BACKUPS, { keyPath: 'id', autoIncrement: true });
                store.createIndex('user_id', 'user_id', { unique: false });
                store.createIndex('backup_date', 'backup_date', { unique: false });
                store.createIndex('file_id', 'file_id', { unique: false });
                store.createIndex('is_restored', 'is_restored', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORES.SECURITY_QUESTIONS)) {
                const store = db.createObjectStore(STORES.SECURITY_QUESTIONS, { keyPath: 'id', autoIncrement: true });
                store.createIndex('user_id', 'user_id', { unique: false });
                store.createIndex('question_text', 'question_text', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORES.LOGIN_HISTORY)) {
                const store = db.createObjectStore(STORES.LOGIN_HISTORY, { keyPath: 'id', autoIncrement: true });
                store.createIndex('user_id', 'user_id', { unique: false });
                store.createIndex('login_date', 'login_date', { unique: false });
                store.createIndex('status', 'status', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
                const store = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('created_at', 'created_at', { unique: false });
                store.createIndex('retry_count', 'retry_count', { unique: false });
                store.createIndex('user_id', 'user_id', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORES.FILE_STATS)) {
                const store = db.createObjectStore(STORES.FILE_STATS, { keyPath: 'id', autoIncrement: true });
                store.createIndex('user_id', 'user_id', { unique: false });
                store.createIndex('date', 'date', { unique: false });
                store.createIndex('type', 'type', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORES.SHARE_SESSIONS)) {
                const store = db.createObjectStore(STORES.SHARE_SESSIONS, { keyPath: 'id', autoIncrement: true });
                store.createIndex('token', 'token', { unique: true });
                store.createIndex('expiry', 'expiry', { unique: false });
                store.createIndex('sender_id', 'sender_id', { unique: false });
                store.createIndex('file_id', 'file_id', { unique: false });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('created_at', 'created_at', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORES.PENDING_SHARES)) {
                const store = db.createObjectStore(STORES.PENDING_SHARES, { keyPath: 'id', autoIncrement: true });
                store.createIndex('share_id', 'share_id', { unique: false });
                store.createIndex('username', 'username', { unique: false });
                store.createIndex('validated', 'validated', { unique: false });
                store.createIndex('attempts', 'attempts', { unique: false });
                store.createIndex('sender_id', 'sender_id', { unique: false });
                store.createIndex('created_at', 'created_at', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORES.PENDING_DELETES)) {
                const store = db.createObjectStore(STORES.PENDING_DELETES, { keyPath: 'id', autoIncrement: true });
                store.createIndex('user_id', 'user_id', { unique: false });
                store.createIndex('server_file_id', 'server_file_id', { unique: false });
                store.createIndex('queued_at', 'queued_at', { unique: false });
            }

            if (!db.objectStoreNames.contains(STORES.CHAT)) {
                const store = db.createObjectStore(STORES.CHAT, { keyPath: 'id' });
                store.createIndex('peer', 'peer', { unique: false });
                store.createIndex('sent_at', 'sent_at', { unique: false });
                store.createIndex('pending', 'pending', { unique: false });
            }
        };
        
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

// ============================================
// SYNC FUNCTIONS
// ============================================

async function syncUserToBackend(userData) {
    try {
        const online = await isServerOnline();
        if (!online) {
            return { success: true, synced: false, message: 'Offline - saved locally' };
        }

        const response = await apiFetch('register', {
            method: 'POST',
            body: JSON.stringify({
                username: userData.username,
                password: userData.password,
                display_name: userData.display_name || userData.username,
                security_question: userData.security_question,
                security_answer_hash:
                    userData.security_answer_hash ??
                    userData.security_answer ??
                    'Default'
            })
        });

        const data = await response.json();
        
        if (data.success) {
            console.log('✅ User synced to backend:', userData.username);
            return { success: true, synced: true, data: data };
        } else {
            return { success: false, synced: false, message: data.error || 'Sync failed' };
        }
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function syncFileToBackend(fileData) {
    try {
        const online = await isServerOnline();
        if (!online) {
            console.log('📡 Offline - file saved locally only');
            return { success: true, synced: false, message: 'Offline - saved locally' };
        }

        const blob = fileData.blob;
        if (!blob) {
            return { success: false, message: 'File blob missing' };
        }

        if (blob.size <= CHUNK_THRESHOLD) {
            return await syncFileSingle(fileData);
        }

        console.log(`📦 Large file (${formatSize(blob.size)}) — chunked upload`);
        return await syncFileChunked(fileData);
    } catch (error) {
        console.error('Sync file error:', error);
        return { success: false, message: error.message };
    }
}

async function syncFileSingle(fileData) {
    const formData = new FormData();
    formData.append('user_id', fileData.user_id);
    formData.append('file', fileData.blob, fileData.original_name);
    formData.append('title', fileData.original_name);
    formData.append('description', fileData.description || '');
    formData.append('category', fileData.category || 'General');
    formData.append('is_public', fileData.is_public || 0);

    const response = await apiFetch('upload', {
        method: 'POST',
        body: formData
    });

    const data = await response.json();
    if (data.success) {
        return { success: true, synced: true, data: data };
    }
    return { success: false, synced: false, message: data.error || 'Upload failed' };
}

async function syncFileChunked(fileData) {
    const blob = fileData.blob;
    const totalChunks = Math.ceil(blob.size / CHUNK_SIZE);
    const uploadId = 'user_' + fileData.user_id + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    try {
        window.dispatchEvent(new CustomEvent('uploadStarted', {
            detail: {
                upload_id: uploadId,
                original_name: fileData.original_name,
                total_chunks: totalChunks,
                total_size: blob.size,
                user_id: fileData.user_id
            }
        }));
    } catch (e) {}

    const initFormData = new FormData();
    initFormData.append('upload_id', uploadId);
    initFormData.append('user_id', fileData.user_id);
    initFormData.append('filename', fileData.original_name);
    initFormData.append('total_size', blob.size);
    initFormData.append('total_chunks', totalChunks);
    initFormData.append('description', fileData.description || '');
    initFormData.append('category', fileData.category || 'General');
    initFormData.append('is_public', fileData.is_public || 0);

    const initRes = await apiFetch('user_upload_init', {
        method: 'POST',
        body: initFormData
    });
    const initData = await initRes.json();

    if (!initData.success) {
        return { success: false, synced: false, message: initData.error || 'Failed to init upload' };
    }

    let completedChunks = 0;
    let failedChunk = null;
    let nextChunkIndex = 0;

    async function uploadOneChunk(i) {
        if (failedChunk !== null) return;

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, blob.size);
        const chunk = blob.slice(start, end);

        const chunkFormData = new FormData();
        chunkFormData.append('upload_id', uploadId);
        chunkFormData.append('chunk_index', i);
        chunkFormData.append('chunk', chunk, 'chunk_' + i);

        let retries = 3;
        while (retries > 0) {
            if (failedChunk !== null) return;

            try {
                const chunkRes = await apiFetch('user_upload_chunk', {
                    method: 'POST',
                    body: chunkFormData
                });

                const ct = (chunkRes.headers.get('content-type') || '').toLowerCase();
                if (ct.includes('text/html')) {
                    throw new Error(`Server returned HTML (HTTP ${chunkRes.status}) — likely a Cloudflare timeout`);
                }

                const chunkData = await chunkRes.json();
                if (chunkData.success) {
                    completedChunks++;
                    const percent = Math.round((completedChunks / totalChunks) * 100);
                    console.log(`📦 ${fileData.original_name}: ${percent}% (${completedChunks}/${totalChunks})`);
                    return;
                }
            } catch (err) {
                console.warn(`Chunk ${i} attempt failed:`, err.message);
            }
            retries--;
            if (retries > 0) await new Promise(r => setTimeout(r, 1000));
        }

        failedChunk = i;
    }

    async function uploadWorker() {
        while (failedChunk === null) {
            const i = nextChunkIndex++;
            if (i >= totalChunks) return;
            await uploadOneChunk(i);
        }
    }

    const workers = [];
    const workerCount = Math.min(CHUNK_UPLOAD_CONCURRENCY, totalChunks);
    for (let w = 0; w < workerCount; w++) {
        workers.push(uploadWorker());
    }
    await Promise.all(workers);

    if (failedChunk !== null) {
        try {
            await apiFetch('user_upload_abort', {
                method: 'POST',
                body: JSON.stringify({ upload_id: uploadId, user_id: fileData.user_id }),
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e) {}
        return { success: false, synced: false, message: `Chunk ${failedChunk} failed` };
    }

    const completeRes = await apiFetch('user_upload_complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            upload_id: uploadId,
            user_id: fileData.user_id
        })
    });
    const completeData = await completeRes.json();

    if (completeData.success) {
        console.log(`✅ ${fileData.original_name} uploaded via chunks`);
        return { success: true, synced: true, data: completeData };
    }
    return { success: false, synced: false, message: completeData.error || 'Failed to complete' };
}

let _localUploadRunning = false;
let _localUploadStartedAt = 0;

async function syncLocalFilesToServer() {
    if (_localUploadRunning &&
        (Date.now() - _localUploadStartedAt) > UPLOAD_RETRY_STUCK_AFTER_MS) {
        console.warn('⚠️ Upload lock stale — force-unlocking');
        _localUploadRunning = false;
    }

    if (_localUploadRunning) {
        console.log('⏭ Upload batch already running — skipping');
        return { uploaded: 0, failed: 0, skipped: true };
    }

    _localUploadRunning = true;
    _localUploadStartedAt = Date.now();

    try {
        const user = getCurrentUser();
        if (!user) return { uploaded: 0, failed: 0 };

        const online = await isServerOnline();
        if (!online) return { uploaded: 0, failed: 0 };

        const localFiles = await getFiles();
        const pending = localFiles.filter(f =>
            !f.is_shared_with_me &&
            !f.is_link_share &&
            (f.server_file_id == null) &&
            f.sync_status !== 'synced' &&
            f.sync_status !== 'syncing' &&
            f.blob && f.blob.size > 0
        );

        if (pending.length === 0) {
            return { uploaded: 0, failed: 0 };
        }

        console.log(`⬆️ Need to upload ${pending.length} local file(s) to server`);

        let uploaded = 0;
        let failed = 0;

        for (const file of pending) {
            try {
                await updateFileSyncStatus(file.id, 'syncing');

                const result = await syncFileToBackend(file);

                if (result.success && result.synced) {
                    const serverId = result.data?.file?.file_id || result.data?.file?.id;
                    await updateFileSyncStatus(file.id, 'synced', serverId);
                    uploaded++;
                    console.log(`   ⬆️ ${file.original_name} → server id ${serverId}`);
                } else {
                    await updateFileSyncStatus(file.id, 'failed', null, result.message);
                    failed++;
                    console.warn(`   ❌ Upload failed: ${file.original_name} — ${result.message}`);
                }
            } catch (err) {
                await updateFileSyncStatus(file.id, 'failed', null, err.message);
                failed++;
                console.warn(`   ❌ Upload error: ${file.original_name} — ${err.message}`);
            }
        }

        console.log(`⬆️ Uploaded ${uploaded} file(s) (${failed} failed)`);
        return { uploaded, failed };

    } finally {
        _localUploadRunning = false;
        _localUploadStartedAt = 0;
    }
}

const _downloadingServerIds = new Set();

async function syncFilesFromBackend(userId) {
    try {
        const online = await isServerOnline();
        if (!online) return { success: false, message: 'Offline' };

        const response = await apiFetch('files&user_id=' + userId);
        const data = await response.json();

        if (!data.files || data.files.length === 0) {
            return { success: true, newFiles: 0 };
        }

        const db = await openDB();
        const localFiles = await getFiles();

        const localServerIds = new Set(
            localFiles
                .filter(f => f.server_file_id != null)
                .map(f => Number(f.server_file_id))
        );

        let newFiles = 0;

        const linkShares = data.files.filter(f =>
            f.is_link_share && !localServerIds.has(Number(f.file_id))
        );

        if (linkShares.length > 0) {
            console.log(`🔗 Found ${linkShares.length} link share(s) — saving metadata + auto-downloading`);
            await new Promise((resolve) => {
                const tx = db.transaction([STORES.FILES], 'readwrite');
                const store = tx.objectStore(STORES.FILES);
                linkShares.forEach(sf => store.add({
                    user_id: userId,
                    original_name: sf.original_name,
                    file_name: sf.original_name,
                    blob: null,
                    size: Number(sf.size || 0),
                    mime_type: sf.mime_type || 'application/octet-stream',
                    file_type: getFileType(sf.original_name),
                    extension: (sf.original_name || '').split('.').pop().toLowerCase(),
                    uploaded_at: sf.uploaded_at || new Date().toISOString(),
                    shared: true,
                    is_backup: false,
                    synced: true,
                    sync_status: 'synced',
                    server_file_id: Number(sf.file_id),
                    owner_username: sf.owner_username,
                    source_type: 'shared',
                    is_shared_with_me: true,
                    is_link_share: true,
                    share_url: sf.share_url,
                    share_expires_at: sf.share_expires_at || null,
                    auto_download_fired: false
                }));
                tx.oncomplete = resolve;
                tx.onerror = resolve;
            });
            newFiles += linkShares.length;

            if (window.Android && typeof window.Android.startMonitoredDownload === 'function') {
                for (const sf of linkShares) {
                    if (!sf.share_url) continue;
                    try {
                        window.Android.startMonitoredDownload(
                            sf.share_url,
                            sf.original_name || 'file',
                            sf.mime_type || 'application/octet-stream',
                            Number(sf.file_id)
                        );
                        console.log(`📥 Auto-download queued: ${sf.original_name}`);
                    } catch (e) {
                        console.warn(`Auto-download failed for ${sf.original_name}:`, e.message);
                    }
                }
            } else {
                console.log('ℹ️ Not in Android shell — link shares saved as metadata only');
            }
        }

        const toDownload = data.files.filter(serverFile => {
            const sid = Number(serverFile.file_id);
            if (localServerIds.has(sid)) return false;
            if (_downloadingServerIds.has(sid)) return false;
            if (serverFile.is_link_share) return false;

            const size = Number(serverFile.size || serverFile.file_size || 0);
            if (size > LARGE_FILE_THRESHOLD) {
                console.log(`📎 Large file — skipping auto-download (no link): ${serverFile.original_name}`);
                return false;
            }
            return true;
        });

        if (toDownload.length > 0) {
            console.log(`📥 Need to download ${toDownload.length} file(s) — parallel x${DOWNLOAD_CONCURRENCY}`);
            const t0 = performance.now();

            const filesToSave = [];
            const queue = [...toDownload];

            async function downloadWorker() {
                while (queue.length > 0) {
                    const serverFile = queue.shift();
                    const sid = Number(serverFile.file_id);
                    if (_downloadingServerIds.has(sid)) continue;

                    _downloadingServerIds.add(sid);
                    try {
                        const blob = await downloadServerFileAsBlob(userId, serverFile);
                        if (!blob) continue;

                        filesToSave.push({
                            user_id: userId,
                            original_name: serverFile.original_name,
                            file_name: serverFile.file_name || serverFile.original_name,
                            blob: blob,
                            size: blob.size,
                            mime_type: serverFile.mime_type || 'application/octet-stream',
                            file_type: getFileType(serverFile.original_name),
                            extension: (serverFile.original_name || '').split('.').pop().toLowerCase(),
                            uploaded_at: serverFile.uploaded_at || new Date().toISOString(),
                            shared: !serverFile.is_own,
                            is_backup: false,
                            synced: true,
                            sync_status: 'synced',
                            server_file_id: sid,
                            owner_username: serverFile.owner_username,
                            source_type: serverFile.is_own ? 'own' : (serverFile.source_type || 'shared'),
                            is_shared_with_me: !serverFile.is_own,
                            is_link_share: false
                        });

                        console.log(`   ✅ ${serverFile.is_own ? '[own] ' : '[shared] '}${serverFile.original_name} (${formatSize(blob.size)})`);
                    } catch (err) {
                        console.warn(`   ❌ Failed: ${serverFile.original_name} — ${err.message}`);
                    } finally {
                        _downloadingServerIds.delete(sid);
                    }
                }
            }

            const workers = [];
            for (let i = 0; i < Math.min(DOWNLOAD_CONCURRENCY, toDownload.length); i++) {
                workers.push(downloadWorker());
            }
            await Promise.all(workers);

            if (filesToSave.length > 0) {
                await new Promise((resolve, reject) => {
                    const tx = db.transaction([STORES.FILES], 'readwrite');
                    const store = tx.objectStore(STORES.FILES);
                    filesToSave.forEach(file => store.add(file));
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error);
                });
                newFiles += filesToSave.length;
            }

            const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
            console.log(`✅ Saved ${filesToSave.length} file(s) in ${elapsed}s`);
        }

        return { success: true, newFiles };
    } catch (error) {
        console.error('Sync files from backend error:', error);
        return { success: false, message: error.message };
    }
}

async function downloadServerFileAsBlob(userId, serverFile) {
    const fileId = Number(serverFile.file_id);
    const expectedSize = Number(serverFile.size || serverFile.file_size || 0);
    const mimeType = serverFile.mime_type || 'application/octet-stream';

    if (!fileId || !userId) {
        console.error('❌ Missing userId or fileId');
        return null;
    }

    console.log(`⬇️ Downloading ${serverFile.original_name || 'file'} (${formatSize(expectedSize)})`);

    try {
        console.log(`🚀 RAW download: ${serverFile.original_name || fileId}`);

        const rawRes = await apiFetch(
            `file_raw&user_id=${encodeURIComponent(userId)}&file_id=${encodeURIComponent(fileId)}`,
            { method: 'GET' }
        );

        if (rawRes.ok) {
            const contentType = (rawRes.headers.get('content-type') || '').toLowerCase();

            if (!contentType.includes('text/html')) {
                const blob = await rawRes.blob();

                if (blob && blob.size > 0) {
                    if (expectedSize > 0 && blob.size !== expectedSize) {
                        console.warn(
                            `⚠️ RAW size mismatch: ${formatSize(blob.size)} / ${formatSize(expectedSize)}`
                        );
                    } else {
                        console.log(`✅ RAW download complete: ${formatSize(blob.size)}`);
                    }

                    if ((blob.type === 'application/octet-stream' || !blob.type) && mimeType) {
                        return new Blob([blob], { type: mimeType });
                    }
                    return blob;
                }
            }
        }

        console.warn(`⚠️ RAW download failed for file ${fileId}`);
    } catch (error) {
        console.warn(`⚠️ RAW download error: ${error.message}`);
    }

    if (expectedSize > 10 * 1024 * 1024) {
        console.log(`📦 Switching to chunked download: ${formatSize(expectedSize)}`);

        try {
            const chunkedBlob = await downloadFileByChunks(userId, serverFile);

            if (chunkedBlob) {
                console.log(`✅ Chunked download complete: ${formatSize(chunkedBlob.size)}`);
                return chunkedBlob;
            }
        } catch (error) {
            console.error(`❌ Chunked download failed:`, error);
        }
    }

    try {
        console.log(`🔄 Trying base64 fallback for file ${fileId}`);

        const res = await apiFetch(
            `file&user_id=${encodeURIComponent(userId)}&file_id=${encodeURIComponent(fileId)}`,
            { method: 'GET' }
        );

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const fileData = await res.json();

        if (!fileData.success || !fileData.content) {
            console.warn(`⚠️ Base64 fallback unavailable`);
            return null;
        }

        const blob = await base64ToBlobFast(
            fileData.content,
            fileData.file?.mime_type || mimeType
        );

        if (blob && blob.size > 0) {
            console.log(`✅ Base64 download complete: ${formatSize(blob.size)}`);
            return blob;
        }
    } catch (error) {
        console.error(`❌ Base64 fallback failed:`, error);
    }

    console.error(`❌ ALL download methods failed for file ${fileId}`);
    return null;
}

async function downloadFileByChunks(userId, serverFile) {
    const fileId = Number(serverFile.file_id);
    const totalSize = Number(serverFile.size || serverFile.file_size || 0);

    if (!fileId || !totalSize) throw new Error('Invalid file information');

    const chunkSize = typeof CHUNK_SIZE !== 'undefined' ? CHUNK_SIZE : 1 * 1024 * 1024;
    const totalChunks = Math.ceil(totalSize / chunkSize);
    const CHUNK_CONCURRENCY = typeof CHUNK_DOWNLOAD_CONCURRENCY !== 'undefined' ? CHUNK_DOWNLOAD_CONCURRENCY : 3;
    const MAX_RETRIES = 3;

    console.log(`📦 ${serverFile.original_name || fileId}: ${totalChunks} chunks × ${formatSize(chunkSize)}`);

    const chunks = new Array(totalChunks);
    let completedChunks = 0;

    async function downloadChunk(chunkIndex) {
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const endpoint =
                    `file_chunk&user_id=${encodeURIComponent(userId)}` +
                    `&file_id=${encodeURIComponent(fileId)}` +
                    `&chunk=${encodeURIComponent(chunkIndex)}`;

                const response = await apiFetch(endpoint, { method: 'GET' });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const contentType = (response.headers.get('content-type') || '').toLowerCase();
                if (contentType.includes('text/html')) {
                    throw new Error('Server returned HTML instead of JSON');
                }

                const data = await response.json();

                if (!data.success || !data.chunk_content) {
                    throw new Error(data.error || 'Invalid chunk response');
                }

                const chunkBlob = await base64ToBlobFast(
                    data.chunk_content,
                    serverFile.mime_type || 'application/octet-stream'
                );

                if (!chunkBlob || chunkBlob.size <= 0) throw new Error('Empty chunk received');

                const expectedChunkSize = Math.min(chunkSize, totalSize - (chunkIndex * chunkSize));

                if (chunkBlob.size !== expectedChunkSize) {
                    throw new Error(`Chunk size mismatch. Expected ${expectedChunkSize}, received ${chunkBlob.size}`);
                }

                chunks[chunkIndex] = chunkBlob;
                completedChunks++;

                const percent = Math.round((completedChunks / totalChunks) * 100);
                console.log(`📦 ${serverFile.original_name || fileId}: chunk ${chunkIndex + 1}/${totalChunks} (${percent}%)`);

                return;
            } catch (error) {
                lastError = error;
                console.warn(`⚠️ Chunk ${chunkIndex} attempt ${attempt}/${MAX_RETRIES}: ${error.message}`);

                if (attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }

        throw new Error(`Chunk ${chunkIndex} failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'Unknown error'}`);
    }

    let nextChunk = 0;

    async function worker() {
        while (true) {
            const current = nextChunk++;
            if (current >= totalChunks) return;
            await downloadChunk(current);
        }
    }

    const workers = [];
    const workerCount = Math.min(CHUNK_CONCURRENCY, totalChunks);

    for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    for (let i = 0; i < totalChunks; i++) {
        if (!chunks[i]) throw new Error(`Missing chunk ${i}`);
    }

    console.log(`🧩 Combining ${totalChunks} chunks...`);

    const finalBlob = new Blob(chunks, { type: serverFile.mime_type || 'application/octet-stream' });

    if (finalBlob.size !== totalSize) {
        throw new Error(`Final file size mismatch. Expected ${totalSize}, received ${finalBlob.size}`);
    }

    console.log(`✅ Final file verified: ${formatSize(finalBlob.size)}`);
    return finalBlob;
}

async function downloadFileToDevice(fileId) {
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };

    const localFile = await getFile(fileId);
    if (!localFile) return { success: false, message: 'File not found' };

    let url = null;

    if (localFile.is_link_share === true && localFile.share_url) {
        url = localFile.share_url;
    } else if (localFile.server_file_id) {
        const base = BACKEND_URL.replace('index.php?route=', '');
        url = base + 'index.php?route=file_raw'
            + '&user_id=' + encodeURIComponent(user.id)
            + '&file_id=' + encodeURIComponent(localFile.server_file_id);
    }

    if (!url) {
        return { success: false, message: 'File not synced to server yet' };
    }

    if (window.Android && typeof window.Android.downloadFileToSafeBox === 'function') {
        window.Android.downloadFileToSafeBox(
            url,
            localFile.original_name,
            localFile.mime_type || 'application/octet-stream'
        );
        return { success: true, message: 'Downloading…' };
    }

    window.open(url, '_blank');
    return { success: true, message: 'Downloading in browser' };
}

async function base64ToBlobFast(base64, mimeType = 'application/octet-stream') {
    const dataUrl = base64.startsWith('data:')
        ? base64
        : `data:${mimeType};base64,${base64}`;
    const res = await fetch(dataUrl);
    return await res.blob();
}

async function createShareLink(fileId, recipientUsername, message = '') {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };

    try {
        const localFile = await getFile(fileId);
        if (!localFile) return { success: false, message: 'File not found' };

        let serverFileId = localFile.server_file_id;
        if (!serverFileId) {
            await updateFileSyncStatus(fileId, 'syncing');
            const up = await syncFileToBackend(localFile);
            if (!up.success || !up.synced) {
                await updateFileSyncStatus(fileId, 'failed', null, up.message);
                return { success: false, message: 'Upload failed: ' + (up.message || 'unknown') };
            }
            serverFileId = up.data?.file?.file_id || up.data?.file?.id;
            await updateFileSyncStatus(fileId, 'synced', serverFileId);
        }

        const res = await apiFetch('share', {
            method: 'POST',
            body: JSON.stringify({
                sender_username: user.username,
                receiver_username: recipientUsername || '',
                file_id: serverFileId,
                message: message || '',
                expires_hours: SHARE_LINK_TTL_HOURS
            })
        });
        const data = await res.json();

        if (!data.success) {
            return { success: false, message: data.error || 'Failed to create link' };
        }

        await new Promise((resolve) => {
            const tx = db.transaction([STORES.SHARED_FILES], 'readwrite');
            const store = tx.objectStore(STORES.SHARED_FILES);
            store.add({
                file_id: fileId,
                sender_id: user.id,
                sender_username: user.username,
                recipient_username: recipientUsername || '',
                recipient_id: null,
                message: message || '',
                shared_at: new Date().toISOString(),
                status: 'shared_link',
                is_link_share: true,
                share_url: data.share_url || null,
                share_token: data.token || null,
                original_name: localFile.original_name,
                file_size: localFile.size,
                share_expires_at: data.expires_at || null,
                synced: true
            });
            tx.oncomplete = resolve;
            tx.onerror = resolve;
        });

        return {
            success: true,
            share_url: data.share_url,
            token: data.token,
            expires_at: data.expires_at,
            is_link: true,
            message: `🔗 Link created (expires in ${SHARE_LINK_TTL_HOURS}h)`
        };
    } catch (e) {
        return { success: false, message: 'Share link error: ' + e.message };
    }
}

async function syncPendingUsers() {
    const online = await isServerOnline();
    if (!online) return { success: false, message: 'Offline' };

    const db = await openDB();
    
    return new Promise((resolve) => {
        const tx = db.transaction([STORES.USERS], 'readonly');
        const store = tx.objectStore(STORES.USERS);
        const req = store.getAll();
        
        req.onsuccess = async () => {
            const allUsers = req.result || [];
            const unsynced = allUsers.filter(u => !u.synced || !u.server_id);
            
            if (unsynced.length === 0) {
                resolve({ success: true, synced: 0 });
                return;
            }
            
            let synced = 0;
            for (const user of unsynced) {
                try {
                    let sqText = 'Default';
                    let sqHash = 'Default';
                    try {
                        const sqData = await new Promise((res) => {
                            const tx2 = db.transaction([STORES.SECURITY_QUESTIONS], 'readonly');
                            const s2 = tx2.objectStore(STORES.SECURITY_QUESTIONS);
                            const idx2 = s2.index('user_id');
                            const r2 = idx2.get(user.id);
                            r2.onsuccess = () => res(r2.result);
                            r2.onerror = () => res(null);
                        });
                        if (sqData) {
                            sqText = sqData.question_text || 'Default';
                            sqHash = sqData.answer_hash || 'Default';
                        }
                    } catch (e) {}

                    const res = await apiFetch('register', {
                        method: 'POST',
                        body: JSON.stringify({
                            username: user.username,
                            password: atob(user.password),
                            display_name: user.display_name || user.username,
                            security_question: sqText,
                            security_answer_hash: sqHash
                        })
                    });
                    const data = await res.json();
                    
                    if (data.success) {
                        await updateLocalUser({
                            ...user, synced: true,
                            server_id: data.user?.id, pending_server_sync: false
                        });
                        synced++;
                    } else if (data.error && data.error.toLowerCase().includes('exist')) {
                        const userRes = await apiFetch('user&username=' + encodeURIComponent(user.username));
                        const userData = await userRes.json();
                        if (userData && userData.id) {
                            await updateLocalUser({
                                ...user, synced: true,
                                server_id: userData.id, pending_server_sync: false
                            });
                            synced++;
                        }
                    }
                } catch (err) {}
            }
            
            resolve({ success: true, synced });
        };
        req.onerror = () => resolve({ success: false, synced: 0 });
    });
}

async function ensureUserOnServer() {
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'No current user' };

    const online = await isServerOnline();
    if (!online) return { success: false, message: 'Offline' };

    const local = await getUserById(user.id);
    if (!local) return { success: false, message: 'Local user record not found' };

    if (local.synced && local.server_id) {
        try {
            const r = await apiFetch('user&username=' + encodeURIComponent(local.username));
            const data = await r.json();
            if (data && data.id) {
                if (Number(data.id) !== Number(local.server_id)) {
                    await updateLocalUser({ ...local, server_id: data.id });
                }
                return { success: true, server_id: data.id };
            }
        } catch (e) { /* fall through */ }
    }

    let sq = 'Default';
    let saHash = 'Default';
    try {
        const db = await openDB();
        const sqData = await new Promise((resolve) => {
            const tx = db.transaction([STORES.SECURITY_QUESTIONS], 'readonly');
            const store = tx.objectStore(STORES.SECURITY_QUESTIONS);
            const idx = store.index('user_id');
            const req = idx.get(local.id);
            req.onsuccess = () => resolve(req.result);
        });
        if (sqData) {
            sq = sqData.question_text || 'Default';
            saHash = sqData.answer_hash || 'Default';
        }
    } catch (e) {}

    const password = local.password ? atob(local.password) : '';

    try {
        const res = await apiFetch('register', {
            method: 'POST',
            body: JSON.stringify({
                username: local.username,
                password: password,
                display_name: local.display_name || local.username,
                security_question: sq,
                security_answer_hash: saHash
            })
        });
        const data = await res.json();

        if (data.success && data.user?.id) {
            await updateLocalUser({
                ...local,
                synced: true,
                server_id: data.user.id,
                pending_server_sync: false
            });
            console.log(`✅ ensureUserOnServer: registered ${local.username} → id ${data.user.id}`);
            return { success: true, server_id: data.user.id };
        }

        if (data.error && data.error.toLowerCase().includes('exist')) {
            const userRes = await apiFetch('user&username=' + encodeURIComponent(local.username));
            const userData = await userRes.json();
            if (userData && userData.id) {
                await updateLocalUser({
                    ...local,
                    synced: true,
                    server_id: userData.id,
                    pending_server_sync: false
                });
                console.log(`✅ ensureUserOnServer: linked ${local.username} → id ${userData.id}`);
                return { success: true, server_id: userData.id };
            }
        }

        return { success: false, message: data.error || 'Registration failed' };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

async function deleteFileFromServer(userId, serverFileId) {
    try {
        const online = await isServerOnline();
        if (!online) return { success: false, offline: true, message: 'Offline' };

        const response = await apiFetch(
            'delete_file&user_id=' + encodeURIComponent(userId) +
            '&file_id=' + encodeURIComponent(serverFileId),
            { method: 'POST' }
        );

        let data = null;
        try { data = await response.json(); } catch (e) {}

        if (response.ok && (!data || data.success !== false)) {
            return { success: true, message: 'Deleted on server' };
        }
        return {
            success: false,
            message: (data && (data.error || data.message)) || ('Server returned ' + response.status)
        };
    } catch (err) {
        return { success: false, message: err.message };
    }
}

async function removeShareFromServer(userId, serverFileId) {
    try {
        const online = await isServerOnline();
        if (!online) return { success: false, offline: true, message: 'Offline' };

        const response = await apiFetch(
            'remove_share&user_id=' + encodeURIComponent(userId) +
            '&file_id=' + encodeURIComponent(serverFileId),
            { method: 'POST' }
        );

        let data = null;
        try { data = await response.json(); } catch (e) {}

        if (response.ok && (!data || data.success !== false)) {
            return { success: true, message: 'Share removed' };
        }
        return {
            success: false,
            message: (data && (data.error || data.message)) || ('Server returned ' + response.status)
        };
    } catch (err) {
        return { success: false, message: err.message };
    }
}

async function queueServerDelete(userId, serverFileId, operation, originalName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.PENDING_DELETES], 'readwrite');
        const store = tx.objectStore(STORES.PENDING_DELETES);
        const idx = store.index('server_file_id');
        const existing = idx.getAll(Number(serverFileId));

        existing.onsuccess = () => {
            const rows = (existing.result || []).filter(r =>
                r.user_id === userId && r.operation === operation
            );
            if (rows.length > 0) {
                resolve({ success: true, alreadyQueued: true });
                return;
            }
            const req = store.add({
                user_id: userId,
                server_file_id: Number(serverFileId),
                operation: operation,
                original_name: originalName || '',
                queued_at: new Date().toISOString(),
                attempts: 0
            });
            req.onsuccess = () => resolve({ success: true, id: req.result });
            req.onerror = () => reject(req.error);
        };
        existing.onerror = () => reject(existing.error);
    });
}

async function processPendingDeletes() {
    const user = getCurrentUser();
    if (!user) return { success: false, processed: 0 };

    const online = await isServerOnline();
    if (!online) return { success: false, processed: 0 };

    const db = await openDB();

    const queued = await new Promise((resolve) => {
        const tx = db.transaction([STORES.PENDING_DELETES], 'readonly');
        const store = tx.objectStore(STORES.PENDING_DELETES);
        const idx = store.index('user_id');
        const req = idx.getAll(user.id);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
    });

    let processed = 0;

    for (const item of queued) {
        const result = item.operation === 'remove_share'
            ? await removeShareFromServer(user.id, item.server_file_id)
            : await deleteFileFromServer(user.id, item.server_file_id);

        if (result.success) {
            await new Promise((resolve) => {
                const tx = db.transaction([STORES.PENDING_DELETES], 'readwrite');
                const store = tx.objectStore(STORES.PENDING_DELETES);
                const req = store.delete(item.id);
                req.onsuccess = resolve;
                req.onerror = resolve;
            });
            processed++;
        } else {
            await new Promise((resolve) => {
                const tx = db.transaction([STORES.PENDING_DELETES], 'readwrite');
                const store = tx.objectStore(STORES.PENDING_DELETES);
                const req = store.get(item.id);
                req.onsuccess = () => {
                    const row = req.result;
                    if (row) {
                        row.attempts = (row.attempts || 0) + 1;
                        if (row.attempts >= 10) store.delete(item.id);
                        else store.put(row);
                    }
                    resolve();
                };
                req.onerror = resolve;
            });
        }
    }

    return { success: true, processed };
}

async function fullSync() {
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };

    const online = await isServerOnline();
    if (!online) return { success: false, message: 'Server offline - cannot sync' };

    let uploaded = 0;
    let downloaded = 0;
    let usersSynced = 0;
    let deletedOnServer = 0;
    let sharesValidated = 0;

    try {
        try { await flushLoginHistory(); } catch (e) {}
        try { await ensureUserOnServer(); } catch (e) {}

        const delResult = await processPendingDeletes();
        if (delResult.success) deletedOnServer = delResult.processed || 0;

        const userSync = await syncPendingUsers();
        if (userSync.success) usersSynced = userSync.synced || 0;

        try {
            const v = await validatePendingShares();
            if (v.success) sharesValidated = v.validated || 0;
        } catch (e) {}

        const upResult = await syncLocalFilesToServer();
        uploaded = upResult.uploaded || 0;

        const result = await syncFilesFromBackend(user.id);
        if (result.success) downloaded = result.newFiles || 0;

        window.dispatchEvent(new CustomEvent('filesSynced', {
            detail: {
                uploaded,
                downloaded,
                usersSynced,
                deletedOnServer,
                sharesValidated,
                at: Date.now()
            }
        }));

        return {
            success: true,
            uploaded,
            downloaded,
            usersSynced,
            deletedOnServer,
            sharesValidated,
            message: `✅ Synced: ${uploaded} up, ${downloaded} down, ${sharesValidated} shares, ${deletedOnServer} deleted`
        };
    } catch (error) {
        console.error('Full sync error:', error);
        window.dispatchEvent(new CustomEvent('syncError', { detail: error }));
        return { success: false, message: error.message };
    }
}

async function updateFileSyncStatus(fileId, status, serverFileId = null, errorMessage = null) {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction([STORES.FILES], 'readwrite');
        const store = tx.objectStore(STORES.FILES);
        const req = store.get(fileId);
        
        req.onsuccess = () => {
            const file = req.result;
            if (file) {
                file.sync_status = status;
                file.synced = (status === 'synced');
                if (serverFileId) file.server_file_id = serverFileId;
                if (errorMessage) file.sync_error = errorMessage;
                if (status === 'synced') {
                    file.synced_at = new Date().toISOString();
                    delete file.sync_error;
                }
                if (status === 'syncing') {
                    file.syncing_started_at = new Date().toISOString();
                }
                store.put(file);
            }
            resolve();
        };
        req.onerror = () => resolve();
    });
}

function validatePassword(password) {
    const errors = [];
    if (password.length < 6) errors.push('Password must be at least 6 characters');
    if (!/[a-zA-Z]/.test(password)) errors.push('Password must contain at least one letter');
    if (!/[0-9]/.test(password)) errors.push('Password must contain at least one number');
    return { valid: errors.length === 0, errors };
}

async function registerUser(username, password, securityQuestion, securityAnswer) {
    const validation = validatePassword(password);
    if (!validation.valid) return { success: false, message: validation.errors.join(', ') };

    if (!username || username.length < 3) {
        return { success: false, message: 'Username must be at least 3 characters' };
    }

    if (!securityQuestion || !securityAnswer) {
        return { success: false, message: 'Please provide a security question and answer' };
    }

    const db = await openDB();
    const existingLocal = await getUserByUsername(username);
    if (existingLocal) return { success: false, message: 'Username already exists locally' };

    const online = await isServerOnline();
    if (online) {
        try {
            const res = await apiFetch('user&username=' + encodeURIComponent(username));
            const data = await res.json();
            if (data && data.id) return { success: false, message: 'Username already exists on server' };
        } catch (e) {}
    }

    const localUserId = getNextLocalUserId();
    const answerHash = btoa(securityAnswer.toLowerCase().trim());

    const user = {
        id: localUserId,
        username,
        password: btoa(password),
        display_name: username,
        created_at: new Date().toISOString(),
        storage_limit: DEFAULT_STORAGE_LIMIT,
        storage_used: 0,
        is_active: true,
        last_login: new Date().toISOString(),
        failed_attempts: 0,
        locked_until: null,
        total_uploads: 0,
        total_backups: 0,
        synced: false,
        server_id: null,
        pending_server_sync: true
    };

    let userId;
    try {
        userId = await new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.USERS, STORES.SECURITY_QUESTIONS, STORES.FILE_STATS], 'readwrite');
            const store = transaction.objectStore(STORES.USERS);
            const addRequest = store.add(user);
            
            addRequest.onsuccess = () => {
                const uid = localUserId;
                const questionStore = transaction.objectStore(STORES.SECURITY_QUESTIONS);
                questionStore.add({
                    user_id: uid,
                    question_text: securityQuestion,
                    answer_hash: answerHash
                });
                
                const statsStore = transaction.objectStore(STORES.FILE_STATS);
                const today = new Date().toISOString().split('T')[0];
                statsStore.add({ user_id: uid, date: today, type: 'upload', count: 0 });
                statsStore.add({ user_id: uid, date: today, type: 'backup', count: 0 });
                resolve(uid);
            };
            addRequest.onerror = () => reject(addRequest.error);
        });
    } catch (err) {
        return { success: false, message: 'Failed to save locally: ' + err.message };
    }

    let serverSynced = false;
    let serverUserId = null;
    let syncMessage = '✅ Account created (offline - will sync later)';

    if (online) {
        try {
            const result = await syncUserToBackend({
                username,
                password,
                display_name: username,
                security_question: securityQuestion,
                security_answer_hash: answerHash
            });

            if (result.success && result.synced) {
                serverSynced = true;
                serverUserId = result.data?.user?.id;
                syncMessage = '✅ Account created and synced to server';

                await new Promise((resolve) => {
                    const tx = db.transaction([STORES.USERS], 'readwrite');
                    const store = tx.objectStore(STORES.USERS);
                    const getReq = store.get(userId);
                    getReq.onsuccess = () => {
                        const u = getReq.result;
                        u.synced = true;
                        u.server_id = serverUserId;
                        u.pending_server_sync = false;
                        store.put(u);
                        resolve();
                    };
                });
            } else {
                syncMessage = '⚠️ Saved locally. Server sync failed - will retry';
            }
        } catch (err) {
            syncMessage = '📡 Saved locally. Will sync when online.';
        }
    }

    const sessionId = serverUserId || userId;
    localStorage.setItem('user_id', String(sessionId));
    localStorage.setItem('username', username);
    sessionStorage.setItem('user_session', JSON.stringify({
        id: sessionId, username, server_id: serverUserId, local_id: userId,
        loginTime: new Date().toISOString()
    }));

    logLoginAttempt(userId, 'success', 'Account created and auto-logged in');

    enableNativeBackgroundSync();

    return {
        success: true, message: syncMessage, id: sessionId,
        local_id: userId, server_id: serverUserId, synced: serverSynced,
        user: { ...user, id: sessionId, server_id: serverUserId, synced: serverSynced },
        autoLoggedIn: true
    };
}

async function loginUser(username, password) {
    const db = await openDB();

    const localUser = await new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.USERS], 'readonly');
        const store = tx.objectStore(STORES.USERS);
        const index = store.index('username');
        const req = index.get(username);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (localUser) {
        if (localUser.locked_until && new Date(localUser.locked_until) > new Date()) {
            return { success: false, message: 'Account locked. Try again later.' };
        }

        if (localUser.password !== btoa(password)) {
            localUser.failed_attempts = (localUser.failed_attempts || 0) + 1;
            if (localUser.failed_attempts >= 5) {
                localUser.locked_until = new Date(Date.now() + 15 * 60000).toISOString();
            }
            await updateLocalUser(localUser);
            logLoginAttempt(localUser.id, 'failed', 'Incorrect password');
            const remaining = 5 - localUser.failed_attempts;
            return {
                success: false,
                message: `Incorrect password. ${remaining > 0 ? remaining + ' attempts remaining' : 'Account locked'}`
            };
        }

        localUser.failed_attempts = 0;
        localUser.locked_until = null;
        localUser.last_login = new Date().toISOString();
        await updateLocalUser(localUser);

        const sessionId = localUser.server_id || localUser.id;
        localStorage.setItem('user_id', String(sessionId));
        localStorage.setItem('username', localUser.username);
        sessionStorage.setItem('user_session', JSON.stringify({
            id: sessionId, username: localUser.username,
            server_id: localUser.server_id, local_id: localUser.id,
            loginTime: new Date().toISOString()
        }));

        try { await ensureUserOnServer(); } catch (e) {}
        try { await logLoginAttempt(localUser.id, 'success', 'Manual login (local)'); } catch (e) {}

        syncLoginToServer(username, password, localUser);

        enableNativeBackgroundSync();

        return {
            success: true, message: '✅ Login successful!',
            user: { ...localUser, id: sessionId },
            userId: sessionId, synced: localUser.synced
        };
    }

    const online = await isServerOnline();
    if (!online) return { success: false, message: 'User not found locally and server offline' };

    try {
        const response = await apiFetch('login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!data.success) return { success: false, message: data.error || 'Invalid credentials' };

        const newUser = {
            id: data.user.id,
            username: data.user.username,
            password: btoa(password),
            display_name: data.user.display_name || data.user.username,
            created_at: data.user.created_at || new Date().toISOString(),
            storage_limit: data.user.storage_limit || DEFAULT_STORAGE_LIMIT,
            storage_used: data.user.storage_used || 0,
            is_active: true,
            last_login: new Date().toISOString(),
            failed_attempts: 0,
            locked_until: null,
            total_uploads: data.user.total_uploads || 0,
            total_backups: data.user.total_backups || 0,
            synced: true,
            server_id: data.user.id,
            pending_server_sync: false
        };

        await new Promise((resolve, reject) => {
            const tx = db.transaction([STORES.USERS], 'readwrite');
            const store = tx.objectStore(STORES.USERS);
            const req = store.add(newUser);
            req.onsuccess = resolve;
            req.onerror = reject;
        });

        const currentCounter = parseInt(localStorage.getItem('safebox_next_local_id') || '1');
        if (data.user.id >= currentCounter) {
            localStorage.setItem('safebox_next_local_id', String(data.user.id));
        }

        localStorage.setItem('user_id', String(data.user.id));
        localStorage.setItem('username', username);
        sessionStorage.setItem('user_session', JSON.stringify({
            id: data.user.id, username,
            server_id: data.user.id, loginTime: new Date().toISOString()
        }));

        try { await logLoginAttempt(data.user.id, 'success', 'Manual login (server)'); } catch (e) {}

        enableNativeBackgroundSync();

        return {
            success: true, message: '✅ Login successful!',
            user: newUser, userId: data.user.id, synced: true
        };
    } catch (err) {
        return { success: false, message: 'Login failed: ' + err.message };
    }
}

async function updateLocalUser(user) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.USERS], 'readwrite');
        const store = tx.objectStore(STORES.USERS);
        const req = store.put(user);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function syncLoginToServer(username, password, localUser) {
    try {
        const online = await isServerOnline();
        if (!online) return;

        if (!localUser.synced || !localUser.server_id) {
            let sq = 'Default';
            let saHash = 'Default';
            try {
                const db = await openDB();
                const sqData = await new Promise((resolve) => {
                    const tx = db.transaction([STORES.SECURITY_QUESTIONS], 'readonly');
                    const store = tx.objectStore(STORES.SECURITY_QUESTIONS);
                    const idx = store.index('user_id');
                    const req = idx.get(localUser.id);
                    req.onsuccess = () => resolve(req.result);
                });
                if (sqData) {
                    sq = sqData.question_text || 'Default';
                    saHash = sqData.answer_hash || 'Default';
                }
            } catch (e) {}

            const res = await apiFetch('register', {
                method: 'POST',
                body: JSON.stringify({
                    username, password,
                    display_name: localUser.display_name || username,
                    security_question: sq,
                    security_answer_hash: saHash
                })
            });
            const data = await res.json();

            if (data.success) {
                await updateLocalUser({
                    ...localUser, synced: true,
                    server_id: data.user?.id, pending_server_sync: false
                });
                localStorage.setItem('user_id', String(data.user?.id));
            } else if (data.error && data.error.toLowerCase().includes('exist')) {
                const userRes = await apiFetch('user&username=' + encodeURIComponent(username));
                const userData = await userRes.json();
                if (userData && userData.id) {
                    await updateLocalUser({
                        ...localUser, synced: true,
                        server_id: userData.id, pending_server_sync: false
                    });
                    localStorage.setItem('user_id', String(userData.id));
                }
            }
            return;
        }

        await apiFetch('login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    } catch (err) {}
}

async function logLoginAttempt(userId, status, message) {
    let resolvedId = userId;
    try {
        const local = await getUserById(userId);
        if (local && local.server_id) {
            resolvedId = local.server_id;
        }
    } catch (e) {}

    const entry = {
        user_id: resolvedId,
        login_date: new Date().toISOString(),
        status: status,
        message: message,
        device_info: navigator.userAgent || 'Unknown',
        synced: false
    };

    let localId = null;
    try {
        const db = await openDB();
        localId = await new Promise((resolve, reject) => {
            const tx = db.transaction([STORES.LOGIN_HISTORY], 'readwrite');
            const store = tx.objectStore(STORES.LOGIN_HISTORY);
            const req = store.add(entry);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('Local login-history write failed:', e);
    }

    try {
        const online = await isServerOnline();
        if (online) {
            const ok = await pushLoginHistoryEntry(entry);
            if (ok && localId != null) {
                await markLoginHistorySynced(localId);
            }
        }
    } catch (e) { /* silent */ }
}

async function pushLoginHistoryEntry(entry) {
    try {
        const res = await apiFetch('log_login', {
            method: 'POST',
            body: JSON.stringify({
                user_id: entry.user_id,
                status: entry.status,
                message: entry.message,
                device_info: entry.device_info
            })
        });
        const data = await res.json();
        return data.success === true;
    } catch (e) {
        return false;
    }
}

async function markLoginHistorySynced(localId) {
    try {
        const db = await openDB();
        await new Promise((resolve) => {
            const tx = db.transaction([STORES.LOGIN_HISTORY], 'readwrite');
            const store = tx.objectStore(STORES.LOGIN_HISTORY);
            const req = store.get(localId);
            req.onsuccess = () => {
                const row = req.result;
                if (row) {
                    row.synced = true;
                    row.synced_at = new Date().toISOString();
                    store.put(row);
                }
                resolve();
            };
            req.onerror = () => resolve();
        });
    } catch (e) {}
}

async function flushLoginHistory() {
    const online = await isServerOnline();
    if (!online) return { success: false, pushed: 0 };

    const db = await openDB();

    const rows = await new Promise((resolve) => {
        const tx = db.transaction([STORES.LOGIN_HISTORY], 'readonly');
        const store = tx.objectStore(STORES.LOGIN_HISTORY);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
    });

    const unsynced = rows.filter(r => r.synced !== true);
    if (unsynced.length === 0) return { success: true, pushed: 0 };

    let pushed = 0;
    for (const row of unsynced) {
        const ok = await pushLoginHistoryEntry(row);
        if (ok) {
            await markLoginHistorySynced(row.id);
            pushed++;
            continue;
        }

        const currentUser = getCurrentUser();
        const localUser = currentUser ? await getUserById(currentUser.id) : null;
        const correctId = localUser?.server_id ?? currentUser?.id;

        if (correctId && correctId !== row.user_id) {
            const fixed = { ...row, user_id: correctId };
            const okRetry = await pushLoginHistoryEntry(fixed);
            if (okRetry) {
                await markLoginHistorySynced(row.id);
                pushed++;
                continue;
            }
        }

        const attempts = (row.sync_attempts || 0) + 1;
        if (attempts >= 3) {
            await markLoginHistorySynced(row.id);
            console.log(`📝 Login history: gave up on entry ${row.id} after 3 attempts`);
        } else {
            const db2 = await openDB();
            await new Promise((resolve) => {
                const tx = db2.transaction([STORES.LOGIN_HISTORY], 'readwrite');
                const store = tx.objectStore(STORES.LOGIN_HISTORY);
                const req = store.get(row.id);
                req.onsuccess = () => {
                    const r = req.result;
                    if (r) {
                        r.sync_attempts = attempts;
                        store.put(r);
                    }
                    resolve();
                };
                req.onerror = () => resolve();
            });
        }
    }

    console.log(`📝 Login history: pushed ${pushed}/${unsynced.length}`);
    return { success: true, pushed };
}

function getCurrentUser() {
    try {
        const userId = localStorage.getItem('user_id');
        const username = localStorage.getItem('username');
        if (userId && username) return { id: parseInt(userId), username };

        const sessionData = sessionStorage.getItem('user_session');
        if (sessionData) {
            try {
                const parsed = JSON.parse(sessionData);
                if (parsed.id && parsed.username) {
                    localStorage.setItem('user_id', String(parsed.id));
                    localStorage.setItem('username', parsed.username);
                    return { id: parsed.id, username: parsed.username };
                }
            } catch (e) {}
        }
        return null;
    } catch (error) {
        return null;
    }
}

function logoutUser() {
    try {
        stopBackgroundSync();
        disableNativeBackgroundSync();
        localStorage.removeItem('user_id');
        localStorage.removeItem('username');
        sessionStorage.removeItem('user_session');
        window.location.href = 'login.html';
    } catch (error) {
        window.location.href = 'login.html';
    }
}

async function getUserById(id) {
    if (!id) return null;
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.USERS], 'readonly');
            const store = transaction.objectStore(STORES.USERS);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return null;
    }
}

async function getSecurityQuestion(username) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.USERS, STORES.SECURITY_QUESTIONS], 'readonly');
        const userStore = transaction.objectStore(STORES.USERS);
        const userIndex = userStore.index('username');
        const userRequest = userIndex.get(username);
        
        userRequest.onsuccess = () => {
            const user = userRequest.result;
            if (!user) return resolve({ success: false, message: 'User not found' });
            
            const questionStore = transaction.objectStore(STORES.SECURITY_QUESTIONS);
            const questionIndex = questionStore.index('user_id');
            const questionRequest = questionIndex.get(user.id);
            
            questionRequest.onsuccess = () => {
                const question = questionRequest.result;
                if (!question) return resolve({ success: false, message: 'Security question not found' });
                resolve({ success: true, user_id: user.id, question: question.question_text });
            };
            questionRequest.onerror = () => reject(questionRequest.error);
        };
        userRequest.onerror = () => reject(userRequest.error);
    });
}

async function verifySecurityAnswer(userId, answer) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.SECURITY_QUESTIONS], 'readonly');
        const store = transaction.objectStore(STORES.SECURITY_QUESTIONS);
        const index = store.index('user_id');
        const request = index.get(userId);
        
        request.onsuccess = () => {
            const storedQuestion = request.result;
            if (!storedQuestion) return resolve({ success: false, message: 'Security question not found' });
            
            if (storedQuestion.answer_hash === btoa(answer.toLowerCase().trim())) {
                resolve({ success: true, message: '✅ Security answer verified!' });
            } else {
                resolve({ success: false, message: '❌ Incorrect security answer' });
            }
        };
        request.onerror = () => reject(request.error);
    });
}

async function resetPasswordWithSecurity(userId, newPassword) {
    const validation = validatePassword(newPassword);
    if (!validation.valid) return { success: false, message: 'Password must be at least 6 characters' };
    
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.USERS], 'readwrite');
        const store = transaction.objectStore(STORES.USERS);
        const request = store.get(userId);
        
        request.onsuccess = () => {
            const user = request.result;
            if (!user) return resolve({ success: false, message: 'User not found' });
            
            user.password = btoa(newPassword);
            user.failed_attempts = 0;
            user.locked_until = null;
            store.put(user);
            resolve({ success: true, message: '✅ Password reset successfully!' });
        };
        request.onerror = () => reject(request.error);
    });
}

function getSecurityQuestionsList() {
    return SECURITY_QUESTIONS;
}

async function checkUserOnServer(username) {
    try {
        const online = await isServerOnline();
        if (!online) return { success: false, message: 'Server offline', exists: false, isOffline: true };
        
        const response = await apiFetch('user&username=' + encodeURIComponent(username));
        
        if (!response.ok) {
            if (response.status === 404) {
                return { success: true, exists: false };
            }
            return { success: false, message: 'Server error', exists: false, isOffline: true };
        }
        
        const data = await response.json();
        if (data && data.id) return { success: true, exists: true, user: data };
        return { success: true, exists: false };
    } catch (error) {
        return { success: false, message: error.message, exists: false, isOffline: true };
    }
}

async function getUserByUsername(username) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.USERS], 'readonly');
        const store = transaction.objectStore(STORES.USERS);
        const index = store.index('username');
        const request = index.get(username);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveUserToLocal(userData) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.USERS], 'readwrite');
        const store = transaction.objectStore(STORES.USERS);
        
        const user = {
            id: userData.id,
            username: userData.username,
            display_name: userData.display_name || userData.username,
            synced: true,
            server_id: userData.id,
            created_at: new Date().toISOString(),
            storage_limit: DEFAULT_STORAGE_LIMIT,
            storage_used: 0,
            is_active: true,
            last_login: new Date().toISOString(),
            failed_attempts: 0,
            locked_until: null,
            total_uploads: 0,
            total_backups: 0
        };
        
        const request = store.add(user);
        request.onsuccess = () => resolve({ success: true, user: user, id: userData.id });
        request.onerror = () => reject(request.error);
    });
}

async function saveFile(fileData, fileBlob) {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };
    
    if (!fileData || !fileData.name) {
        return { success: false, message: 'Invalid file data' };
    }
    
    if (fileBlob && fileBlob.size > MAX_FILE_SIZE) {
        return { 
            success: false, 
            message: `File too large! Maximum size is 800MB. Your file is ${(fileBlob.size / 1024 / 1024).toFixed(1)}MB.` 
        };
    }
    
    const storageInfo = await getStorageInfo(user.id);
    if (storageInfo && (storageInfo.used + fileBlob.size) > storageInfo.limit) {
        return { 
            success: false, 
            message: `Storage limit exceeded! ${storageInfo.remainingGB.toFixed(1)}GB remaining.` 
        };
    }
    
    const fileId = await new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.FILES], 'readwrite');
        const store = transaction.objectStore(STORES.FILES);
        
        const file = {
            user_id: user.id,
            original_name: fileData.name,
            file_name: Date.now() + '_' + fileData.name,
            blob: fileBlob,
            size: fileBlob.size,
            mime_type: fileData.type || 'application/octet-stream',
            file_type: getFileType(fileData.name),
            extension: fileData.name.split('.').pop().toLowerCase(),
            uploaded_at: new Date().toISOString(),
            shared: false,
            shared_with: [],
            is_backup: false,
            synced: false,
            sync_status: 'local',
            is_shared_with_me: false,
            is_link_share: false
        };
        
        const request = store.add(file);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    
    incrementFileStats(user.id, 'upload');
    console.log(`💾 Saved locally: ${fileData.name}`);
    
    window.dispatchEvent(new CustomEvent('filesSynced', {
        detail: { uploaded: 0, downloaded: 0, local: true, at: Date.now() }
    }));
    
    syncFileInBackground(fileId);
    wakeSyncLoop();

    return { 
        success: true, 
        message: '✅ File saved locally', 
        id: fileId,
        synced: false
    };
}

async function syncFileInBackground(fileId) {
    try {
        const online = await isServerOnline();
        if (!online) {
            console.log('📡 Offline - file queued for later sync');
            return;
        }
        
        const db = await openDB();
        const file = await new Promise((resolve) => {
            const tx = db.transaction([STORES.FILES], 'readonly');
            const store = tx.objectStore(STORES.FILES);
            const req = store.get(fileId);
            req.onsuccess = () => resolve(req.result);
        });
        
        if (!file) return;
        
        await updateFileSyncStatus(fileId, 'syncing');
        
        const result = await syncFileToBackend(file);
        
        if (result.success && result.synced) {
            await updateFileSyncStatus(fileId, 'synced', result.data?.file?.file_id);
            console.log(`✅ Synced: ${file.original_name}`);
            window.dispatchEvent(new CustomEvent('fileSynced', {
                detail: { fileId, name: file.original_name }
            }));
            window.dispatchEvent(new CustomEvent('filesSynced', {
                detail: { uploaded: 1, downloaded: 0, at: Date.now() }
            }));
        } else {
            await updateFileSyncStatus(fileId, 'failed', null, result.message);
            console.warn(`⚠️ Sync failed: ${file.original_name} - ${result.message}`);
        }
    } catch (err) {
        console.error('Background sync error:', err);
        await updateFileSyncStatus(fileId, 'failed', null, err.message);
    }
}

async function getFiles(type = 'all') {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return [];
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.FILES], 'readonly');
        const store = transaction.objectStore(STORES.FILES);
        const index = store.index('user_id');
        const request = index.getAll(user.id);
        
        request.onsuccess = () => {
            let files = request.result || [];
            
            if (type !== 'all') {
                files = files.filter(f => f.file_type === type);
            }
            
            files.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
            
            files = files.map(f => ({
                ...f,
                display_status: getDisplayStatus(f)
            }));
            
            resolve(files);
        };
        request.onerror = () => reject(request.error);
    });
}

function getDisplayStatus(file) {
    if (file.is_link_share) return 'link';
    if (file.sync_status === 'synced') return 'synced';
    if (file.sync_status === 'syncing') return 'syncing';
    if (file.sync_status === 'failed') return 'failed';
    if (file.synced || file.server_file_id) return 'synced';
    return 'local';
}

async function getFile(id) {
    try {
        const db = await openDB();
        const user = getCurrentUser();
        if (!user) return null;
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.FILES], 'readonly');
            const store = transaction.objectStore(STORES.FILES);
            const request = store.get(id);
            
            request.onsuccess = async () => {
                try {
                    const file = request.result;
                    if (file && file.blob) {
                        const isPdf = file.extension === 'pdf' || 
                                     file.original_name.toLowerCase().endsWith('.pdf') ||
                                     file.mime_type === 'application/pdf';
                        
                        if (isPdf && file.blob.type !== 'application/pdf') {
                            try {
                                const arrayBuffer = await file.blob.arrayBuffer();
                                file.blob = new Blob([arrayBuffer], { type: 'application/pdf' });
                                file.mime_type = 'application/pdf';
                            } catch (e) {}
                        }
                        resolve(file);
                    } else if (file) {
                        resolve(file);
                    } else {
                        resolve(null);
                    }
                } catch (error) {
                    reject(error);
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return null;
    }
}

async function deleteFile(id) {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };

    const file = await new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.FILES], 'readonly');
        const store = tx.objectStore(STORES.FILES);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (!file || file.user_id !== user.id) {
        return { success: false, message: 'File not found' };
    }

    const isLink = file.is_link_share === true;
    const isShared = file.is_shared_with_me === true ||
                     file.shared_from != null ||
                     file.source_type === 'shared' ||
                     file.source_type === 'broadcast' ||
                     file.source_type === 'public';

    let serverResult = { success: true, skipped: true };
    if (file.server_file_id) {
        if (isShared) {
            serverResult = await removeShareFromServer(user.id, file.server_file_id);
            if (serverResult.offline) {
                await queueServerDelete(user.id, file.server_file_id, 'remove_share', file.original_name);
            }
        } else {
            serverResult = await deleteFileFromServer(user.id, file.server_file_id);
            if (serverResult.offline) {
                await queueServerDelete(user.id, file.server_file_id, 'delete_file', file.original_name);
            }
        }
    }

    await new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.FILES], 'readwrite');
        const store = tx.objectStore(STORES.FILES);
        const req = store.delete(id);
        req.onsuccess = resolve;
        req.onerror = () => reject(req.error);
    });

    window.dispatchEvent(new CustomEvent('filesSynced', {
        detail: { deleted: 1, local: true, at: Date.now() }
    }));

    wakeSyncLoop();

    let msg = '🗑️ File deleted';
    if (isLink) msg = '🔗 Link share removed';
    else if (serverResult.offline) msg = '🗑️ Deleted locally — will sync to server when online';
    else if (!serverResult.success) msg = '🗑️ Deleted locally — server retry queued';
    else if (isShared) msg = '🗑️ Removed from your list';

    return { success: true, message: msg };
}

async function getStorageUsed(userId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.FILES], 'readonly');
        const store = transaction.objectStore(STORES.FILES);
        const index = store.index('user_id');
        const request = index.getAll(userId);
        
        request.onsuccess = () => {
            const total = request.result
                .filter(f => !f.is_link_share)
                .reduce((sum, file) => sum + (file.size || 0), 0);
            resolve(total);
        };
        request.onerror = () => reject(request.error);
    });
}

async function getStorageInfo(userId) {
    const user = await getUserById(userId);
    if (!user) return null;
    
    const used = await getStorageUsed(userId);
    const limit = user.storage_limit || DEFAULT_STORAGE_LIMIT;
    const safeLimit = limit > 0 ? limit : DEFAULT_STORAGE_LIMIT;
    
    return {
        used, limit: safeLimit,
        usedGB: used / 1024 / 1024 / 1024,
        limitGB: safeLimit / 1024 / 1024 / 1024,
        usedMB: used / 1024 / 1024,
        limitMB: safeLimit / 1024 / 1024,
        percentage: Math.min((used / safeLimit) * 100, 100),
        remaining: safeLimit - used,
        remainingGB: (safeLimit - used) / 1024 / 1024 / 1024
    };
}

async function shareFile(fileId, recipientUsername, message = '') {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };
    
    if (!recipientUsername || recipientUsername.trim() === '') {
        return { success: false, message: 'Please enter a recipient username' };
    }
    
    recipientUsername = recipientUsername.trim();
    if (recipientUsername === user.username) {
        return { success: false, message: 'Cannot share with yourself' };
    }

    let fileSize = 0;
    try {
        const f = await getFile(fileId);
        fileSize = f ? (f.size || 0) : 0;
    } catch (e) {}

    if (fileSize > LARGE_FILE_THRESHOLD) {
        console.log(`🔗 Large file (${formatSize(fileSize)}) — using LINK share (expires in ${SHARE_LINK_TTL_HOURS}h)`);
        return await createShareLink(fileId, recipientUsername, message);
    }

    try {
        const online = await isServerOnline();
        let serverUserExists = false;
        let serverUserData = null;
        
        if (online) {
            try {
                const response = await apiFetch('user&username=' + encodeURIComponent(recipientUsername));
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.id) {
                        serverUserExists = true;
                        serverUserData = data;
                    }
                }
            } catch (e) {}
        }
        
        const localUser = await getUserByUsername(recipientUsername);
        if (serverUserExists && !localUser) {
            await saveUserToLocal(serverUserData);
        }
        
        const finalLocalUser = await getUserByUsername(recipientUsername);
        if (finalLocalUser) {
            return await shareFileToLocalUser(fileId, recipientUsername, message);
        }
        
        if (serverUserExists) {
            return { success: false, message: 'User exists but could not be saved locally' };
        }
        
        return await savePendingShare(fileId, recipientUsername, message);
    } catch (error) {
        return { success: false, message: 'Share failed: ' + error.message };
    }
}

async function shareFileToLocalUser(fileId, recipientUsername, message) {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };

    const recipient = await new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.USERS], 'readonly');
        const store = tx.objectStore(STORES.USERS);
        const idx = store.index('username');
        const req = idx.get(recipientUsername);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (!recipient) {
        return { success: false, message: `Recipient "${recipientUsername}" not found` };
    }

    const file = await new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.FILES], 'readonly');
        const store = tx.objectStore(STORES.FILES);
        const req = store.get(fileId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (!file || file.user_id !== user.id) {
        return { success: false, message: 'File not found' };
    }

    const share = {
        file_id: fileId,
        sender_id: user.id,
        sender_username: user.username,
        recipient_id: recipient.id,
        recipient_username: recipient.username,
        message: message || '',
        shared_at: new Date().toISOString(),
        status: 'pending',
        is_unknown_receiver: false,
        is_link_share: false,
        synced: false
    };

    file.shared = true;
    file.shared_with = file.shared_with || [];
    if (!file.shared_with.includes(recipient.id)) {
        file.shared_with.push(recipient.id);
    }

    if (!file.server_file_id) {
        file.recipient_username = recipient.username;
    }

    await new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.SHARED_FILES, STORES.FILES], 'readwrite');
        const shareStore = tx.objectStore(STORES.SHARED_FILES);
        const fileStore = tx.objectStore(STORES.FILES);

        shareStore.add(share);
        fileStore.put(file);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

    isServerOnline().then(online => {
        if (online) syncShareToBackend(share).catch(() => {});
    });
    wakeSyncLoop();

    return { success: true, message: '📤 File shared with ' + recipientUsername };
}

async function savePendingShare(fileId, recipientUsername, message) {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };

    try {
        const file = await new Promise((resolve) => {
            const tx = db.transaction([STORES.FILES], 'readonly');
            const store = tx.objectStore(STORES.FILES);
            const req = store.get(fileId);
            req.onsuccess = () => resolve(req.result);
        });
        if (file && !file.server_file_id) {
            file.recipient_username = recipientUsername;
            await new Promise((resolve) => {
                const tx = db.transaction([STORES.FILES], 'readwrite');
                tx.objectStore(STORES.FILES).put(file);
                tx.oncomplete = resolve;
                tx.onerror = resolve;
            });
        }
    } catch (e) {}

    const share = {
        file_id: fileId,
        sender_id: user.id,
        sender_username: user.username,
        recipient_username: recipientUsername,
        recipient_id: null,
        message: message || '',
        shared_at: new Date().toISOString(),
        status: 'pending_validation',
        is_unknown_receiver: true,
        is_link_share: false,
        validation_attempts: 0,
        validation_failed: false,
        validation_message: null,
        synced: false
    };

    const shareId = await new Promise((resolve, reject) => {
        const tx = db.transaction(
            [STORES.SHARED_FILES, STORES.PENDING_SHARES],
            'readwrite'
        );
        const shareStore = tx.objectStore(STORES.SHARED_FILES);
        const pendingStore = tx.objectStore(STORES.PENDING_SHARES);

        const addReq = shareStore.add(share);
        let newShareId = null;

        addReq.onsuccess = () => {
            newShareId = addReq.result;
            pendingStore.add({
                share_id: newShareId,
                username: recipientUsername,
                file_id: fileId,
                sender_id: user.id,
                sender_username: user.username,
                message: message || '',
                created_at: new Date().toISOString(),
                attempts: 0,
                last_attempt: null,
                validated: false,
                validation_failed: false
            });
        };

        tx.oncomplete = () => resolve(newShareId);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

    isServerOnline().then(online => {
        if (online) validatePendingShare(shareId).catch(() => {});
    });
    wakeSyncLoop();

    return {
        success: true,
        message: `📤 File shared with "${recipientUsername}"`,
        share_id: shareId,
        pending_validation: true
    };
}

async function validatePendingShare(shareId) {
    const db = await openDB();

    const share = await new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.SHARED_FILES], 'readonly');
        const req = tx.objectStore(STORES.SHARED_FILES).get(shareId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (!share || share.status !== 'pending_validation') {
        return { success: false, message: 'Share not found or already processed' };
    }

    const online = await isServerOnline();
    if (!online) return { success: false, message: 'Server offline' };

    let serverUser = null;
    try {
        const response = await apiFetch('user&username=' + encodeURIComponent(share.recipient_username));
        const data = await response.json();
        if (data && data.id) serverUser = data;
    } catch (e) {
        return { success: false, message: e.message };
    }

    if (!serverUser) {
        await new Promise((resolve) => {
            const tx = db.transaction([STORES.SHARED_FILES], 'readwrite');
            const store = tx.objectStore(STORES.SHARED_FILES);
            store.get(shareId).onsuccess = (e) => {
                const s = e.target.result;
                if (s) {
                    s.validation_attempts = (s.validation_attempts || 0) + 1;
                    s.validation_failed = true;
                    store.put(s);
                }
            };
            tx.oncomplete = resolve;
            tx.onerror = resolve;
        });
        return { success: false, validated: false };
    }

    const newUser = {
        id: serverUser.id,
        username: serverUser.username,
        display_name: serverUser.display_name || serverUser.username,
        synced: true,
        server_id: serverUser.id,
        created_at: new Date().toISOString(),
        storage_limit: DEFAULT_STORAGE_LIMIT,
        storage_used: 0,
        is_active: true,
        last_login: new Date().toISOString(),
        failed_attempts: 0,
        locked_until: null,
        total_uploads: 0,
        total_backups: 0
    };

    await new Promise((resolve, reject) => {
        const tx = db.transaction(
            [STORES.SHARED_FILES, STORES.PENDING_SHARES, STORES.USERS],
            'readwrite'
        );
        const shareStore = tx.objectStore(STORES.SHARED_FILES);
        const userStore = tx.objectStore(STORES.USERS);
        const pendingStore = tx.objectStore(STORES.PENDING_SHARES);

        shareStore.get(shareId).onsuccess = (e) => {
            const s = e.target.result;
            if (s) {
                s.recipient_id = serverUser.id;
                s.status = 'pending';
                s.is_unknown_receiver = false;
                shareStore.put(s);
            }
        };

        try {
            const addUserReq = userStore.add(newUser);
            addUserReq.onerror = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
        } catch (e) {}

        const idx = pendingStore.index('share_id');
        idx.get(shareId).onsuccess = (e) => {
            const p = e.target.result;
            if (p) {
                p.validated = true;
                pendingStore.put(p);
            }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

    syncShareToBackend(share).catch(() => {});

    return { success: true, validated: true };
}

async function syncShareToBackend(share) {
    try {
        const online = await isServerOnline();
        if (!online) return { success: false, message: 'Offline' };

        const localFile = await getFile(share.file_id);
        if (!localFile) {
            return { success: false, message: 'Local file not found' };
        }

        let serverFileId = localFile.server_file_id || null;

        if (!serverFileId) {
            console.log(`⬆️ "${localFile.original_name}" has no server id — uploading before share`);
            localFile.recipient_username = share.recipient_username;
            const up = await syncFileToBackend(localFile);
            if (!up.success || !up.synced) {
                return { success: false, message: 'Upload failed: ' + (up.message || 'unknown') };
            }
            serverFileId = up.data?.file?.file_id || up.data?.file?.id;
            if (!serverFileId) {
                return { success: false, message: 'Server did not return a file id' };
            }
            await updateFileSyncStatus(localFile.id, 'synced', serverFileId);
            console.log(`   ⬆️ Uploaded → server id ${serverFileId}`);
        }

        const response = await apiFetch('share', {
            method: 'POST',
            body: JSON.stringify({
                file_id: serverFileId,
                sender_username: share.sender_username,
                receiver_username: share.recipient_username,
                message: share.message || '',
                expires_hours: SHARE_LINK_TTL_HOURS
            })
        });

        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function validatePendingShares() {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORES.PENDING_SHARES)) {
        return { success: false, message: 'Store not found' };
    }
    
    const online = await isServerOnline();
    if (!online) return { success: false, message: 'Server offline' };
    
    const pendingShares = await new Promise((resolve) => {
        const tx = db.transaction([STORES.PENDING_SHARES], 'readonly');
        const store = tx.objectStore(STORES.PENDING_SHARES);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
    });

    let validated = 0;
    let failed = 0;

    for (const pending of pendingShares) {
        if (pending.validated) continue;

        if (pending.attempts >= 5) {
            await new Promise((resolve) => {
                const tx = db.transaction([STORES.PENDING_SHARES], 'readwrite');
                const store = tx.objectStore(STORES.PENDING_SHARES);
                store.get(pending.id).onsuccess = (e) => {
                    const p = e.target.result;
                    if (p) {
                        p.validated = true;
                        p.validation_failed = true;
                        store.put(p);
                    }
                };
                tx.oncomplete = resolve;
                tx.onerror = resolve;
            });
            failed++;
            continue;
        }

        const result = await validatePendingShare(pending.share_id);

        await new Promise((resolve) => {
            const tx = db.transaction([STORES.PENDING_SHARES], 'readwrite');
            const store = tx.objectStore(STORES.PENDING_SHARES);
            store.get(pending.id).onsuccess = (e) => {
                const p = e.target.result;
                if (p) {
                    p.attempts = (p.attempts || 0) + 1;
                    p.last_attempt = new Date().toISOString();
                    if (result.success && result.validated) {
                        p.validated = true;
                    }
                    store.put(p);
                }
            };
            tx.oncomplete = resolve;
            tx.onerror = resolve;
        });

        if (result.success && result.validated) validated++;
        else if (result.success === false) failed++;
    }

    return { success: true, validated, failed };
}

async function getSharedFiles() {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return [];
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.SHARED_FILES, STORES.FILES], 'readonly');
        const shareStore = transaction.objectStore(STORES.SHARED_FILES);
        const shareIndex = shareStore.index('recipient_id');
        const shareRequest = shareIndex.getAll(user.id);
        
        shareRequest.onsuccess = () => {
            const shares = shareRequest.result || [];
            const filePromises = shares.map(share => {
                return new Promise((resolveFile) => {
                    const fileStore = transaction.objectStore(STORES.FILES);
                    const fileRequest = fileStore.get(share.file_id);
                    fileRequest.onsuccess = () => resolveFile({ ...share, file: fileRequest.result });
                    fileRequest.onerror = () => resolveFile(share);
                });
            });
            Promise.all(filePromises).then(results => resolve(results));
        };
        shareRequest.onerror = () => reject(shareRequest.error);
    });
}

async function getSharedByMe() {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return [];
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.SHARED_FILES, STORES.FILES], 'readonly');
        const shareStore = transaction.objectStore(STORES.SHARED_FILES);
        const shareIndex = shareStore.index('sender_id');
        const shareRequest = shareIndex.getAll(user.id);
        
        shareRequest.onsuccess = () => {
            const shares = shareRequest.result || [];
            const filePromises = shares.map(share => {
                return new Promise((resolveFile) => {
                    const fileStore = transaction.objectStore(STORES.FILES);
                    const fileRequest = fileStore.get(share.file_id);
                    fileRequest.onsuccess = () => resolveFile({ ...share, file: fileRequest.result });
                    fileRequest.onerror = () => resolveFile(share);
                });
            });
            Promise.all(filePromises).then(results => resolve(results));
        };
        shareRequest.onerror = () => reject(shareRequest.error);
    });
}

async function acceptSharedFile(shareId) {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };

    const share = await new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.SHARED_FILES], 'readonly');
        const store = tx.objectStore(STORES.SHARED_FILES);
        const req = store.get(shareId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (!share || share.recipient_id !== user.id) {
        return { success: false, message: 'Share not found' };
    }

    const originalFile = await new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.FILES], 'readonly');
        const store = tx.objectStore(STORES.FILES);
        const req = store.get(share.file_id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    let newFile = null;
    if (originalFile && originalFile.blob) {
        newFile = {
            user_id: user.id,
            original_name: originalFile.original_name,
            file_name: Date.now() + '_shared_' + originalFile.original_name,
            blob: originalFile.blob,
            size: originalFile.size,
            mime_type: originalFile.mime_type,
            file_type: originalFile.file_type,
            extension: originalFile.extension,
            uploaded_at: new Date().toISOString(),
            shared: false,
            shared_from: share.sender_id,
            shared_from_username: share.sender_username,
            is_backup: false,
            synced: true,
            sync_status: 'synced'
        };
    }

    await new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.SHARED_FILES, STORES.FILES], 'readwrite');
        const shareStore = tx.objectStore(STORES.SHARED_FILES);
        const fileStore = tx.objectStore(STORES.FILES);

        share.status = 'accepted';
        shareStore.put(share);

        if (newFile) fileStore.add(newFile);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

    return { success: true, message: '✅ File accepted!' };
}

async function backupFileOffline(fileData, fileBlob) {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };

    const backup = {
        user_id: user.id,
        file_id: fileData.id || Date.now(),
        name: fileData.name,
        blob: fileBlob,
        size: fileBlob.size,
        type: fileData.type || 'application/octet-stream',
        backup_date: new Date().toISOString(),
        is_restored: false
    };

    const file = {
        user_id: user.id,
        original_name: fileData.name,
        file_name: 'backup_' + Date.now() + '_' + fileData.name,
        blob: fileBlob,
        size: fileBlob.size,
        mime_type: fileData.type || 'application/octet-stream',
        file_type: getFileType(fileData.name),
        extension: fileData.name.split('.').pop().toLowerCase(),
        uploaded_at: new Date().toISOString(),
        shared: false,
        shared_with: [],
        is_backup: true,
        synced: false,
        sync_status: 'local',
        is_link_share: false
    };

    const backupId = await new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.OFFLINE_BACKUPS, STORES.FILES], 'readwrite');
        const backupStore = tx.objectStore(STORES.OFFLINE_BACKUPS);
        const fileStore = tx.objectStore(STORES.FILES);

        const addReq = backupStore.add(backup);
        let newId = null;
        addReq.onsuccess = () => {
            newId = addReq.result;
            fileStore.add(file);
        };

        tx.oncomplete = () => resolve(newId);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

    incrementFileStats(user.id, 'backup');
    wakeSyncLoop();
    return { success: true, message: '💾 Backup saved', id: backupId };
}

async function getOfflineBackups() {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return [];
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.OFFLINE_BACKUPS], 'readonly');
        const store = transaction.objectStore(STORES.OFFLINE_BACKUPS);
        const index = store.index('user_id');
        const request = index.getAll(user.id);
        
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function createShareSession(shareData) {
    try {
        const db = await openDB();
        const transaction = db.transaction([STORES.SHARE_SESSIONS], 'readwrite');
        const store = transaction.objectStore(STORES.SHARE_SESSIONS);
        
        const session = {
            token: shareData.token,
            file_id: shareData.fileId,
            sender_id: shareData.senderId,
            sender_username: shareData.sender,
            file_name: shareData.fileName,
            file_size: shareData.fileSize,
            file_type: shareData.fileType,
            server_ip: shareData.serverIP,
            expiry: shareData.expiry,
            status: 'active',
            created_at: new Date().toISOString(),
            sdp_offer: shareData.sdp || null
        };
        
        return new Promise((resolve, reject) => {
            const request = store.add(session);
            request.onsuccess = () => resolve({ success: true, id: request.result });
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function getShareSession(token) {
    try {
        const db = await openDB();
        const transaction = db.transaction([STORES.SHARE_SESSIONS], 'readonly');
        const store = transaction.objectStore(STORES.SHARE_SESSIONS);
        const index = store.index('token');
        
        return new Promise((resolve, reject) => {
            const request = index.get(token);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return null;
    }
}

async function updateShareSession(token, updates) {
    try {
        const db = await openDB();
        const transaction = db.transaction([STORES.SHARE_SESSIONS], 'readwrite');
        const store = transaction.objectStore(STORES.SHARE_SESSIONS);
        const index = store.index('token');
        
        return new Promise((resolve, reject) => {
            const request = index.get(token);
            request.onsuccess = () => {
                const session = request.result;
                if (!session) return resolve({ success: false, message: 'Session not found' });
                
                Object.assign(session, updates);
                const updateRequest = store.put(session);
                updateRequest.onsuccess = () => resolve({ success: true });
                updateRequest.onerror = () => reject(updateRequest.error);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function deleteShareSession(token) {
    try {
        const db = await openDB();
        const transaction = db.transaction([STORES.SHARE_SESSIONS], 'readwrite');
        const store = transaction.objectStore(STORES.SHARE_SESSIONS);
        const index = store.index('token');
        
        return new Promise((resolve, reject) => {
            const request = index.get(token);
            request.onsuccess = () => {
                const session = request.result;
                if (!session) return resolve({ success: false, message: 'Session not found' });
                
                const deleteRequest = store.delete(session.id);
                deleteRequest.onsuccess = () => resolve({ success: true });
                deleteRequest.onerror = () => reject(deleteRequest.error);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function getActiveShareSessions(userId) {
    try {
        const db = await openDB();
        const transaction = db.transaction([STORES.SHARE_SESSIONS], 'readonly');
        const store = transaction.objectStore(STORES.SHARE_SESSIONS);
        const index = store.index('sender_id');
        
        return new Promise((resolve, reject) => {
            const request = index.getAll(userId);
            request.onsuccess = () => {
                const sessions = request.result || [];
                resolve(sessions.filter(s => s.status === 'active' && s.expiry > Date.now()));
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return [];
    }
}

async function cleanupExpiredShareSessions() {
    try {
        const db = await openDB();
        const transaction = db.transaction([STORES.SHARE_SESSIONS], 'readwrite');
        const store = transaction.objectStore(STORES.SHARE_SESSIONS);
        
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const sessions = request.result || [];
                const now = Date.now();
                let deleted = 0;
                
                sessions.forEach(session => {
                    if (session.expiry < now || session.status === 'completed') {
                        store.delete(session.id);
                        deleted++;
                    }
                });
                resolve({ success: true, deleted });
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function addToSyncQueue(item) {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.SYNC_QUEUE], 'readwrite');
        const store = transaction.objectStore(STORES.SYNC_QUEUE);
        
        const syncItem = {
            user_id: user.id,
            type: item.type || 'file',
            data: item.data,
            status: 'pending',
            created_at: new Date().toISOString(),
            retry_count: 0,
            last_attempt: null
        };
        
        const request = store.add(syncItem);
        request.onsuccess = () => resolve({ success: true, id: request.result });
        request.onerror = () => reject(request.error);
    });
}

async function getPendingSyncItems() {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return [];
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.SYNC_QUEUE], 'readonly');
        const store = transaction.objectStore(STORES.SYNC_QUEUE);
        const index = store.index('user_id');
        const request = index.getAll(user.id);
        
        request.onsuccess = () => {
            const items = request.result || [];
            resolve(items.filter(item => item.status === 'pending'));
        };
        request.onerror = () => reject(request.error);
    });
}

async function markSyncComplete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.SYNC_QUEUE], 'readwrite');
        const store = transaction.objectStore(STORES.SYNC_QUEUE);
        const request = store.get(id);
        
        request.onsuccess = () => {
            const item = request.result;
            if (item) {
                item.status = 'completed';
                item.completed_at = new Date().toISOString();
                store.put(item);
                resolve({ success: true });
            } else {
                resolve({ success: false, message: 'Item not found' });
            }
        };
        request.onerror = () => reject(request.error);
    });
}

async function markSyncFailed(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.SYNC_QUEUE], 'readwrite');
        const store = transaction.objectStore(STORES.SYNC_QUEUE);
        const request = store.get(id);
        
        request.onsuccess = () => {
            const item = request.result;
            if (item) {
                item.retry_count = (item.retry_count || 0) + 1;
                item.last_attempt = new Date().toISOString();
                if (item.retry_count >= 5) item.status = 'failed';
                store.put(item);
                resolve({ success: true });
            } else {
                resolve({ success: false, message: 'Item not found' });
            }
        };
        request.onerror = () => reject(request.error);
    });
}

async function incrementFileStats(userId, type) {
    const db = await openDB();
    const today = new Date().toISOString().split('T')[0];
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.FILE_STATS, STORES.USERS], 'readwrite');
        const statsStore = transaction.objectStore(STORES.FILE_STATS);
        const statsIndex = statsStore.index('user_id');
        const statsRequest = statsIndex.getAll(userId);
        
        statsRequest.onsuccess = () => {
            const stats = statsRequest.result || [];
            let todayStats = stats.find(s => s.date === today && s.type === type);
            
            if (todayStats) {
                todayStats.count = (todayStats.count || 0) + 1;
                statsStore.put(todayStats);
            } else {
                statsStore.add({ user_id: userId, date: today, type, count: 1 });
            }
            
            const userStore = transaction.objectStore(STORES.USERS);
            const userRequest = userStore.get(userId);
            
            userRequest.onsuccess = () => {
                const user = userRequest.result;
                if (user) {
                    if (type === 'upload') user.total_uploads = (user.total_uploads || 0) + 1;
                    else if (type === 'backup') user.total_backups = (user.total_backups || 0) + 1;
                    userStore.put(user);
                }
                resolve({ success: true });
            };
            userRequest.onerror = () => reject(userRequest.error);
        };
        statsRequest.onerror = () => reject(statsRequest.error);
    });
}

async function getFileStats(userId) {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.FILE_STATS, STORES.USERS], 'readonly');
        const statsStore = transaction.objectStore(STORES.FILE_STATS);
        const statsIndex = statsStore.index('user_id');
        const statsRequest = statsIndex.getAll(userId);
        
        statsRequest.onsuccess = () => {
            const stats = statsRequest.result || [];
            const userStore = transaction.objectStore(STORES.USERS);
            const userRequest = userStore.get(userId);
            
            userRequest.onsuccess = () => {
                const user = userRequest.result;
                const today = new Date().toISOString().split('T')[0];
                resolve({
                    today: {
                        uploads: stats.filter(s => s.date === today && s.type === 'upload').reduce((sum, s) => sum + s.count, 0),
                        backups: stats.filter(s => s.date === today && s.type === 'backup').reduce((sum, s) => sum + s.count, 0)
                    },
                    total: {
                        uploads: user?.total_uploads || 0,
                        backups: user?.total_backups || 0
                    }
                });
            };
            userRequest.onerror = () => reject(userRequest.error);
        };
        statsRequest.onerror = () => reject(statsRequest.error);
    });
}

// ============================================
// CHAT — LOCAL STORE + BACKEND SYNC
// ============================================

async function _chatPut(row) {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction([STORES.CHAT], 'readwrite');
        tx.objectStore(STORES.CHAT).put(row);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
    });
}

async function _chatGet(id) {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction([STORES.CHAT], 'readonly');
        const req = tx.objectStore(STORES.CHAT).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    });
}

async function _chatUpdate(id, patch) {
    const existing = await _chatGet(id);
    if (!existing) return;
    await _chatPut({ ...existing, ...patch });
}

async function _chatDelete(id) {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction([STORES.CHAT], 'readwrite');
        tx.objectStore(STORES.CHAT).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
    });
}

function _chatDispatch() {
    window.dispatchEvent(new CustomEvent('chatUpdated', { detail: { at: Date.now() } }));
}

async function sendChatMessage(peerUsername, body) {
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Not logged in' };

    body = (body || '').trim();
    if (!body) return { success: false, message: 'Empty message' };
    if (body.length > 4000) return { success: false, message: 'Too long' };

    const tempId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    await _chatPut({
        id: tempId,
        peer: peerUsername,
        sender: user.username,
        receiver: peerUsername,
        body: body,
        sent_at: new Date().toISOString(),
        read: false,
        pending: true
    });
    _chatDispatch();

    try {
        const res = await apiFetch('chat_send', {
            method: 'POST',
            body: JSON.stringify({
                sender_username:   user.username,
                receiver_username: peerUsername,
                body:              body
            })
        });
        const data = await res.json();

        if (data.success) {
            await _chatDelete(tempId);
            await _chatPut({
                id: data.id,
                peer: peerUsername,
                sender: user.username,
                receiver: peerUsername,
                body: body,
                sent_at: data.sent_at,
                read: false,
                pending: false
            });
            _chatDispatch();
            return { success: true, id: data.id };
        }

        await _chatUpdate(tempId, { failed: true, pending: false });
        _chatDispatch();
        return { success: false, message: data.error || 'Send failed' };
    } catch (e) {
        console.warn('📴 Offline or network error — saving to outbox for later', e.message);

        // Mark it as pending (not failed) and keep it in the local DB
        await _chatUpdate(tempId, { failed: false, pending: true, offline: true });
        _chatDispatch();

        // ✅ Save to the outbox in localStorage
        try {
            let outbox = JSON.parse(localStorage.getItem('chat_outbox') || '[]');
            if (!outbox.some(m => m.tempId === tempId)) {
                outbox.push({
                    tempId: tempId,
                    peer: peerUsername,
                    sender: user.username,
                    body: body,
                    timestamp: Date.now()
                });
                localStorage.setItem('chat_outbox', JSON.stringify(outbox));
            }
        } catch (err) {}

        return { success: false, message: 'Offline - will send when online', queued: true };
    }
}

// ✅ Sends any messages that were queued while offline
async function flushChatOutbox() {
    if (!navigator.onLine) return { sent: 0 };
    
    let outbox = [];
    try {
        outbox = JSON.parse(localStorage.getItem('chat_outbox') || '[]');
    } catch (e) { return { sent: 0 }; }

    if (outbox.length === 0) return { sent: 0 };

    console.log(`📤 Flushing ${outbox.length} queued message(s)`);
    const remaining = [];
    let sent = 0;

    for (const msg of outbox) {
        // Check if it's still in the local DB (user might have deleted chat while offline)
        const local = await _chatGet(msg.tempId);
        if (!local) continue; 

        try {
            const res = await apiFetch('chat_send', {
                method: 'POST',
                body: JSON.stringify({
                    sender_username:   msg.sender,
                    receiver_username: msg.peer,
                    body:              msg.body
                })
            });
            const data = await res.json();

            if (data.success) {
                await _chatDelete(msg.tempId);
                await _chatPut({
                    id: data.id,
                    peer: msg.peer,
                    sender: msg.sender,
                    receiver: msg.peer,
                    body: msg.body,
                    sent_at: data.sent_at,
                    read: false,
                    pending: false
                });
                sent++;
            } else {
                await _chatUpdate(msg.tempId, { failed: true, pending: false, offline: false });
            }
        } catch (err) {
            // Still offline? Keep it in the outbox
            remaining.push(msg);
        }
    }

    localStorage.setItem('chat_outbox', JSON.stringify(remaining));
    _chatDispatch();
    return { sent };
}

async function loadChatThread(peerUsername, sinceId = 0) {
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Not logged in' };

    try {
        const res = await apiFetch(
            'chat_fetch&me=' + encodeURIComponent(user.username) +
            '&peer=' + encodeURIComponent(peerUsername) +
            '&since_id=' + sinceId
        );
        const data = await res.json();
        if (!data.success) return data;

        const db = await openDB();
        await new Promise((resolve) => {
            const tx = db.transaction([STORES.CHAT], 'readwrite');
            const store = tx.objectStore(STORES.CHAT);
            (data.messages || []).forEach(m => {
                store.put({
                    id: m.id,
                    peer: peerUsername,
                    sender: m.sender,
                    receiver: m.receiver,
                    body: m.body,
                    sent_at: m.sent_at,
                    read: !!m.read_at,
                    pending: false
                });
            });
            tx.oncomplete = resolve;
            tx.onerror = resolve;
        });

        _chatDispatch();
        return { success: true, messages: data.messages };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

async function getLocalChat(peerUsername) {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction([STORES.CHAT], 'readonly');
        const store = tx.objectStore(STORES.CHAT);
        const idx = store.index('peer');
        const req = idx.getAll(peerUsername);
        req.onsuccess = () => {
            const rows = (req.result || [])
                .sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));
            resolve(rows);
        };
        req.onerror = () => resolve([]);
    });
}

async function getChatThreads() {
    const user = getCurrentUser();
    if (!user) return [];
    try {
        const res = await apiFetch('chat_threads&me=' + encodeURIComponent(user.username));
        const data = await res.json();
        if (data.success) return data.threads || [];
    } catch (e) {}
    return [];
}

async function markChatRead(peerUsername) {
    const user = getCurrentUser();
    if (!user) return;

    try {
        await apiFetch('chat_mark_read', {
            method: 'POST',
            body: JSON.stringify({ me: user.username, peer: peerUsername })
        });
    } catch (e) {}

    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction([STORES.CHAT], 'readwrite');
        const store = tx.objectStore(STORES.CHAT);
        const idx = store.index('peer');
        const req = idx.getAll(peerUsername);
        req.onsuccess = () => {
            (req.result || []).forEach(r => {
                if (r.receiver === user.username && !r.read) {
                    r.read = true;
                    store.put(r);
                }
            });
        };
        tx.oncomplete = () => { _chatDispatch(); resolve(); };
        tx.onerror = resolve;
    });
}

async function clearChatThread(peerUsername) {
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Not logged in' };

    const db = await openDB();
    await new Promise((resolve) => {
        const tx = db.transaction([STORES.CHAT], 'readwrite');
        const store = tx.objectStore(STORES.CHAT);
        const idx = store.index('peer');
        const req = idx.getAll(peerUsername);
        req.onsuccess = () => {
            (req.result || []).forEach(r => store.delete(r.id));
        };
        tx.oncomplete = resolve;
        tx.onerror = resolve;
    });

    _chatDispatch();

    try {
        const res = await apiFetch('chat_clear', {
            method: 'POST',
            body: JSON.stringify({ me: user.username, peer: peerUsername })
        });
        const data = await res.json();

        if (!data.success) {
            return { success: false, message: data.error || 'Server refused to clear' };
        }

        return { success: true, deleted: data.deleted || 0 };
    } catch (e) {
        return { success: false, message: e.message, localOnly: true };
    }
}

async function deleteChatConversation(peerUsername) {
    return await clearChatThread(peerUsername);
}

async function getTotalUnreadCount() {
    const user = getCurrentUser();
    if (!user) return 0;
    try {
        const res = await apiFetch('chat_threads&me=' + encodeURIComponent(user.username));
        const data = await res.json();
        if (!data.success) return 0;
        return (data.threads || []).reduce(
            (sum, t) => sum + Number(t.unread_count || 0),
            0
        );
    } catch (e) {
        return 0;
    }
}

// ============================================
// HELPERS
// ============================================

function getFileType(filename) {
    if (!filename) return 'other';
    const ext = filename.split('.').pop().toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'heif', 'svg', 'ico'];
    const videoExts = ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v', 'avi', 'mkv', 'wmv', 'flv', '3gp'];
    const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'log', 'md', 'odt', 'ods', 'odp'];
    
    if (imageExts.includes(ext)) return 'picture';
    if (videoExts.includes(ext)) return 'video';
    if (docExts.includes(ext)) return 'document';
    return 'other';
}

function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
}

function formatSizeMB(bytes) {
    if (!bytes || bytes === 0) return '0 MB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function getFileIcon(file) {
    if (!file) return '📄';
    if (file.is_link_share) return '🔗';
    const type = file.file_type || getFileType(file.original_name);
    const icons = { picture: '🖼️', video: '🎬', document: '📄', other: '📁' };
    return icons[type] || icons.other;
}

async function userExists(username) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.USERS], 'readonly');
        const store = transaction.objectStore(STORES.USERS);
        const index = store.index('username');
        const request = index.get(username);
        request.onsuccess = () => resolve(!!request.result);
        request.onerror = () => reject(request.error);
    });
}

async function debugDatabase() {
    const db = await openDB();
    const user = getCurrentUser();
    
    console.log('=== DATABASE DEBUG ===');
    console.log('Current user:', user);
    console.log('Backend:', BACKEND_URL);
    
    try {
        const users = await new Promise((resolve) => {
            const tx = db.transaction([STORES.USERS], 'readonly');
            const store = tx.objectStore(STORES.USERS);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
        });
        console.log('Users in DB:', users);
    } catch (e) {}
    
    console.log('=== END DEBUG ===');
}

// ============================================
// CONTINUOUS SYNC ENGINE — burst + SSE
// ============================================

let syncLoopRunning = false;
let syncPaused = false;
let syncAbortController = null;
let consecutiveFailures = 0;

const SYNC_INTERVAL    = 10000;
const IDLE_POLL_DELAY  = 20000;
const MAX_POLL_DELAY   = 30000;
const BURST_INTERVAL   = 2000;
const BURST_DURATION   = 30000;

let currentPollDelay = SYNC_INTERVAL;
let burstUntil = 0;

let syncWakeResolve = null;
function wakeSyncLoop() {
    burstUntil = Date.now() + BURST_DURATION;
    if (syncWakeResolve) {
        const r = syncWakeResolve;
        syncWakeResolve = null;
        r();
    }
}
window.wakeSyncLoop = wakeSyncLoop;

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function sleepWithWake(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            syncWakeResolve = null;
            resolve();
        }, ms);
        syncWakeResolve = () => {
            clearTimeout(timer);
            resolve();
        };
    });
}

function computeDelay() {
    const hidden = document.visibilityState !== 'visible';
    if (hidden) return IDLE_POLL_DELAY;
    if (Date.now() < burstUntil) return BURST_INTERVAL;
    return currentPollDelay;
}

// ============================================
// SSE — REAL-TIME SERVER PUSH
// ============================================

let sseConnection = null;
let sseRetryTimer = null;
let sseUserId = null;
let sseFailures = 0;

const SSE_URL = BACKEND_URL.replace('index.php?route=', '') + 'sse.php';

function startServerPush(userId) {
    if (sseConnection || !userId) return;
    if (typeof EventSource === 'undefined') {
        console.warn('📡 SSE: EventSource not available in this browser');
        return;
    }

    sseUserId = userId;

    try {
        sseConnection = new EventSource(SSE_URL + '?user_id=' + encodeURIComponent(userId));

        sseConnection.addEventListener('open', () => {
            sseFailures = 0;
            console.log('📡 SSE connected for user', userId);
        });

        sseConnection.addEventListener('changed', (e) => {
            console.log('📡 SSE: server changed — syncing now', e.data || '');
            wakeSyncLoop();
            if (typeof window.__openChatPeer === 'string' && window.__openChatPeer) {
                loadChatThread(window.__openChatPeer).catch(() => {});
            }
        });

        sseConnection.addEventListener('ping', () => { /* keepalive */ });

        sseConnection.addEventListener('close', () => {
            console.log('📡 SSE: server closed stream — reconnecting');
            stopServerPush();
            scheduleSSEReconnect();
        });

        sseConnection.onerror = () => {
            sseFailures++;
            if (sseConnection && sseConnection.readyState === EventSource.CLOSED) {
                stopServerPush();
                scheduleSSEReconnect();
            }
        };
    } catch (e) {
        console.warn('📡 SSE failed to start:', e.message);
        scheduleSSEReconnect();
    }
}

function stopServerPush() {
    if (sseConnection) {
        try { sseConnection.close(); } catch (e) {}
        sseConnection = null;
    }
    if (sseRetryTimer) {
        clearTimeout(sseRetryTimer);
        sseRetryTimer = null;
    }
}

function scheduleSSEReconnect() {
    if (syncPaused || !sseUserId) return;
    if (sseRetryTimer) return;

    const delay = Math.min(30000, 2000 * Math.pow(2, Math.min(sseFailures, 4)));

    sseRetryTimer = setTimeout(() => {
        sseRetryTimer = null;
        if (!syncPaused && sseUserId) startServerPush(sseUserId);
    }, delay);
}

window.startServerPush = startServerPush;
window.stopServerPush = stopServerPush;

// ============================================
// PAUSE / RESUME / START / STOP
// ============================================

function pauseSync() {
    syncPaused = true;
    syncLoopRunning = false;
    burstUntil = 0;
    if (syncAbortController) {
        try { syncAbortController.abort(); } catch (e) {}
        syncAbortController = null;
    }
    stopServerPush();
    wakeSyncLoop();
    console.log('⏸ Continuous sync paused');
}

function resumeSync() {
    syncPaused = false;
    console.log('▶️ Continuous sync resumed');
    (async () => {
        try { await flushLoginHistory(); } catch (e) {}
        try { await fullSync(); } catch (e) {}
        try { await validatePendingShares(); } catch (e) {}
        // ✅ Flush chat outbox on resume
        try { await flushChatOutbox(); } catch (e) {}
    })();
    startContinuousSync();

    const user = getCurrentUser();
    if (user) startServerPush(user.id);
}

function startBackgroundSync() {
    startContinuousSync();
}

function stopBackgroundSync() {
    syncPaused = true;
    syncLoopRunning = false;
    burstUntil = 0;
    if (syncAbortController) {
        try { syncAbortController.abort(); } catch (e) {}
        syncAbortController = null;
    }
    stopServerPush();
    sseUserId = null;
    wakeSyncLoop();
    console.log('🛑 Continuous sync stopped');
}

function startContinuousSync() {
    if (syncLoopRunning) return;
    syncLoopRunning = true;
    syncPaused = false;
    runSyncLoop();
}

async function runSyncLoop() {
    console.log('🔄 Continuous sync engine started (10s idle / 2s burst / SSE)');

    while (syncLoopRunning && !syncPaused) {
        const user = getCurrentUser();
        if (!user) {
            await sleepWithWake(5000);
            continue;
        }

        try {
            const online = await isServerOnline();
            if (!online) {
                consecutiveFailures++;
                currentPollDelay = Math.min(
                    MAX_POLL_DELAY,
                    SYNC_INTERVAL * Math.pow(2, Math.min(consecutiveFailures, 2))
                );
                await sleepWithWake(currentPollDelay);
                continue;
            }

            consecutiveFailures = 0;
            currentPollDelay = SYNC_INTERVAL;

            syncAbortController = new AbortController();

            // ✅ Flush chat outbox first (fast + important)
            try { await flushChatOutbox(); } catch (e) {}

            try { await flushLoginHistory(); } catch (e) {}
            try { await processPendingDeletes(); } catch (e) {}
            try { await validatePendingShares(); } catch (e) {}

            await Promise.allSettled([
                syncFilesFromBackend(user.id).then(result => {
                    if (result?.newFiles > 0) {
                        window.dispatchEvent(new CustomEvent('filesSynced', {
                            detail: { downloaded: result.newFiles, at: Date.now() }
                        }));
                    }
                }),
                syncLocalFilesToServer()
            ]);

            try { await syncPendingUsers(); } catch (e) {}
            try { await ensureUserOnServer(); } catch (e) {}

            syncAbortController = null;

            if (!sseConnection) startServerPush(user.id);

            await sleepWithWake(computeDelay());

        } catch (err) {
            if (err && err.name === 'AbortError') break;
            console.error('❌ Sync loop error:', err);
            consecutiveFailures++;
            currentPollDelay = Math.min(
                MAX_POLL_DELAY,
                SYNC_INTERVAL * Math.pow(2, Math.min(consecutiveFailures, 2))
            );
            await sleepWithWake(currentPollDelay);
        }
    }

    syncLoopRunning = false;
    console.log('⏹ Continuous sync loop exited');
}

async function initializeSync() {
    const user = getCurrentUser();
    if (!user) return;

    try {
        const all = await getFiles();
        for (const f of all) {
            if (f.sync_status === 'syncing') {
                console.log(`🔄 Unsticking file ${f.id} (${f.original_name}) from 'syncing'`);
                await updateFileSyncStatus(f.id, 'local');
            }
        }
    } catch (e) {
        console.warn('Unstick pass failed:', e.message);
    }

    try { await flushChatOutbox(); } catch (e) {}
    try { await flushLoginHistory(); } catch (e) {}
    try { await fullSync(); } catch (e) {}
    try { await validatePendingShares(); } catch (e) {}

    startContinuousSync();
    startServerPush(user.id);

    enableNativeBackgroundSync();
}

// ============================================
// LIFECYCLE WIRING
// ============================================

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        wakeSyncLoop();
        const user = getCurrentUser();
        if (user && !sseConnection && !syncPaused) startServerPush(user.id);
        // ✅ Flush outbox when tab becomes visible
        flushChatOutbox().catch(() => {});
    }
});

window.onAppResume = () => {
    console.log('📱 Native onAppResume fired');
    resumeSync();
};
window.onAppPause = () => {
    console.log('📱 onAppPause fired — sync continues at reduced rate');
    stopServerPush();
};

window.addEventListener('online', () => {
    console.log('🌐 online — resetting backoff + waking loop');
    consecutiveFailures = 0;
    currentPollDelay = SYNC_INTERVAL;

    // ✅ Send any messages queued while offline
    flushChatOutbox().catch(() => {});

    const user = getCurrentUser();
    if (user && !sseConnection && !syncPaused) startServerPush(user.id);
    if (!syncPaused) wakeSyncLoop();
});

window.addEventListener('offline', () => {
    console.log('📴 offline — sync loop will back off');
    stopServerPush();
});

// ============================================
// PENDING SHARES STATUS
// ============================================

async function getPendingSharesStatus() {
    const db = await openDB();
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'Please login first' };
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.PENDING_SHARES], 'readonly');
        const store = transaction.objectStore(STORES.PENDING_SHARES);
        const index = store.index('sender_id');
        const request = index.getAll(user.id);
        
        request.onsuccess = () => {
            const pending = request.result || [];
            resolve({
                success: true,
                total: pending.length,
                validated: pending.filter(p => p.validated).length,
                failed: pending.filter(p => p.validation_failed).length,
                pending: pending.filter(p => !p.validated && !p.validation_failed).length,
                items: pending
            });
        };
        request.onerror = () => reject(request.error);
    });
}

async function manualValidatePendingShares() {
    return await validatePendingShares();
}

// ============================================
// TOAST
// ============================================

function showToast(msg, type = 'info') {
    if (typeof toast === 'function') {
        toast(msg, type);
        return;
    }
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toastEl = document.createElement('div');
    toastEl.className = 'toast ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'warning');
    toastEl.textContent = msg;
    document.body.appendChild(toastEl);
    setTimeout(() => {
        toastEl.style.opacity = '0';
        toastEl.style.transition = 'opacity 0.3s';
        setTimeout(() => toastEl.remove(), 300);
    }, 3000);
}

// ============================================
// EXPOSE FUNCTIONS
// ============================================

window.isServerOnline = isServerOnline;
window.fullSync = fullSync;
window.syncUserToBackend = syncUserToBackend;
window.syncFileToBackend = syncFileToBackend;
window.syncFilesFromBackend = syncFilesFromBackend;
window.syncLocalFilesToServer = syncLocalFilesToServer;
window.syncPendingUsers = syncPendingUsers;
window.syncFileInBackground = syncFileInBackground;
window.updateFileSyncStatus = updateFileSyncStatus;
window.ensureUserOnServer = ensureUserOnServer;

window.deleteFileFromServer = deleteFileFromServer;
window.removeShareFromServer = removeShareFromServer;
window.queueServerDelete = queueServerDelete;
window.processPendingDeletes = processPendingDeletes;

window.startBackgroundSync = startBackgroundSync;
window.startContinuousSync = startContinuousSync;
window.stopBackgroundSync = stopBackgroundSync;
window.initializeSync = initializeSync;
window.pauseSync = pauseSync;
window.resumeSync = resumeSync;
window.wakeSyncLoop = wakeSyncLoop;
window.startServerPush = startServerPush;
window.stopServerPush = stopServerPush;

window.enableNativeBackgroundSync = enableNativeBackgroundSync;
window.disableNativeBackgroundSync = disableNativeBackgroundSync;

window.createShareLink = createShareLink;
window.LARGE_FILE_THRESHOLD = LARGE_FILE_THRESHOLD;
window.SHARE_LINK_TTL_HOURS = SHARE_LINK_TTL_HOURS;

window.registerUser = registerUser;
window.loginUser = loginUser;
window.getCurrentUser = getCurrentUser;
window.logoutUser = logoutUser;
window.getUserById = getUserById;
window.userExists = userExists;
window.updateLocalUser = updateLocalUser;
window.syncLoginToServer = syncLoginToServer;
window.getNextLocalUserId = getNextLocalUserId;

window.getSecurityQuestion = getSecurityQuestion;
window.verifySecurityAnswer = verifySecurityAnswer;
window.resetPasswordWithSecurity = resetPasswordWithSecurity;
window.getSecurityQuestionsList = getSecurityQuestionsList;

window.saveFile = saveFile;
window.getFiles = getFiles;
window.getFile = getFile;
window.deleteFile = deleteFile;
window.getStorageUsed = getStorageUsed;
window.getStorageInfo = getStorageInfo;

window.backupFileOffline = backupFileOffline;
window.getOfflineBackups = getOfflineBackups;

window.shareFile = shareFile;
window.getSharedFiles = getSharedFiles;
window.getSharedByMe = getSharedByMe;
window.acceptSharedFile = acceptSharedFile;

window.checkUserOnServer = checkUserOnServer;
window.getUserByUsername = getUserByUsername;
window.saveUserToLocal = saveUserToLocal;
window.validatePendingShare = validatePendingShare;
window.validatePendingShares = validatePendingShares;
window.getPendingSharesStatus = getPendingSharesStatus;
window.manualValidatePendingShares = manualValidatePendingShares;

window.createShareSession = createShareSession;
window.getShareSession = getShareSession;
window.updateShareSession = updateShareSession;
window.deleteShareSession = deleteShareSession;
window.getActiveShareSessions = getActiveShareSessions;
window.cleanupExpiredShareSessions = cleanupExpiredShareSessions;

window.addToSyncQueue = addToSyncQueue;
window.getPendingSyncItems = getPendingSyncItems;
window.markSyncComplete = markSyncComplete;
window.markSyncFailed = markSyncFailed;

window.incrementFileStats = incrementFileStats;
window.getFileStats = getFileStats;

window.debugDatabase = debugDatabase;
window.logLoginAttempt = logLoginAttempt;
window.flushLoginHistory = flushLoginHistory;

window.formatSize = formatSize;
window.formatSizeMB = formatSizeMB;
window.getFileIcon = getFileIcon;
window.getFileType = getFileType;
window.getDisplayStatus = getDisplayStatus;
window.validatePassword = validatePassword;
window.openDB = openDB;
window.showToast = showToast;
window.apiFetch = apiFetch;
window.BACKEND_URL = BACKEND_URL;
window.downloadServerFileAsBlob = downloadServerFileAsBlob;
window.downloadFileByChunks = downloadFileByChunks;
window.base64ToBlobFast = base64ToBlobFast;
window.downloadFileToDevice = downloadFileToDevice;

// ✅ Chat
window.sendChatMessage           = sendChatMessage;
window.loadChatThread            = loadChatThread;
window.getLocalChat              = getLocalChat;
window.getChatThreads            = getChatThreads;
window.markChatRead              = markChatRead;
window.clearChatThread           = clearChatThread;
window.deleteChatConversation    = deleteChatConversation;
window.getTotalUnreadCount       = getTotalUnreadCount;
window.flushChatOutbox           = flushChatOutbox;

console.log('📦 SafeBox IndexedDB loaded successfully!');
console.log('🔗 Backend:', BACKEND_URL.split('/')[2]);
console.log('✅ Local user IDs start at 2 (ID 1 reserved for admin)');
console.log('✅ Max file size: 800MB');
console.log('✅ Chunked upload for files > 10MB (parallel ×' + CHUNK_UPLOAD_CONCURRENCY + ')');
console.log('✅ Files synced from server are saved locally for offline');
console.log('✅ Offline-first: local files show immediately');
console.log('🔄 Continuous sync: 10s idle / 2s burst (30s) / 20s hidden / 30s backoff cap');
console.log('⚡ Instant sync on local writes via wakeSyncLoop()');
console.log('📡 SSE: real-time server push (<500ms reaction), auto-reconnect');
console.log('🛡 Falls back to 10s polling if SSE is unavailable');
console.log('📱 Native background sync: WorkManager every ' + NATIVE_SYNC_INTERVAL_MINUTES + ' min');
console.log('🔗 Large files (> ' + (LARGE_FILE_THRESHOLD / 1024 / 1024) + ' MB) — shared as LINK (expires in ' + SHARE_LINK_TTL_HOURS + 'h)');
console.log('✅ Dual-write: saves locally + syncs to server');
console.log('✅ Server-aware delete: own files → delete_file, shared → remove_share');
console.log('✅ Queued server deletes when offline (retries in fullSync)');
console.log('⬆️ Local files pushed to server on every sync');
console.log('🔗 Shares resolve server-side file_id before sending');
console.log('📥 Admin-uploaded files download to user on next sync');
console.log('🔐 Security answers hashed client-side (btoa), never sent as plaintext');
console.log('📝 Login history logged locally + pushed to /log_login with offline queue');
console.log('🚀 Parallel uploads: ' + CHUNK_UPLOAD_CONCURRENCY + ' chunks at a time (16MB chunks)');
console.log('🚀 Parallel downloads: ' + DOWNLOAD_CONCURRENCY + ' files at a time');
console.log('🚀 Chunked downloads: ' + CHUNK_DOWNLOAD_CONCURRENCY + ' chunks in parallel');
console.log('🚀 Fast base64 → Blob via data-URL decoder');
console.log('📥 downloadFileToDevice() → Android DownloadManager (background)');
console.log('⏸ Lifecycle: pauseSync/resumeSync wired (WebView bridge ready)');
console.log('📡 Every fullSync dispatches window "filesSynced" event');
console.log('📡 Local save/delete dispatches window "filesSynced" event');
console.log('💬 Chat: 1-to-1 messaging over SSE, chat_messages store ready');
console.log('🧹 Chat: clear/delete conversation supported');
console.log('🔔 Chat: getTotalUnreadCount() exposed for sidebar badge');
console.log('✓✓ Chat: tick status (sent / delivered / read) wired through read flag');
console.log('📥 Auto-download: new link shares fire Android DownloadManager instantly');
console.log('🌐 Single backend: allapp.nport.link');