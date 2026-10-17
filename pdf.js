// ============================================
// PDF READER - FULL SCREEN WITH EDITING TOOLS
// COMPLETE FIX FOR ANDROID WEBVIEW
// ============================================

// ============================================
// FORMAT SIZE FALLBACK
// ============================================
function formatSize(bytes) {
    if (typeof window.formatSize === 'function') {
        return window.formatSize(bytes);
    }
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ============================================
// TOAST FALLBACK
// ============================================
function toast(message, type = 'info') {
    if (typeof window.toast === 'function') {
        window.toast(message, type);
        return;
    }
    // Fallback toast
    const existing = document.querySelector('.pdf-toast');
    if (existing) existing.remove();
    const toastEl = document.createElement('div');
    toastEl.className = 'pdf-toast';
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
        animation: slideUp 0.4s ease;
        text-align: center;
        max-width: 90%;
        pointer-events: none;
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
// PDF.JS CONFIG
// ============================================
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
} else {
    console.warn('pdfjsLib not loaded - PDF functionality may not work');
    // Try to load PDF.js dynamically
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = function() {
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            console.log('✅ PDF.js loaded dynamically');
        }
    };
    document.head.appendChild(script);
}

// ============================================
// STATE
// ============================================
let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.0;
let currentFileId = null;
let currentFileData = null;
let pdfFiles = [];
let canvas = null;
let ctx = null;

// ============================================
// EDITING STATE
// ============================================
let isDrawing = false;
let isHighlighting = false;
let isTextMode = false;
let lastX = 0;
let lastY = 0;
let selectedColor = '#FFEB3B';
let selectedTool = 'highlight';
let annotations = [];
let currentAnnotation = null;
let textInput = null;
let editCanvas = null;
let editCtx = null;
let isInitialized = false;
let currentBlobUrl = null;

// ============================================
// TOOL CONFIGURATION
// ============================================
const TOOLS = {
    highlight: {
        icon: '🟡',
        label: 'Highlight',
        color: '#FFEB3B',
        opacity: 0.4
    },
    draw: {
        icon: '✏️',
        label: 'Draw',
        color: '#667eea',
        opacity: 1
    },
    text: {
        icon: '📝',
        label: 'Text',
        color: '#ffffff',
        opacity: 1
    },
    line: {
        icon: '📏',
        label: 'Line',
        color: '#ef4444',
        opacity: 1
    },
    rectangle: {
        icon: '⬜',
        label: 'Rectangle',
        color: '#10b981',
        opacity: 0.3
    },
    erase: {
        icon: '🧹',
        label: 'Erase',
        color: '#ffffff',
        opacity: 1
    }
};

// ============================================
// SAFE ELEMENT GETTER
// ============================================
function safeElement(id) {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(`⚠️ Element not found: #${id}`);
    }
    return el;
}

// ============================================
// GET CANVAS CONTAINER
// ============================================
function getCanvasContainer() {
    let container = document.getElementById('canvasWrapper');
    if (container) return container;
    
    const viewer = document.getElementById('pdfViewer');
    if (viewer) {
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.style.display = 'none';
        }
        
        container = document.createElement('div');
        container.id = 'canvasWrapper';
        container.className = 'canvas-wrapper';
        container.style.cssText = 'position:relative;display:flex;justify-content:center;width:100%;min-height:300px;';
        container.innerHTML = `
            <canvas id="pdfCanvas" style="background:white;border-radius:4px;max-width:100%;height:auto;"></canvas>
            <canvas id="editCanvas" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:auto;cursor:crosshair;border-radius:4px;"></canvas>
        `;
        viewer.appendChild(container);
        return container;
    }
    return null;
}

// ============================================
// LOAD PDF FILES LIST - FIXED
// ============================================
async function loadPDFFiles() {
    try {
        if (typeof getFiles !== 'function') {
            console.warn('getFiles not available - check indexeddb.js');
            return;
        }
        
        const allFiles = await getFiles();
        pdfFiles = allFiles.filter(f => 
            f.extension === 'pdf' || 
            (f.original_name || '').toLowerCase().endsWith('.pdf')
        );
        
        const select = safeElement('pdfFileSelect');
        if (!select) return;
        
        select.innerHTML = '<option value="">📄 Select a PDF...</option>';
        
        if (pdfFiles.length === 0) {
            select.innerHTML += '<option value="" disabled>No PDFs found</option>';
            return;
        }
        
        pdfFiles.forEach(f => {
            const option = document.createElement('option');
            option.value = f.id;
            option.textContent = (f.original_name || 'Untitled') + ' (' + formatSize(f.size || 0) + ')';
            select.appendChild(option);
        });
        
        console.log('📄 Found', pdfFiles.length, 'PDFs');
        
    } catch (error) {
        console.error('Error loading PDF list:', error);
        toast('Could not load PDF list', 'error');
    }
}

// ============================================
// LOAD PDF - FIXED
// ============================================
async function loadPDF() {
    if (typeof pdfjsLib === 'undefined') {
        toast('❌ PDF library not loaded', 'error');
        return;
    }
    
    const select = safeElement('pdfFileSelect');
    if (!select) return;
    
    const fileId = parseInt(select.value);
    
    if (!fileId) {
        toast('Please select a PDF file', 'info');
        return;
    }
    
    showLoading(true);
    annotations = [];
    
    try {
        if (typeof getFile !== 'function') {
            throw new Error('getFile function not available');
        }
        
        const file = await getFile(fileId);
        if (!file || !file.blob) {
            toast('PDF file not found', 'error');
            showLoading(false);
            return;
        }
        
        currentFileId = fileId;
        currentFileData = file;
        
        let blob = file.blob;
        if (blob.type !== 'application/pdf') {
            try {
                const arrayBuffer = await blob.arrayBuffer();
                blob = new Blob([arrayBuffer], { type: 'application/pdf' });
            } catch (e) {
                console.warn('Could not fix PDF blob:', e);
            }
        }
        
        // Revoke old URL if exists
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }
        
        currentBlobUrl = URL.createObjectURL(blob);
        const loadingTask = pdfjsLib.getDocument(currentBlobUrl);
        pdfDoc = await loadingTask.promise;
        
        const emptyState = document.getElementById('emptyState');
        if (emptyState) emptyState.style.display = 'none';
        
        const container = getCanvasContainer();
        if (!container) {
            showLoading(false);
            toast('Container not found', 'error');
            return;
        }
        
        canvas = document.getElementById('pdfCanvas');
        ctx = canvas ? canvas.getContext('2d') : null;
        editCanvas = document.getElementById('editCanvas');
        editCtx = editCanvas ? editCanvas.getContext('2d') : null;
        
        if (!canvas || !editCanvas) {
            showLoading(false);
            toast('Failed to initialize canvas', 'error');
            return;
        }
        
        setupEditListeners();
        
        pageNum = 1;
        scale = 1.0;
        renderPage(pageNum);
        
        const fileNameEl = safeElement('pdfFileName');
        if (fileNameEl) fileNameEl.textContent = file.original_name || 'PDF';
        
        const prevBtn = safeElement('prevBtn');
        const nextBtn = safeElement('nextBtn');
        if (prevBtn) prevBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = pdfDoc.numPages <= 1;
        
        showLoading(false);
        toast('✅ Loaded: ' + (file.original_name || 'PDF'), 'success');
        
    } catch (error) {
        console.error('PDF load error:', error);
        showLoading(false);
        toast('❌ Failed to load PDF: ' + error.message, 'error');
        
        const container = getCanvasContainer();
        if (container) {
            container.innerHTML = `
                <div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">
                    <div style="font-size:48px;margin-bottom:16px;">❌</div>
                    <h3>Failed to Load PDF</h3>
                    <p style="font-size:14px;">${error.message}</p>
                    <p style="font-size:12px;margin-top:8px;">Try selecting a different file.</p>
                </div>
            `;
        }
    }
}

// ============================================
// SETUP EDITING LISTENERS - FIXED
// ============================================
function setupEditListeners() {
    if (!editCanvas) return;
    
    editCanvas.style.pointerEvents = 'auto';
    editCanvas.style.cursor = 'crosshair';
    
    try {
        const newCanvas = editCanvas.cloneNode(true);
        editCanvas.parentNode.replaceChild(newCanvas, editCanvas);
        editCanvas = newCanvas;
        editCtx = editCanvas.getContext('2d');
    } catch (error) {
        console.warn('Could not clone canvas:', error);
        editCtx = editCanvas.getContext('2d');
    }
    
    editCanvas.addEventListener('mousedown', startDraw);
    editCanvas.addEventListener('mousemove', draw);
    editCanvas.addEventListener('mouseup', endDraw);
    editCanvas.addEventListener('mouseleave', endDraw);
    
    editCanvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
        const touch = e.touches[0];
        if (!touch) return;
        const mouseEvent = new MouseEvent('mousedown', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        startDraw(mouseEvent);
    }, { passive: false });
    
    editCanvas.addEventListener('touchmove', function(e) {
        e.preventDefault();
        const touch = e.touches[0];
        if (!touch) return;
        const mouseEvent = new MouseEvent('mousemove', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        draw(mouseEvent);
    }, { passive: false });
    
    editCanvas.addEventListener('touchend', function(e) {
        e.preventDefault();
        endDraw(e);
    }, { passive: false });
    
    updateToolState();
}

// ============================================
// UPDATE TOOL STATE
// ============================================
function updateToolState() {
    if (!editCanvas) return;
    if (selectedTool === 'text') {
        editCanvas.style.cursor = 'text';
    } else if (selectedTool === 'erase') {
        editCanvas.style.cursor = 'pointer';
    } else {
        editCanvas.style.cursor = 'crosshair';
    }
}

// ============================================
// DRAWING FUNCTIONS
// ============================================
function getCanvasCoords(e) {
    if (!editCanvas) return { x: 0, y: 0 };
    const rect = editCanvas.getBoundingClientRect();
    const scaleX = editCanvas.width / rect.width;
    const scaleY = editCanvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function startDraw(e) {
    if (!editCtx || !editCanvas) return;
    
    if (selectedTool === 'erase') {
        isDrawing = true;
        const coords = getCanvasCoords(e);
        lastX = coords.x;
        lastY = coords.y;
        return;
    }
    if (selectedTool === 'text') {
        const coords = getCanvasCoords(e);
        showTextInput(coords.x, coords.y);
        return;
    }
    
    isDrawing = true;
    const coords = getCanvasCoords(e);
    lastX = coords.x;
    lastY = coords.y;
    
    currentAnnotation = {
        tool: selectedTool,
        color: selectedColor,
        points: [{ x: coords.x, y: coords.y }],
        startX: coords.x,
        startY: coords.y
    };
}

function draw(e) {
    if (!isDrawing || !editCtx || !editCanvas) return;
    if (selectedTool === 'erase') {
        eraseAt(e);
        return;
    }
    
    const coords = getCanvasCoords(e);
    
    if (selectedTool === 'highlight' || selectedTool === 'draw') {
        editCtx.beginPath();
        editCtx.moveTo(lastX, lastY);
        editCtx.lineTo(coords.x, coords.y);
        editCtx.strokeStyle = selectedColor;
        editCtx.lineWidth = selectedTool === 'highlight' ? 20 : 3;
        editCtx.globalAlpha = selectedTool === 'highlight' ? 0.4 : 1;
        editCtx.lineCap = 'round';
        editCtx.lineJoin = 'round';
        editCtx.stroke();
        editCtx.globalAlpha = 1;
        
        if (currentAnnotation) {
            currentAnnotation.points.push({ x: coords.x, y: coords.y });
        }
    } else if (selectedTool === 'line' || selectedTool === 'rectangle') {
        redrawAnnotations();
        drawShape(coords.x, coords.y);
    }
    
    lastX = coords.x;
    lastY = coords.y;
}

function endDraw(e) {
    if (isDrawing && currentAnnotation) {
        if (selectedTool === 'line' || selectedTool === 'rectangle') {
            const coords = getCanvasCoords(e);
            currentAnnotation.endX = coords.x;
            currentAnnotation.endY = coords.y;
        }
        
        if (currentAnnotation.points.length > 1 || 
            (currentAnnotation.startX !== undefined && currentAnnotation.endX !== undefined)) {
            annotations.push(currentAnnotation);
        }
    }
    
    isDrawing = false;
    currentAnnotation = null;
}

function drawShape(endX, endY) {
    if (!editCtx || !currentAnnotation) return;
    
    const startX = currentAnnotation.startX;
    const startY = currentAnnotation.startY;
    
    editCtx.beginPath();
    editCtx.strokeStyle = selectedColor;
    editCtx.lineWidth = 3;
    editCtx.globalAlpha = 1;
    
    if (selectedTool === 'line') {
        editCtx.moveTo(startX, startY);
        editCtx.lineTo(endX, endY);
    } else if (selectedTool === 'rectangle') {
        const width = endX - startX;
        const height = endY - startY;
        editCtx.fillStyle = selectedColor;
        editCtx.globalAlpha = 0.3;
        editCtx.fillRect(startX, startY, width, height);
        editCtx.globalAlpha = 1;
        editCtx.strokeRect(startX, startY, width, height);
    }
    
    editCtx.stroke();
    editCtx.globalAlpha = 1;
}

function eraseAt(e) {
    if (!editCtx || !editCanvas) return;
    const coords = getCanvasCoords(e);
    const radius = 20;
    
    editCtx.save();
    editCtx.globalCompositeOperation = 'destination-out';
    editCtx.beginPath();
    editCtx.arc(coords.x, coords.y, radius, 0, Math.PI * 2);
    editCtx.fill();
    editCtx.restore();
    
    annotations = annotations.filter(ann => {
        if (ann.points && ann.points.length > 0) {
            const avgX = ann.points.reduce((s, p) => s + p.x, 0) / ann.points.length;
            const avgY = ann.points.reduce((s, p) => s + p.y, 0) / ann.points.length;
            const dist = Math.sqrt(Math.pow(avgX - coords.x, 2) + Math.pow(avgY - coords.y, 2));
            return dist > radius * 2;
        }
        return true;
    });
}

function showTextInput(x, y) {
    if (textInput) {
        textInput.remove();
        textInput = null;
    }
    
    if (!editCanvas) return;
    
    const rect = editCanvas.getBoundingClientRect();
    const left = (x / editCanvas.width) * rect.width + rect.left;
    const top = (y / editCanvas.height) * rect.height + rect.top;
    
    textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.style.cssText = `
        position: fixed;
        left: ${left}px;
        top: ${top}px;
        background: rgba(0,0,0,0.85);
        color: white;
        border: 2px solid ${selectedColor};
        border-radius: 4px;
        padding: 6px 10px;
        font-size: 16px;
        font-family: inherit;
        min-width: 120px;
        z-index: 100;
        pointer-events: auto;
        outline: none;
    `;
    textInput.placeholder = 'Type text...';
    textInput.autofocus = true;
    
    document.body.appendChild(textInput);
    
    textInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            addTextAnnotation(x, y, this.value);
            this.remove();
            textInput = null;
        }
        if (e.key === 'Escape') {
            this.remove();
            textInput = null;
        }
    });
    
    textInput.addEventListener('blur', function() {
        if (this.value.trim()) {
            addTextAnnotation(x, y, this.value);
        }
        this.remove();
        textInput = null;
    });
}

function addTextAnnotation(x, y, text) {
    if (!editCtx || !text.trim()) return;
    
    const fontSize = 16;
    editCtx.font = `${fontSize}px Arial`;
    editCtx.fillStyle = selectedColor;
    editCtx.shadowColor = 'rgba(0,0,0,0.5)';
    editCtx.shadowBlur = 4;
    editCtx.fillText(text, x, y);
    editCtx.shadowBlur = 0;
    
    annotations.push({
        tool: 'text',
        color: selectedColor,
        text: text,
        x: x,
        y: y,
        fontSize: fontSize
    });
}

function redrawAnnotations() {
    if (!editCtx || !editCanvas) return;
    editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
    
    annotations.forEach(ann => {
        if (ann.tool === 'highlight' || ann.tool === 'draw') {
            if (ann.points && ann.points.length > 1) {
                editCtx.beginPath();
                editCtx.moveTo(ann.points[0].x, ann.points[0].y);
                for (let i = 1; i < ann.points.length; i++) {
                    editCtx.lineTo(ann.points[i].x, ann.points[i].y);
                }
                editCtx.strokeStyle = ann.color;
                editCtx.lineWidth = ann.tool === 'highlight' ? 20 : 3;
                editCtx.globalAlpha = ann.tool === 'highlight' ? 0.4 : 1;
                editCtx.lineCap = 'round';
                editCtx.lineJoin = 'round';
                editCtx.stroke();
                editCtx.globalAlpha = 1;
            }
        } else if (ann.tool === 'line') {
            editCtx.beginPath();
            editCtx.moveTo(ann.startX, ann.startY);
            editCtx.lineTo(ann.endX, ann.endY);
            editCtx.strokeStyle = ann.color;
            editCtx.lineWidth = 3;
            editCtx.stroke();
        } else if (ann.tool === 'rectangle') {
            const width = ann.endX - ann.startX;
            const height = ann.endY - ann.startY;
            editCtx.fillStyle = ann.color;
            editCtx.globalAlpha = 0.3;
            editCtx.fillRect(ann.startX, ann.startY, width, height);
            editCtx.globalAlpha = 1;
            editCtx.strokeRect(ann.startX, ann.startY, width, height);
        } else if (ann.tool === 'text') {
            editCtx.font = `${ann.fontSize || 16}px Arial`;
            editCtx.fillStyle = ann.color;
            editCtx.shadowColor = 'rgba(0,0,0,0.5)';
            editCtx.shadowBlur = 4;
            editCtx.fillText(ann.text, ann.x, ann.y);
            editCtx.shadowBlur = 0;
        }
    });
}

// ============================================
// RENDER PAGE - FIXED
// ============================================
function renderPage(num) {
    if (!pdfDoc || !canvas || !ctx || !editCanvas || !editCtx) {
        console.warn('Cannot render page - missing elements');
        return;
    }
    
    pageRendering = true;
    
    pdfDoc.getPage(num).then(function(page) {
        const viewport = page.getViewport({ scale: scale });
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        editCanvas.height = viewport.height;
        editCanvas.width = viewport.width;
        editCanvas.style.width = '100%';
        editCanvas.style.height = 'auto';
        
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        
        const renderTask = page.render(renderContext);
        
        renderTask.promise.then(function() {
            pageRendering = false;
            redrawAnnotations();
            if (pageNumPending !== null) {
                const pending = pageNumPending;
                pageNumPending = null;
                renderPage(pending);
            }
        });
    }).catch(function(error) {
        console.error('Page render error:', error);
        pageRendering = false;
        toast('❌ Error rendering page: ' + error.message, 'error');
    });
    
    updatePageInfo();
}

function updatePageInfo() {
    if (!pdfDoc) return;
    
    const pageInfo = safeElement('pdfPageInfo');
    if (pageInfo) pageInfo.textContent = `Page ${pageNum} / ${pdfDoc.numPages}`;
    
    const zoomLevel = safeElement('zoomLevel');
    if (zoomLevel) zoomLevel.textContent = Math.round(scale * 100) + '%';
    
    const prevBtn = safeElement('prevBtn');
    const nextBtn = safeElement('nextBtn');
    if (prevBtn) prevBtn.disabled = pageNum <= 1;
    if (nextBtn) nextBtn.disabled = pageNum >= pdfDoc.numPages;
}

function queueRenderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
    } else {
        renderPage(num);
    }
}

// ============================================
// NAVIGATION
// ============================================
function pdfPrev() {
    if (pageNum <= 1) return;
    pageNum--;
    queueRenderPage(pageNum);
}

function pdfNext() {
    if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum++;
    queueRenderPage(pageNum);
}

function pdfZoomIn() {
    scale = Math.min(scale + 0.1, 3.0);
    if (pdfDoc) {
        queueRenderPage(pageNum);
    }
}

function pdfZoomOut() {
    scale = Math.max(scale - 0.1, 0.3);
    if (pdfDoc) {
        queueRenderPage(pageNum);
    }
}

// ============================================
// TOOL SELECTION
// ============================================
function selectTool(toolName) {
    selectedTool = toolName;
    const tool = TOOLS[toolName];
    if (!tool) return;
    
    selectedColor = tool.color;
    
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tool === toolName) {
            btn.classList.add('active');
        }
    });
    
    updateToolState();
    
    if (toolName !== 'text' && textInput) {
        textInput.remove();
        textInput = null;
    }
    
    toast(`🔧 Selected: ${tool.label}`, 'info');
}

function setColor(color) {
    selectedColor = color;
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.color === color) {
            btn.classList.add('active');
        }
    });
}

// ============================================
// CLEAR ANNOTATIONS
// ============================================
function clearAnnotations() {
    if (!confirm('Clear all annotations from this page?')) return;
    annotations = [];
    redrawAnnotations();
    toast('🧹 Annotations cleared', 'info');
}

// ============================================
// SAVE PDF WITH ANNOTATIONS
// ============================================
async function savePDFWithAnnotations() {
    if (!currentFileData || !pdfDoc) {
        toast('No PDF loaded', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        const annotationData = {
            fileName: currentFileData.original_name,
            page: pageNum,
            scale: scale,
            annotations: annotations,
            savedAt: new Date().toISOString()
        };
        
        const json = JSON.stringify(annotationData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (currentFileData.original_name || 'document').replace('.pdf', '_annotations.json');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        
        toast('✅ Annotations saved!', 'success');
        showLoading(false);
        
    } catch (error) {
        console.error('Save error:', error);
        toast('❌ Failed to save: ' + error.message, 'error');
        showLoading(false);
    }
}

// ============================================
// UPLOAD PDF
// ============================================
function uploadPDF() {
    const uploadInput = safeElement('pdfUpload');
    if (uploadInput) uploadInput.click();
}

// ============================================
// PDF UPLOAD HANDLER - FIXED
// ============================================
function setupPDFUpload() {
    const uploadInput = safeElement('pdfUpload');
    if (!uploadInput) return;
    
    const newInput = uploadInput.cloneNode(true);
    uploadInput.parentNode.replaceChild(newInput, uploadInput);
    
    newInput.addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            toast('❌ Please select a PDF file', 'error');
            this.value = '';
            return;
        }
        
        if (typeof saveFile !== 'function') {
            toast('❌ Database not available', 'error');
            this.value = '';
            return;
        }
        
        showLoading(true);
        
        try {
            const result = await saveFile(file, file);
            if (result.success) {
                toast('✅ Uploaded: ' + file.name, 'success');
                await loadPDFFiles();
                
                const select = safeElement('pdfFileSelect');
                if (select) {
                    for (let i = 0; i < select.options.length; i++) {
                        const option = select.options[i];
                        if (option.textContent.includes(file.name)) {
                            select.value = option.value;
                            break;
                        }
                    }
                }
                
                loadPDF();
            } else {
                toast('❌ ' + result.message, 'error');
            }
        } catch (error) {
            toast('❌ Upload failed: ' + error.message, 'error');
        }
        
        showLoading(false);
        this.value = '';
    });
}

// ============================================
// DOWNLOAD PDF - FIXED
// ============================================
function pdfDownload() {
    if (!currentFileData) {
        toast('No PDF loaded', 'error');
        return;
    }
    
    if (typeof downloadFile === 'function') {
        downloadFile(currentFileId);
        toast('⬇️ Downloading: ' + (currentFileData.original_name || 'PDF'), 'success');
    } else {
        toast('❌ Download function not available', 'error');
    }
}

// ============================================
// DELETE PDF - FIXED
// ============================================
async function deletePDF() {
    if (!currentFileId) {
        toast('No PDF loaded', 'error');
        return;
    }
    
    if (!confirm(`Delete "${currentFileData.original_name || 'this PDF'}"?`)) return;
    
    try {
        if (typeof deleteFile !== 'function') {
            throw new Error('deleteFile not available');
        }
        
        const result = await deleteFile(currentFileId);
        if (result.success) {
            toast('🗑️ Deleted: ' + (currentFileData.original_name || 'PDF'), 'success');
            
            // Clean up
            if (currentBlobUrl) {
                URL.revokeObjectURL(currentBlobUrl);
                currentBlobUrl = null;
            }
            currentFileId = null;
            currentFileData = null;
            pdfDoc = null;
            annotations = [];
            
            const container = getCanvasContainer();
            if (container) {
                container.innerHTML = `
                    <div style="text-align:center;padding:40px;color:rgba(255,255,255,0.3);">
                        <div style="font-size:48px;margin-bottom:16px;">📄</div>
                        <h3>PDF Deleted</h3>
                        <p style="font-size:14px;">The PDF has been removed from your storage.</p>
                    </div>
                `;
            }
            
            const fileNameEl = safeElement('pdfFileName');
            if (fileNameEl) fileNameEl.textContent = '';
            
            const pageInfo = safeElement('pdfPageInfo');
            if (pageInfo) pageInfo.textContent = '- / -';
            
            const zoomLevel = safeElement('zoomLevel');
            if (zoomLevel) zoomLevel.textContent = '100%';
            
            const prevBtn = safeElement('prevBtn');
            const nextBtn = safeElement('nextBtn');
            if (prevBtn) prevBtn.disabled = true;
            if (nextBtn) nextBtn.disabled = true;
            
            await loadPDFFiles();
        } else {
            toast('❌ ' + result.message, 'error');
        }
    } catch (error) {
        toast('❌ Error deleting: ' + error.message, 'error');
    }
}

// ============================================
// LOADING OVERLAY
// ============================================
function showLoading(show) {
    const container = getCanvasContainer();
    if (!container) return;
    
    let overlay = container.querySelector('.loading-overlay');
    
    if (show) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'loading-overlay';
            overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.6);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 20;
                border-radius: 8px;
            `;
            overlay.innerHTML = `
                <div style="width:40px;height:40px;border:4px solid rgba(255,255,255,0.1);border-top-color:#667eea;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
                <p style="color:rgba(255,255,255,0.7);font-size:14px;margin-top:12px;">Loading PDF...</p>
            `;
            if (!document.getElementById('spinAnimStyle')) {
                const style = document.createElement('style');
                style.id = 'spinAnimStyle';
                style.textContent = `
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
            container.style.position = 'relative';
            container.appendChild(overlay);
        }
        overlay.style.display = 'flex';
    } else {
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
}

// ============================================
// LOGOUT
// ============================================
function logoutUser() {
    if (typeof window.logoutUser === 'function') {
        window.logoutUser();
    } else {
        window.location.href = 'login.html';
    }
}

// ============================================
// INITIALIZATION - FIXED
// ============================================
if (!isInitialized) {
    isInitialized = true;
    
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof getCurrentUser === 'function') {
            const user = getCurrentUser();
            if (!user) {
                window.location.href = 'login.html';
                return;
            }
        }
        
        loadPDFFiles();
        setupPDFUpload();
        
        // Handle resize
        let resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (pdfDoc) {
                    renderPage(pageNum);
                }
            }, 300);
        });
        
        console.log('📄 PDF Reader with Editing Tools loaded!');
        if (typeof pdfjsLib !== 'undefined') {
            console.log('📄 pdf.js version:', pdfjsLib.version);
        }
        console.log('🛠️ Tools: Highlight, Draw, Text, Line, Rectangle, Erase');
    });
}

// ============================================
// EXPOSE FUNCTIONS
// ============================================
window.loadPDFFiles = loadPDFFiles;
window.loadPDF = loadPDF;
window.uploadPDF = uploadPDF;
window.pdfPrev = pdfPrev;
window.pdfNext = pdfNext;
window.pdfZoomIn = pdfZoomIn;
window.pdfZoomOut = pdfZoomOut;
window.pdfDownload = pdfDownload;
window.deletePDF = deletePDF;
window.selectTool = selectTool;
window.setColor = setColor;
window.clearAnnotations = clearAnnotations;
window.savePDFWithAnnotations = savePDFWithAnnotations;
window.logoutUser = logoutUser;
window.getCanvasContainer = getCanvasContainer;

console.log('✅ pdf.js fully loaded with all fixes');