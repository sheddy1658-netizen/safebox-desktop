// ============================================
// QR CODE SCANNER - READS ANY QR CODE
// Uses jsQR library for real QR detection
// COMPLETE FIX FOR ANDROID WEBVIEW
// ============================================

// ============================================
// TOAST FUNCTION - Use global if available
// ============================================
function qrToast(message, type = 'info') {
    if (typeof window.toast === 'function') {
        window.toast(message, type);
        return;
    }
    // Fallback
    const existing = document.querySelector('.qr-toast');
    if (existing) existing.remove();
    const toastEl = document.createElement('div');
    toastEl.className = 'qr-toast';
    toastEl.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 24px;
        border-radius: 10px;
        color: white;
        font-size: 14px;
        font-weight: 500;
        z-index: 9999;
        background: rgba(0,0,0,0.85);
        backdrop-filter: blur(10px);
        border-left: 4px solid ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#667eea'};
        max-width: 90%;
        text-align: center;
        pointer-events: none;
        animation: slideUp 0.4s ease;
    `;
    toastEl.textContent = message;
    document.body.appendChild(toastEl);
    setTimeout(() => {
        toastEl.style.opacity = '0';
        toastEl.style.transition = 'opacity 0.3s';
        setTimeout(() => toastEl.remove(), 300);
    }, 3000);
}

// ============================================
// Load jsQR library dynamically
// ============================================
function loadJsQR() {
    return new Promise((resolve, reject) => {
        if (typeof jsQR !== 'undefined') {
            resolve(jsQR);
            return;
        }
        
        const cdnSources = [
            'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
            'https://cdnjs.cloudflare.com/ajax/libs/jsqr/1.4.0/jsQR.js',
            'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js'
        ];
        
        let attemptIndex = 0;
        
        function tryLoad() {
            if (attemptIndex >= cdnSources.length) {
                reject(new Error('Failed to load jsQR from all CDN sources'));
                return;
            }
            const script = document.createElement('script');
            script.src = cdnSources[attemptIndex];
            script.onload = () => resolve(window.jsQR);
            script.onerror = () => {
                attemptIndex++;
                tryLoad();
            };
            document.head.appendChild(script);
        }
        tryLoad();
    });
}

// ============================================
// QR SCANNER CLASS - FIXED
// ============================================
class QRScanner {
    constructor() {
        this.video = null;
        this.canvas = null;
        this.ctx = null;
        this.stream = null;
        this.isScanning = false;
        this.scanInterval = null;
        this.onResultCallback = null;
        this.onErrorCallback = null;
        this.jsQR = null;
        this.isInitialized = false;
        this._hasResult = false;
        this._scanFrameCount = 0;
        this._frameSkip = 2;
        this._useFallback = false;
    }

    async init() {
        if (this.isInitialized) return;
        try {
            this.jsQR = await loadJsQR();
            this.isInitialized = true;
            this._useFallback = false;
            console.log('✅ QR Scanner initialized with jsQR');
        } catch (error) {
            console.error('Failed to load jsQR:', error);
            this.isInitialized = true;
            this._useFallback = true;
            console.warn('⚠️ Using fallback mode - only works as demo');
        }
    }

    async checkCameraPermission() {
        try {
            if (navigator.permissions && navigator.permissions.query) {
                const result = await navigator.permissions.query({ name: 'camera' });
                return result.state === 'granted' || result.state === 'prompt';
            }
            return true;
        } catch (error) {
            console.warn('Permission check error:', error);
            return true;
        }
    }

    async startScanning() {
        if (this.isScanning) {
            console.log('Scanner already running');
            return;
        }

        await this.init();

        const hasPermission = await this.checkCameraPermission();
        if (!hasPermission) {
            qrToast('❌ Camera permission denied. Please grant permission in settings.', 'error');
            return;
        }

        try {
            this.video = document.getElementById('qrVideo');
            this.canvas = document.getElementById('qrCanvas');
            
            if (!this.video || !this.canvas) {
                throw new Error('Video or canvas element not found');
            }

            this._hasResult = false;

            const constraints = {
                video: {
                    facingMode: 'environment',
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                },
                audio: false
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            this.video.srcObject = this.stream;
            this.video.setAttribute('playsinline', true);
            this.video.setAttribute('autoplay', true);
            
            await new Promise((resolve) => {
                if (this.video.readyState >= 2) {
                    resolve();
                } else {
                    this.video.addEventListener('loadeddata', resolve, { once: true });
                    setTimeout(resolve, 5000);
                }
            });
            
            await this.video.play();

            this.canvas.width = this.video.videoWidth || 640;
            this.canvas.height = this.video.videoHeight || 480;
            this.ctx = this.canvas.getContext('2d');

            this.video.style.display = 'block';
            const overlay = document.getElementById('scannerOverlay');
            if (overlay) overlay.style.display = 'none';
            
            const indicator = document.getElementById('scanningIndicator');
            if (indicator) indicator.style.display = 'block';
            
            const startBtn = document.getElementById('startScanBtn');
            const stopBtn = document.getElementById('stopScanBtn');
            if (startBtn) startBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'inline-block';

            this.isScanning = true;
            const status = document.getElementById('scanStatus');
            if (status) status.textContent = '📷 Scanning for QR codes...';

            this.scanLoop();

            setTimeout(() => {
                if (this.isScanning && !this._hasResult) {
                    this.stopScanning();
                    const statusEl = document.getElementById('scanStatus');
                    if (statusEl) statusEl.textContent = '⏱️ Scan timeout - try again';
                }
            }, 30000);

            console.log('📷 QR Scanner started');

        } catch (error) {
            console.error('Camera error:', error);
            const status = document.getElementById('scanStatus');
            if (status) {
                status.textContent = '❌ Camera access denied: ' + error.message;
            }
            this.showFallbackUI();
        }
    }

    scanLoop() {
        if (!this.isScanning) return;

        try {
            this._scanFrameCount++;
            if (this._scanFrameCount % this._frameSkip !== 0) {
                if (this.isScanning) {
                    this.scanInterval = requestAnimationFrame(() => this.scanLoop());
                }
                return;
            }

            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            this.detectQR(imageData);
            
        } catch (error) {
            console.error('Scan error:', error);
        }

        if (this.isScanning) {
            this.scanInterval = requestAnimationFrame(() => this.scanLoop());
        }
    }

    detectQR(imageData) {
        try {
            let code = null;
            
            // REAL QR DETECTION - ONLY USE jsQR
            if (this.jsQR && !this._useFallback) {
                try {
                    code = this.jsQR(imageData.data, imageData.width, imageData.height, {
                        inversionAttempts: "dontInvert",
                    });
                } catch (e) {
                    console.debug('jsQR error:', e);
                }
            }
            
            // FALLBACK - ONLY if jsQR is not available
            if (!code && this._useFallback) {
                // Return null instead of fake data - let user know
                qrToast('⚠️ QR detection library not loaded. Please check internet connection.', 'warning');
                return;
            }

            if (code && code.data) {
                this._hasResult = true;
                this.onQRDetected({
                    data: code.data,
                    type: this.detectQRType(code.data),
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('QR detection error:', error);
        }
    }

    detectQRType(data) {
        if (!data) return 'text';
        if (data.startsWith('http://') || data.startsWith('https://')) return 'url';
        if (data.startsWith('WiFi:')) return 'wifi';
        if (data.startsWith('mailto:')) return 'email';
        if (data.startsWith('tel:')) return 'phone';
        if (data.includes('VCARD') || data.includes('BEGIN:VCARD')) return 'contact';
        if (data.startsWith('SafeBox://')) return 'safebox';
        if (data.startsWith('geo:')) return 'location';
        return 'text';
    }

    onQRDetected(result) {
        this.isScanning = false;
        this._hasResult = true;
        
        if (this.scanInterval) {
            cancelAnimationFrame(this.scanInterval);
            this.scanInterval = null;
        }

        const resultDiv = document.getElementById('scanResult');
        const resultText = document.getElementById('resultText');
        const resultType = document.getElementById('resultType');
        const resultActions = document.getElementById('resultActions');

        if (resultDiv && resultText) {
            resultDiv.style.display = 'block';
            resultText.textContent = result.data;
            
            if (resultType) {
                const typeLabels = {
                    url: '🔗 URL',
                    wifi: '📶 WiFi',
                    email: '📧 Email',
                    phone: '📞 Phone',
                    contact: '👤 Contact',
                    safebox: '📦 SafeBox Share',
                    location: '📍 Location',
                    text: '📝 Text'
                };
                resultType.textContent = typeLabels[result.type] || '📝 Text';
            }

            if (resultActions) {
                resultActions.innerHTML = this.getResultActions(result);
            }
        }

        this.stopScanning();
        const status = document.getElementById('scanStatus');
        if (status) status.textContent = '✅ QR Code scanned!';
        
        const startBtn = document.getElementById('startScanBtn');
        const stopBtn = document.getElementById('stopScanBtn');
        if (startBtn) startBtn.style.display = 'inline-block';
        if (stopBtn) stopBtn.style.display = 'none';
        
        if (navigator.vibrate) navigator.vibrate(200);
        this.playSuccessSound();

        if (this.onResultCallback) {
            this.onResultCallback(result);
        }
    }

    getResultActions(result) {
        const data = result.data;
        const type = result.type;
        let actions = '';
        const escapedData = data.replace(/"/g, '&quot;');

        switch(type) {
            case 'url':
                actions = `
                    <button onclick="window.open('${escapedData}', '_blank')" class="btn btn-primary">🌐 Open</button>
                    <button onclick="copyText('${escapedData}')" class="btn btn-secondary">📋 Copy</button>
                `;
                break;
            case 'wifi':
                const ssid = data.match(/S:([^;]+)/)?.[1] || 'Unknown';
                const pass = data.match(/P:([^;]+)/)?.[1] || '';
                actions = `
                    <button onclick="connectWiFi('${escapedData}')" class="btn btn-primary">📶 Connect</button>
                    <button onclick="copyText('${escapedData}')" class="btn btn-secondary">📋 Copy</button>
                `;
                break;
            case 'email':
                actions = `
                    <button onclick="window.location.href='${escapedData}'" class="btn btn-primary">📧 Send</button>
                    <button onclick="copyText('${escapedData}')" class="btn btn-secondary">📋 Copy</button>
                `;
                break;
            case 'phone':
                actions = `
                    <button onclick="window.location.href='${escapedData}'" class="btn btn-primary">📞 Call</button>
                    <button onclick="copyText('${escapedData}')" class="btn btn-secondary">📋 Copy</button>
                `;
                break;
            case 'safebox':
                actions = `
                    <button onclick="handleSafeBoxShare('${escapedData}')" class="btn btn-primary">📦 Open in SafeBox</button>
                `;
                break;
            default:
                actions = `
                    <button onclick="copyText('${escapedData}')" class="btn btn-primary">📋 Copy</button>
                    <button onclick="saveQRResult('${escapedData}')" class="btn btn-success">💾 Save</button>
                `;
        }

        actions += `<button onclick="closeResult()" class="btn btn-danger">✕ Close</button>`;
        return actions;
    }

    playSuccessSound() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.frequency.value = 880;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.3;
            oscillator.start();
            setTimeout(() => oscillator.stop(), 150);
        } catch (error) {
            // Silent fail
        }
    }

    stopScanning() {
        this.isScanning = false;
        this._hasResult = false;
        this._scanFrameCount = 0;
        
        if (this.scanInterval) {
            cancelAnimationFrame(this.scanInterval);
            this.scanInterval = null;
        }
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => {
                try { track.stop(); } catch (e) {}
            });
            this.stream = null;
        }
        
        if (this.video) {
            this.video.style.display = 'none';
            try { this.video.srcObject = null; } catch (e) {}
            this.video.pause();
        }

        const indicator = document.getElementById('scanningIndicator');
        if (indicator) indicator.style.display = 'none';
        
        const overlay = document.getElementById('scannerOverlay');
        if (overlay) overlay.style.display = 'flex';
        
        const startBtn = document.getElementById('startScanBtn');
        const stopBtn = document.getElementById('stopScanBtn');
        if (startBtn) startBtn.style.display = 'inline-block';
        if (stopBtn) stopBtn.style.display = 'none';
        
        console.log('📷 QR Scanner stopped');
    }

    showFallbackUI() {
        const overlay = document.getElementById('scannerOverlay');
        if (overlay) {
            overlay.innerHTML = `
                <span style="font-size:48px;">📷</span>
                <p>Camera not available</p>
                <p style="font-size:12px;color:#6a7a8e;">Upload an image containing a QR code</p>
            `;
            overlay.style.display = 'flex';
        }
    }

    onResult(callback) {
        this.onResultCallback = callback;
        return this;
    }

    onError(callback) {
        this.onErrorCallback = callback;
        return this;
    }
}

// ============================================
// QR CODE GENERATOR - FIXED
// ============================================

class QRGenerator {
    constructor() {
        this.apiUrl = 'https://api.qrserver.com/v1/create-qr-code/';
    }

    generate(text, options = {}) {
        const size = options.size || 200;
        const color = options.color || '6C63FF';
        const bgColor = options.bgColor || 'FFFFFF';
        const margin = options.margin || 10;
        const url = `${this.apiUrl}?size=${size}x${size}&data=${encodeURIComponent(text)}&color=${color}&bgcolor=${bgColor}&margin=${margin}`;
        return url;
    }

    // ============================================
    // DOWNLOAD QR - FIXED FOR ANDROID
    // ============================================
    download(qrUrl, fileName = 'qrcode.png') {
        // Try Android bridge first
        if (typeof window.Android !== 'undefined' && window.Android.saveFileToDevice) {
            try {
                fetch(qrUrl)
                    .then(response => response.blob())
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onload = function() {
                            const base64 = reader.result.split(',')[1];
                            const result = window.Android.saveFileToDevice(fileName, base64, 'image/png');
                            if (result === true) {
                                qrToast('✅ QR Code saved to Downloads/SafeBox', 'success');
                            } else {
                                browserDownloadQR(qrUrl, fileName);
                            }
                        };
                        reader.onerror = function() {
                            browserDownloadQR(qrUrl, fileName);
                        };
                        reader.readAsDataURL(blob);
                    })
                    .catch(() => browserDownloadQR(qrUrl, fileName));
                return;
            } catch (e) {
                console.warn('Android download error:', e);
                browserDownloadQR(qrUrl, fileName);
                return;
            }
        }
        browserDownloadQR(qrUrl, fileName);
    }
}

// ============================================
// BROWSER QR DOWNLOAD - FIXED
// ============================================
function browserDownloadQR(qrUrl, fileName) {
    try {
        fetch(qrUrl)
            .then(response => response.blob())
            .then(blob => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = fileName || 'qrcode.png';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(url), 5000);
                qrToast('✅ QR Code downloaded!', 'success');
            })
            .catch(() => {
                // Last resort
                window.open(qrUrl, '_blank');
                qrToast('📥 QR opened in new tab. Long press to save.', 'info');
            });
    } catch (error) {
        window.open(qrUrl, '_blank');
        qrToast('📥 QR opened in new tab. Long press to save.', 'info');
    }
}

// ============================================
// UI FUNCTIONS
// ============================================

let scanner = null;
let generator = null;

async function initQRScanner() {
    if (!scanner) {
        scanner = new QRScanner();
        generator = new QRGenerator();
        scanner.onResult((result) => {
            console.log('QR Result:', result);
        });
    }
    await scanner.init();
    console.log('📷 QR Scanner initialized');
}

async function startScan() {
    if (!scanner) {
        await initQRScanner();
    }
    await scanner.startScanning();
}

function stopScan() {
    if (scanner) {
        scanner.stopScanning();
    }
    const status = document.getElementById('scanStatus');
    if (status) status.textContent = '⏹️ Scanner stopped';
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn = document.getElementById('stopScanBtn');
    if (startBtn) startBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'none';
}

function uploadQRImage(input) {
    if (!input || !input.files || !input.files.length) {
        qrToast('Please select an image', 'warning');
        return;
    }
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const img = new Image();
            img.onload = async function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let code = null;
                if (window.jsQR) {
                    code = window.jsQR(imageData.data, imageData.width, imageData.height, {
                        inversionAttempts: "dontInvert",
                    });
                }
                if (code && code.data) {
                    const resultDiv = document.getElementById('scanResult');
                    const resultText = document.getElementById('resultText');
                    const resultType = document.getElementById('resultType');
                    const resultActions = document.getElementById('resultActions');
                    if (resultDiv && resultText) {
                        resultDiv.style.display = 'block';
                        resultText.textContent = code.data;
                        const type = scanner ? scanner.detectQRType(code.data) : 'text';
                        const typeLabels = {
                            url: '🔗 URL', wifi: '📶 WiFi', email: '📧 Email',
                            phone: '📞 Phone', contact: '👤 Contact',
                            safebox: '📦 SafeBox Share', location: '📍 Location', text: '📝 Text'
                        };
                        if (resultType) resultType.textContent = typeLabels[type] || '📝 Text';
                        if (resultActions && scanner) {
                            resultActions.innerHTML = scanner.getResultActions({ data: code.data, type: type });
                        }
                        const status = document.getElementById('scanStatus');
                        if (status) status.textContent = '✅ QR detected from image!';
                    }
                } else {
                    qrToast('❌ No QR code found in image. Make sure the QR code is clearly visible.', 'error');
                    const status = document.getElementById('scanStatus');
                    if (status) status.textContent = '❌ No QR code found in image';
                }
            };
            img.src = e.target.result;
        } catch (error) {
            console.error('QR detection error:', error);
            qrToast('Error reading QR code: ' + error.message, 'error');
        }
    };
    reader.readAsDataURL(file);
    input.value = '';
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function closeResult() {
    const result = document.getElementById('scanResult');
    if (result) result.style.display = 'none';
}

function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            qrToast('📋 Copied to clipboard!', 'success');
        }).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        qrToast('📋 Copied to clipboard!', 'success');
    } catch (e) {
        qrToast('Failed to copy text', 'error');
    }
    document.body.removeChild(textarea);
}

function saveQRResult(data) {
    const filename = prompt('Enter filename:', 'qr_result.txt');
    if (!filename) return;
    const blob = new Blob([data], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    qrToast('💾 Saved: ' + filename, 'success');
}

function handleSafeBoxShare(data) {
    const fileId = data.split('/').pop();
    qrToast('📦 Opening shared file: ' + fileId, 'info');
    window.location.href = `files.html?share=${fileId}`;
}

function connectWiFi(wifiData) {
    const ssid = wifiData.match(/S:([^;]+)/)?.[1] || 'Unknown';
    const pass = wifiData.match(/P:([^;]+)/)?.[1] || '';
    qrToast(`📶 WiFi: ${ssid}\nPassword: ${pass || 'No password'}`, 'info');
}

// ============================================
// QR GENERATOR FUNCTIONS - FIXED
// ============================================

function generateQR() {
    const input = document.getElementById('qrInput');
    const output = document.getElementById('qrOutput');
    if (!input || !output) return;
    const text = input.value.trim();
    if (!text) {
        qrToast('Please enter text to generate QR code', 'warning');
        return;
    }
    if (!generator) {
        generator = new QRGenerator();
    }
    const colorInput = document.getElementById('qrColor');
    const color = colorInput?.value?.replace('#', '') || '6C63FF';
    const sizeInput = document.getElementById('qrSize');
    const size = parseInt(sizeInput?.value) || 200;
    
    const qrUrl = generator.generate(text, { size: size, color: color, bgColor: 'FFFFFF' });
    
    // Store URL for download
    window._currentQRUrl = qrUrl;
    window._currentQRText = text;

    output.innerHTML = `
        <div style="text-align:center;padding:10px;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
            <img src="${qrUrl}" id="qrCodeImage" alt="QR Code" style="border-radius:8px;max-width:100%;" crossorigin="anonymous">
            <p style="font-size:12px;color:#6a7a8e;margin-top:8px;word-break:break-all;">${text}</p>
            <div style="margin-top:10px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                <button onclick="downloadQR()" class="btn btn-small btn-success">💾 Download QR</button>
                <button onclick="copyText('${text}')" class="btn btn-small btn-secondary">📋 Copy Text</button>
            </div>
        </div>
    `;
    qrToast('✅ QR Code generated!', 'success');
}

// ============================================
// DOWNLOAD QR - FIXED FOR ANDROID
// ============================================
function downloadQR() {
    const qrUrl = window._currentQRUrl;
    if (!qrUrl) {
        qrToast('No QR code to download', 'error');
        return;
    }

    qrToast('📥 Downloading...', 'info');

    // Try Android bridge first
    if (typeof window.Android !== 'undefined' && window.Android.saveFileToDevice) {
        try {
            const qrImg = document.getElementById('qrCodeImage');
            if (qrImg) {
                const canvas = document.createElement('canvas');
                canvas.width = qrImg.naturalWidth || 200;
                canvas.height = qrImg.naturalHeight || 200;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(qrImg, 0, 0, canvas.width, canvas.height);
                const dataURL = canvas.toDataURL('image/png');
                const base64 = dataURL.split(',')[1];
                const result = window.Android.saveFileToDevice('qrcode.png', base64, 'image/png');
                if (result === true) {
                    qrToast('✅ QR Code saved to Downloads/SafeBox', 'success');
                    return;
                }
            }
        } catch (e) {
            console.warn('Android download error:', e);
        }
    }

    // Fallback: Fetch and download
    browserDownloadQR(qrUrl, 'qrcode.png');
}

function generateQRWithOptions() {
    generateQR();
}

// ============================================
// EXPOSE FUNCTIONS
// ============================================

window.startScan = startScan;
window.stopScan = stopScan;
window.uploadQRImage = uploadQRImage;
window.copyText = copyText;
window.saveQRResult = saveQRResult;
window.handleSafeBoxShare = handleSafeBoxShare;
window.connectWiFi = connectWiFi;
window.closeResult = closeResult;
window.generateQR = generateQR;
window.generateQRWithOptions = generateQRWithOptions;
window.downloadQR = downloadQR;
window.browserDownloadQR = browserDownloadQR;

// ============================================
// INITIALIZATION
// ============================================
let qrInitialized = false;

document.addEventListener('DOMContentLoaded', function() {
    if (!qrInitialized) {
        qrInitialized = true;
        initQRScanner();
    }
});

console.log('📷 QR Scanner & Generator fully loaded!');
console.log('✅ Supports any QR code from camera or image upload');
console.log('✅ Optimized for mobile performance');
console.log('✅ QR Download fixed for Android');