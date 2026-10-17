// ============================================
// WEBRTC-SHARE.JS - Cross-Device File Transfer
// Complete working implementation with QR + WebRTC
// ============================================

const WebRTCShare = {
    // State
    peerConnection: null,
    dataChannel: null,
    isSender: false,
    isReceiver: false,
    shareData: null,
    receiveBuffer: [],
    receiveMetadata: null,
    totalReceived: 0,
    fileId: null,
    onProgress: null,
    onComplete: null,
    _candidates: [],
    _candidateGatheringDone: false,

    // ============================================
    // GENERATE TOKEN
    // ============================================
    generateToken() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let token = '';
        for (let i = 0; i < 32; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    },

    // ============================================
    // GET LOCAL IP
    // ============================================
    getLocalIP() {
        return new Promise((resolve) => {
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });

            pc.createDataChannel('');
            pc.createOffer().then(offer => {
                pc.setLocalDescription(offer);
            }).catch(() => {});

            let ipFound = false;

            pc.onicecandidate = (ice) => {
                if (!ice || !ice.candidate || ipFound) return;

                const candidate = ice.candidate.candidate;
                const ipRegex = /([0-9]{1,3}\.){3}[0-9]{1,3}/;
                const match = candidate.match(ipRegex);

                if (match) {
                    const ip = match[0];
                    if (!ip.startsWith('127.') && !ip.startsWith('169.254.')) {
                        ipFound = true;
                        resolve(ip);
                        pc.close();
                        return;
                    }
                }
            };

            setTimeout(() => {
                if (!ipFound) {
                    resolve('192.168.1.1');
                    pc.close();
                }
            }, 3000);
        });
    },

    // ============================================
    // GENERATE QR CODE
    // ============================================
    generateQRCode(data) {
        const encoded = encodeURIComponent(data);
        const size = 300;
        const color = '667eea';
        return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}&color=${color}&bgcolor=FFFFFF&margin=10`;
    },

    // ============================================
    // CREATE SHARE (Sender)
    // ============================================
    async createShare(fileId, onProgress, onComplete) {
        try {
            this.onProgress = onProgress;
            this.onComplete = onComplete;
            this.isSender = true;
            this.isReceiver = false;
            this._candidates = [];
            this._candidateGatheringDone = false;

            // Get the file
            if (typeof getFile !== 'function') {
                throw new Error('getFile function not available');
            }

            const file = await getFile(fileId);
            if (!file || !file.blob) {
                throw new Error('File not found');
            }

            this.fileId = fileId;
            this.shareData = {
                fileId: file.id,
                fileName: file.original_name,
                fileSize: file.size,
                fileType: file.mime_type || 'application/octet-stream',
                blob: file.blob
            };

            if (onProgress) {
                onProgress('🔍 Creating connection...', 5);
            }

            // Create WebRTC connection
            const config = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ],
                iceCandidatePoolSize: 10
            };

            this.peerConnection = new RTCPeerConnection(config);

            // Create data channel
            this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
                ordered: true,
                maxRetransmits: 3
            });

            // Set up data channel events
            this.dataChannel.onopen = () => {
                if (onProgress) {
                    onProgress('✅ Connected! Sending file...', 30);
                }
                this.sendFile();
            };

            this.dataChannel.onerror = (error) => {
                if (onProgress) {
                    onProgress('❌ Connection error: ' + error.message, 0);
                }
            };

            this.dataChannel.onclose = () => {
                if (onProgress) {
                    onProgress('⏹️ Connection closed', 0);
                }
            };

            // Collect ICE candidates
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this._candidates.push(event.candidate.candidate);
                } else {
                    this._candidateGatheringDone = true;
                }
            };

            // Create offer
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false
            });

            await this.peerConnection.setLocalDescription(offer);

            // Wait for candidates
            await new Promise((resolve) => {
                const checkDone = () => {
                    if (this._candidateGatheringDone) {
                        resolve();
                    } else {
                        setTimeout(checkDone, 100);
                    }
                };
                setTimeout(checkDone, 1000);
            });

            // Create QR data
            const qrData = {
                type: 'SAFEBOX_WEBRTC',
                version: '1.0',
                sdp: this.peerConnection.localDescription.sdp,
                candidates: this._candidates,
                file: {
                    id: file.id,
                    name: file.original_name,
                    size: file.size,
                    type: file.mime_type || 'application/octet-stream'
                },
                token: this.generateToken(),
                timestamp: Date.now(),
                expiry: Date.now() + 5 * 60 * 1000 // 5 minutes
            };

            const qrString = JSON.stringify(qrData);
            const qrUrl = this.generateQRCode(qrString);

            if (onProgress) {
                onProgress('📡 QR generated - Scan to receive', 10);
            }

            // Store share session
            await this.storeShareSession(qrData);

            return {
                qrUrl: qrUrl,
                qrData: qrData,
                fileName: file.original_name,
                fileSize: file.size,
                token: qrData.token
            };

        } catch (error) {
            console.error('Create share error:', error);
            if (this.onProgress) {
                this.onProgress('❌ ' + error.message, 0);
            }
            throw error;
        }
    },

    // ============================================
    // SEND FILE
    // ============================================
    async sendFile() {
        try {
            const file = this.shareData;
            const blob = file.blob;
            const chunkSize = 16384; // 16KB chunks
            const totalChunks = Math.ceil(blob.size / chunkSize);

            // Send metadata
            const metadata = {
                type: 'metadata',
                name: file.fileName,
                size: file.fileSize,
                type: file.fileType,
                chunks: totalChunks
            };

            this.dataChannel.send(JSON.stringify(metadata));

            if (this.onProgress) {
                this.onProgress(`📤 Sending: ${file.fileName}`, 35);
            }

            // Send file in chunks
            const arrayBuffer = await blob.arrayBuffer();

            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, arrayBuffer.byteLength);
                const chunk = arrayBuffer.slice(start, end);

                this.dataChannel.send(chunk);

                // Update progress
                if (this.onProgress && i % 5 === 0) {
                    const progress = 35 + ((i + 1) / totalChunks) * 60;
                    this.onProgress(`📤 Sending... ${Math.round(((i + 1) / totalChunks) * 100)}%`, progress);
                }
            }

            // Send completion signal
            this.dataChannel.send(JSON.stringify({ type: 'complete' }));

            if (this.onProgress) {
                this.onProgress('✅ File sent successfully!', 100);
            }

            if (this.onComplete) {
                this.onComplete({
                    success: true,
                    fileName: file.fileName,
                    fileSize: file.fileSize
                });
            }

            console.log('✅ File sent successfully');

        } catch (error) {
            console.error('Send error:', error);
            if (this.onProgress) {
                this.onProgress('❌ Send error: ' + error.message, 0);
            }
        }
    },

    // ============================================
    // RECEIVE SHARE (Receiver)
    // ============================================
    async receiveShare(qrData, onProgress, onComplete) {
        try {
            this.onProgress = onProgress;
            this.onComplete = onComplete;
            this.isReceiver = true;
            this.isSender = false;
            this.receiveBuffer = [];
            this.totalReceived = 0;
            this.receiveMetadata = null;

            if (onProgress) {
                onProgress('⏳ Connecting...', 5);
            }

            // Parse QR data if string
            let data = qrData;
            if (typeof qrData === 'string') {
                try {
                    data = JSON.parse(qrData);
                } catch (e) {
                    throw new Error('Invalid QR data');
                }
            }

            // Validate
            if (data.type !== 'SAFEBOX_WEBRTC') {
                throw new Error('Not a valid WebRTC share QR');
            }

            // Check expiry
            if (data.expiry && data.expiry < Date.now()) {
                throw new Error('This share has expired');
            }

            this.shareData = data;

            if (onProgress) {
                onProgress(`📥 Receiving: ${data.file.name}`, 10);
            }

            // Create WebRTC connection
            const config = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ],
                iceCandidatePoolSize: 10
            };

            this.peerConnection = new RTCPeerConnection(config);

            // Handle incoming data channel
            this.peerConnection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupReceiveChannel();
            };

            // Set remote description (the offer from QR)
            try {
                await this.peerConnection.setRemoteDescription({
                    type: 'offer',
                    sdp: data.sdp
                });
            } catch (e) {
                throw new Error('Failed to set remote description: ' + e.message);
            }

            // Add ICE candidates
            if (data.candidates && data.candidates.length > 0) {
                for (const candidateStr of data.candidates) {
                    try {
                        const candidate = new RTCIceCandidate({
                            candidate: candidateStr,
                            sdpMLineIndex: 0,
                            sdpMid: '0'
                        });
                        await this.peerConnection.addIceCandidate(candidate);
                    } catch (e) {
                        console.warn('Failed to add candidate:', e);
                    }
                }
            }

            // Create answer
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            if (onProgress) {
                onProgress('⏳ Waiting for connection...', 20);
            }

            // Wait for connection
            return new Promise((resolve, reject) => {
                this._receiveResolve = resolve;
                this._receiveReject = reject;

                // Timeout after 30 seconds
                setTimeout(() => {
                    if (!this._receiveResolved) {
                        reject(new Error('Connection timeout'));
                    }
                }, 30000);
            });

        } catch (error) {
            console.error('Receive error:', error);
            if (this.onProgress) {
                this.onProgress('❌ ' + error.message, 0);
            }
            throw error;
        }
    },

    // ============================================
    // SETUP RECEIVE CHANNEL
    // ============================================
    setupReceiveChannel() {
        this.dataChannel.onmessage = (event) => {
            // Check if it's metadata or file data
            if (typeof event.data === 'string') {
                try {
                    const parsed = JSON.parse(event.data);
                    if (parsed.type === 'metadata') {
                        this.receiveMetadata = parsed;
                        if (this.onProgress) {
                            this.onProgress(`📥 Receiving: ${parsed.name} (${this.formatSize(parsed.size)})`, 30);
                        }
                    } else if (parsed.type === 'complete') {
                        // File complete
                        this.saveReceivedFile();
                    }
                } catch (e) {
                    // It's binary data
                    this.receiveBuffer.push(event.data);
                    this.totalReceived += event.data.byteLength;

                    if (this.receiveMetadata) {
                        const progress = 30 + ((this.totalReceived / this.receiveMetadata.size) * 65);
                        if (this.onProgress && Math.floor(progress) % 5 === 0) {
                            this.onProgress(
                                `📥 Downloading... ${Math.round((this.totalReceived / this.receiveMetadata.size) * 100)}%`,
                                progress
                            );
                        }
                    }
                }
            } else {
                // Binary data
                this.receiveBuffer.push(event.data);
                this.totalReceived += event.data.byteLength;

                if (this.receiveMetadata) {
                    const progress = 30 + ((this.totalReceived / this.receiveMetadata.size) * 65);
                    if (this.onProgress && Math.floor(progress) % 5 === 0) {
                        this.onProgress(
                            `📥 Downloading... ${Math.round((this.totalReceived / this.receiveMetadata.size) * 100)}%`,
                            progress
                        );
                    }
                }
            }
        };

        this.dataChannel.onclose = () => {
            if (this.onProgress) {
                this.onProgress('⏹️ Connection closed', 0);
            }
        };

        this.dataChannel.onerror = (error) => {
            if (this.onProgress) {
                this.onProgress('❌ Connection error: ' + error.message, 0);
            }
            if (this._receiveReject) {
                this._receiveReject(error);
            }
        };
    },

    // ============================================
    // SAVE RECEIVED FILE
    // ============================================
    async saveReceivedFile() {
        try {
            if (this.onProgress) {
                this.onProgress('💾 Saving file...', 95);
            }

            // Combine all chunks
            const totalLength = this.receiveBuffer.reduce((sum, chunk) => sum + chunk.byteLength, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;

            for (const chunk of this.receiveBuffer) {
                combined.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
            }

            // Create blob
            const blob = new Blob([combined], {
                type: this.receiveMetadata.type || 'application/octet-stream'
            });

            // Create file object
            const fileData = {
                name: this.receiveMetadata.name,
                size: this.receiveMetadata.size,
                type: this.receiveMetadata.type || 'application/octet-stream'
            };

            // Save to IndexedDB
            if (typeof saveFile !== 'function') {
                throw new Error('saveFile not available');
            }

            const result = await saveFile(fileData, blob);

            if (result.success) {
                if (this.onProgress) {
                    this.onProgress('✅ File saved successfully!', 100);
                }

                if (this.onComplete) {
                    this.onComplete({
                        success: true,
                        fileName: this.receiveMetadata.name,
                        fileSize: this.receiveMetadata.size,
                        fileId: result.id
                    });
                }

                // Clean up
                this.receiveBuffer = [];
                this.totalReceived = 0;
                this.receiveMetadata = null;

                if (this._receiveResolve) {
                    this._receiveResolved = true;
                    this._receiveResolve({
                        success: true,
                        fileName: this.receiveMetadata?.name,
                        fileId: result.id
                    });
                }

                console.log('✅ File saved:', this.receiveMetadata?.name);

            } else {
                throw new Error(result.message || 'Failed to save file');
            }

        } catch (error) {
            console.error('Save error:', error);
            if (this.onProgress) {
                this.onProgress('❌ Save error: ' + error.message, 0);
            }
            if (this._receiveReject) {
                this._receiveReject(error);
            }
        }
    },

    // ============================================
    // STORE SHARE SESSION
    // ============================================
    async storeShareSession(qrData) {
        try {
            if (typeof openDB === 'function') {
                const db = await openDB();
                const transaction = db.transaction(['share_sessions'], 'readwrite');
                const store = transaction.objectStore('share_sessions');

                const session = {
                    token: qrData.token,
                    file_id: qrData.file.id,
                    file_name: qrData.file.name,
                    file_size: qrData.file.size,
                    file_type: qrData.file.type,
                    expiry: qrData.expiry,
                    status: 'active',
                    created_at: new Date().toISOString(),
                    qr_data: qrData
                };

                await new Promise((resolve, reject) => {
                    const request = store.add(session);
                    request.onsuccess = resolve;
                    request.onerror = reject;
                });

                console.log('📦 Share session stored');
            } else {
                // Fallback to localStorage
                localStorage.setItem('share_session_' + qrData.token, JSON.stringify(qrData));
            }
        } catch (error) {
            console.warn('Could not store share session:', error);
        }
    },

    // ============================================
    // GET SHARE SESSION
    // ============================================
    async getShareSession(token) {
        try {
            if (typeof openDB === 'function') {
                const db = await openDB();
                const transaction = db.transaction(['share_sessions'], 'readonly');
                const store = transaction.objectStore('share_sessions');
                const index = store.index('token');

                return new Promise((resolve, reject) => {
                    const request = index.get(token);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            } else {
                const data = localStorage.getItem('share_session_' + token);
                return data ? JSON.parse(data) : null;
            }
        } catch (error) {
            console.error('Get share session error:', error);
            return null;
        }
    },

    // ============================================
    // STOP SHARING
    // ============================================
    stop() {
        try {
            if (this.dataChannel) {
                this.dataChannel.close();
                this.dataChannel = null;
            }
            if (this.peerConnection) {
                this.peerConnection.close();
                this.peerConnection = null;
            }
            this.isSender = false;
            this.isReceiver = false;
            this._candidates = [];
            this.receiveBuffer = [];
            this.totalReceived = 0;
            this.receiveMetadata = null;
            console.log('⏹️ Share stopped');
        } catch (error) {
            console.error('Stop error:', error);
        }
    },

    // ============================================
    // FORMAT SIZE
    // ============================================
    formatSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
};

// ============================================
// EXPOSE
// ============================================
window.WebRTCShare = WebRTCShare;

console.log('📡 WebRTC Share module loaded');
console.log('📤 Cross-device file sharing ready');
console.log('📷 QR + WebRTC hybrid sharing available');