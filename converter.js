// ============================================
// CONVERTER.JS - COMPLETE REWRITE
// Professional file conversion with proper type detection
// Real image→PDF via jsPDF
// Internet-needed indicators for on-demand encoders
// GIF support removed (requires worker script)
// ============================================

// ============================================
// FORMAT REGISTRY
// ============================================

const FORMAT_REGISTRY = {
    image: {
        label: '🖼️ Images',
        icon: '🖼️',
        formats: {
            jpg:  { label: 'JPG',  mime: 'image/jpeg', ext: 'jpg',  category: 'image',    lossy: true,  encodable: true },
            png:  { label: 'PNG',  mime: 'image/png',  ext: 'png',  category: 'image',    lossy: false, encodable: true },
            webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', category: 'image',    lossy: true,  encodable: true },
            pdf:  { label: 'PDF',  mime: 'application/pdf', ext: 'pdf', category: 'document', lossy: false, encodable: true, needsLib: 'jspdf', needsInternet: true },
            bmp:  { label: 'BMP',  mime: 'image/bmp',  ext: 'bmp',  category: 'image',    lossy: false, encodable: false },
            tiff: { label: 'TIFF', mime: 'image/tiff', ext: 'tiff', category: 'image',    lossy: false, encodable: false },
            ico:  { label: 'ICO',  mime: 'image/x-icon', ext: 'ico', category: 'image',   lossy: false, encodable: false },
            svg:  { label: 'SVG',  mime: 'image/svg+xml', ext: 'svg', category: 'image',  lossy: false, encodable: false }
        }
    },
    document: {
        label: '📄 Documents',
        icon: '📄',
        formats: {
            pdf:  { label: 'PDF',      mime: 'application/pdf', ext: 'pdf',  category: 'document', lossy: false, encodable: true, needsLib: 'jspdf', needsInternet: true },
            txt:  { label: 'TXT',      mime: 'text/plain',      ext: 'txt',  category: 'document', lossy: false, encodable: true },
            html: { label: 'HTML',     mime: 'text/html',       ext: 'html', category: 'document', lossy: false, encodable: true },
            csv:  { label: 'CSV',      mime: 'text/csv',        ext: 'csv',  category: 'document', lossy: false, encodable: true },
            json: { label: 'JSON',     mime: 'application/json', ext: 'json', category: 'document', lossy: false, encodable: true },
            xml:  { label: 'XML',      mime: 'application/xml', ext: 'xml',  category: 'document', lossy: false, encodable: true },
            md:   { label: 'Markdown', mime: 'text/markdown',   ext: 'md',   category: 'document', lossy: false, encodable: true }
        }
    }
};

// ============================================
// FILE TYPE DETECTION
// ============================================

const FILE_TYPE_DETECTION = {
    byExtension: {
        jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image',
        webp: 'image', tiff: 'image', tif: 'image', ico: 'image', svg: 'image',
        pdf: 'document', txt: 'document', html: 'document', htm: 'document',
        csv: 'document', json: 'document', xml: 'document', md: 'document',
        markdown: 'document', rtf: 'document', doc: 'document', docx: 'document',
        xls: 'document', xlsx: 'document', ppt: 'document', pptx: 'document',
        zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
        mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio',
        mp4: 'video', avi: 'video', mkv: 'video', mov: 'video', wmv: 'video',
        webm: 'video', flv: 'video'
    },
    byMime: {
        'image/': 'image',
        'text/': 'document',
        'application/pdf': 'document',
        'application/json': 'document',
        'application/xml': 'document',
        'application/zip': 'archive',
        'audio/': 'audio',
        'video/': 'video'
    }
};

function detectFileType(file) {
    if (file.type) {
        for (const [prefix, type] of Object.entries(FILE_TYPE_DETECTION.byMime)) {
            if (file.type.startsWith(prefix)) return type;
        }
    }
    const ext = file.name.split('.').pop().toLowerCase();
    return FILE_TYPE_DETECTION.byExtension[ext] || 'unknown';
}

function getFileCategory(file) {
    const type = detectFileType(file);
    const categories = {
        image: 'image', document: 'document',
        audio: 'document', video: 'document',
        archive: 'document', unknown: 'document'
    };
    return categories[type] || 'document';
}

function getSupportedFormats(category) {
    return FORMAT_REGISTRY[category]?.formats || {};
}

function getAllFormats() {
    const all = {};
    for (const cat of Object.values(FORMAT_REGISTRY)) {
        Object.assign(all, cat.formats);
    }
    return all;
}

function getFormatInfo(formatKey) {
    for (const cat of Object.values(FORMAT_REGISTRY)) {
        if (cat.formats[formatKey]) return cat.formats[formatKey];
    }
    return null;
}

// ============================================
// ✅ INTERNET-NEEDED HELPERS
// ============================================

function formatNeedsInternet(formatKey) {
    const info = getFormatInfo(formatKey);
    return !!(info && info.needsInternet);
}

function isEncoderReady(formatKey) {
    const info = getFormatInfo(formatKey);
    if (!info || !info.needsLib) return true;
    if (info.needsLib === 'jspdf') return !!(window.jspdf && window.jspdf.jsPDF);
    return true;
}

// ============================================
// LIBRARY LOADERS (PDF.js, jsPDF)
// ============================================

let pdfJsLoaded = false;
let pdfJsLoading = false;
let jsPdfLoaded = false;
let jsPdfLoading = null;

function loadPdfJs() {
    return new Promise((resolve, reject) => {
        if (pdfJsLoaded || typeof pdfjsLib !== 'undefined') {
            pdfJsLoaded = true;
            if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }
            resolve();
            return;
        }
        if (pdfJsLoading) {
            const check = setInterval(() => {
                if (pdfJsLoaded) { clearInterval(check); resolve(); }
            }, 100);
            return;
        }
        pdfJsLoading = true;
        const sources = [
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
            'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
            'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js'
        ];
        let attempt = 0;
        function tryLoad() {
            if (attempt >= sources.length) {
                pdfJsLoading = false;
                reject(new Error('Failed to load PDF.js from all sources'));
                return;
            }
            const script = document.createElement('script');
            script.src = sources[attempt];
            script.onload = () => {
                if (typeof pdfjsLib !== 'undefined') {
                    if (pdfjsLib.GlobalWorkerOptions) {
                        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    }
                    pdfJsLoaded = true;
                    pdfJsLoading = false;
                    resolve();
                } else {
                    attempt++; tryLoad();
                }
            };
            script.onerror = () => { attempt++; tryLoad(); };
            document.head.appendChild(script);
        }
        tryLoad();
    });
}

function loadJsPDF() {
    if (jsPdfLoaded && window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf);
    if (jsPdfLoading) return jsPdfLoading;

    jsPdfLoading = new Promise((resolve, reject) => {
        const sources = [
            'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
            'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
            'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js'
        ];
        let attempt = 0;
        function tryLoad() {
            if (attempt >= sources.length) {
                jsPdfLoading = null;
                reject(new Error('Failed to load jsPDF from all sources'));
                return;
            }
            const script = document.createElement('script');
            script.src = sources[attempt];
            script.onload = () => {
                if (window.jspdf && window.jspdf.jsPDF) {
                    jsPdfLoaded = true;
                    resolve(window.jspdf);
                } else {
                    attempt++; tryLoad();
                }
            };
            script.onerror = () => { attempt++; tryLoad(); };
            document.head.appendChild(script);
        }
        tryLoad();
    });
    return jsPdfLoading;
}

// ============================================
// IMAGE CONVERTER
// ============================================

class ImageConverter {
    static async convert(file, targetFormat, options = {}) {
        if (targetFormat === 'pdf') return ImageConverter.toPdf(file, options);

        const CANVAS_NATIVE = ['jpg', 'jpeg', 'png', 'webp'];
        if (!CANVAS_NATIVE.includes(targetFormat)) {
            throw new Error(
                `Image → ${targetFormat.toUpperCase()} is not supported in this build. ` +
                `Supported image outputs: JPG, PNG, WebP, PDF.`
            );
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            let img = null;

            function cleanup() {
                if (img) {
                    try { img.src = ''; } catch (e) { /* ignore */ }
                }
                if (window.gc) window.gc();
            }

            reader.onload = function(e) {
                img = new Image();

                img.onload = function() {
                    try {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');

                        let width = img.width;
                        let height = img.height;

                        const maxSize = options.maxSize || 2048;
                        if (width > maxSize || height > maxSize) {
                            const ratio = Math.min(maxSize / width, maxSize / height);
                            width = Math.round(width * ratio);
                            height = Math.round(height * ratio);
                        }

                        canvas.width = width;
                        canvas.height = height;

                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = options.quality === 'high' ? 'high' : 'medium';
                        ctx.drawImage(img, 0, 0, width, height);

                        const formatInfo = getFormatInfo(targetFormat);
                        if (!formatInfo) {
                            cleanup();
                            reject(new Error(`Unsupported format: ${targetFormat}`));
                            return;
                        }

                        let quality = options.quality || 0.85;
                        if (!formatInfo.lossy) quality = undefined;

                        const mimeType = formatInfo.mime;
                        const dataUrl = canvas.toDataURL(mimeType, quality);

                        if (mimeType !== 'image/png' && dataUrl.startsWith('data:image/png')) {
                            cleanup();
                            reject(new Error(
                                `This browser cannot encode ${formatInfo.label}. ` +
                                `Fell back to PNG. Please choose a different output.`
                            ));
                            return;
                        }

                        const byteString = atob(dataUrl.split(',')[1]);
                        const arrayBuffer = new ArrayBuffer(byteString.length);
                        const uint8Array = new Uint8Array(arrayBuffer);
                        for (let i = 0; i < byteString.length; i++) {
                            uint8Array[i] = byteString.charCodeAt(i);
                        }

                        const blob = new Blob([uint8Array], { type: mimeType });

                        cleanup();
                        resolve(createResult(blob, targetFormat, file, {
                            width, height,
                            originalWidth: img.width,
                            originalHeight: img.height
                        }));

                    } catch (error) {
                        cleanup();
                        reject(new Error(`Image conversion failed: ${error.message}`));
                    }
                };

                img.onerror = function() {
                    cleanup();
                    reject(new Error('Failed to load image'));
                };

                img.src = e.target.result;
            };

            reader.onerror = function() {
                cleanup();
                reject(new Error('Failed to read file'));
            };

            reader.readAsDataURL(file);
        });
    }

    static async toPdf(file, options = {}) {
        if (options.onProgress) options.onProgress(15, '📄 Loading jsPDF...');
        await loadJsPDF();

        if (options.onProgress) options.onProgress(40, '📄 Loading image...');

        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read image'));
            reader.readAsDataURL(file);
        });

        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('Failed to decode image'));
            i.src = dataUrl;
        });

        if (options.onProgress) options.onProgress(65, '📄 Building PDF...');

        const { jsPDF } = window.jspdf;
        const orientation = img.width > img.height ? 'landscape' : 'portrait';
        const pdf = new jsPDF({ orientation, unit: 'px', format: [img.width, img.height] });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const jpegData = canvas.toDataURL('image/jpeg', 0.95);

        pdf.addImage(jpegData, 'JPEG', 0, 0, img.width, img.height);

        if (options.onProgress) options.onProgress(90, '📄 Finalizing PDF...');

        const blob = pdf.output('blob');
        return createResult(blob, 'pdf', file, {
            source: 'jsPDF',
            pageCount: 1,
            width: img.width,
            height: img.height
        });
    }
}

// ============================================
// DOCUMENT CONVERTER
// ============================================

class DocumentConverter {
    static async convert(file, targetFormat, options = {}) {
        const ext = file.name.split('.').pop().toLowerCase();
        const isPdf = ext === 'pdf' || file.type === 'application/pdf';
        const isText = (file.type && file.type.startsWith('text/')) ||
                      ['txt', 'csv', 'json', 'xml', 'html', 'htm', 'md'].includes(ext);

        if (isPdf && targetFormat !== 'pdf') {
            return await DocumentConverter.convertPdf(file, targetFormat, options);
        }
        if (targetFormat === 'pdf' && !isPdf) {
            return await DocumentConverter.convertToPdf(file, options);
        }
        if (isText || ext === 'json' || ext === 'xml' || ext === 'csv') {
            return await DocumentConverter.convertText(file, targetFormat, options);
        }
        if (targetFormat === 'txt' || targetFormat === 'json') {
            return await DocumentConverter.convertBinary(file, targetFormat, options);
        }

        throw new Error(
            `Cannot convert ${ext.toUpperCase()} → ${targetFormat.toUpperCase()}. ` +
            `This pair requires a specialized decoder not available in this build.`
        );
    }

    static async convertPdf(file, targetFormat, options) {
        try {
            await loadPdfJs();
        } catch (error) {
            throw new Error(`PDF.js loading failed: ${error.message}`);
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const arrayBuffer = e.target.result;
                    if (options.onProgress) options.onProgress(20, '📄 Loading PDF...');

                    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                    const pdf = await loadingTask.promise;

                    if (options.onProgress) {
                        options.onProgress(40, `📄 Extracting text from ${pdf.numPages} pages...`);
                    }

                    let fullText = '';
                    const pageTexts = [];

                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map(item => item.str).join(' ').trim();
                        if (pageText) {
                            pageTexts.push(pageText);
                            fullText += pageText + '\n\n';
                        }
                        if (options.onProgress) {
                            const progress = 40 + (i / pdf.numPages) * 40;
                            options.onProgress(progress, `📄 Page ${i}/${pdf.numPages}...`);
                        }
                    }

                    if (options.onProgress) {
                        options.onProgress(85, `📄 Converting to ${targetFormat.toUpperCase()}...`);
                    }

                    const content = DocumentConverter.convertTextContent(fullText, targetFormat, {
                        fileName: file.name,
                        pageCount: pdf.numPages,
                        pageTexts
                    });

                    const formatInfo = getFormatInfo(targetFormat);
                    const mimeType = formatInfo?.mime || 'text/plain';
                    const blob = new Blob([content], { type: mimeType });

                    resolve(createResult(blob, targetFormat, file, {
                        source: 'PDF.js',
                        pageCount: pdf.numPages
                    }));
                } catch (error) {
                    reject(new Error(`PDF conversion failed: ${error.message}`));
                }
            };
            reader.onerror = function() {
                reject(new Error('Failed to read PDF file'));
            };
            reader.readAsArrayBuffer(file);
        });
    }

    static async convertToPdf(file, options) {
        if (options.onProgress) options.onProgress(25, '📄 Loading jsPDF...');
        await loadJsPDF();

        const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });

        if (options.onProgress) options.onProgress(55, '📄 Building PDF...');

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'pt', format: 'a4' });

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 40;
        const lineHeight = 14;
        const maxWidth = pageWidth - margin * 2;

        pdf.setFont('Helvetica', 'normal');
        pdf.setFontSize(11);

        const paragraphs = text.split('\n');
        let y = margin;

        for (const para of paragraphs) {
            const lines = pdf.splitTextToSize(para || ' ', maxWidth);
            for (const line of lines) {
                if (y + lineHeight > pageHeight - margin) {
                    pdf.addPage();
                    y = margin;
                }
                pdf.text(line, margin, y);
                y += lineHeight;
            }
        }

        if (options.onProgress) options.onProgress(90, '📄 Finalizing PDF...');

        const blob = pdf.output('blob');
        return createResult(blob, 'pdf', file, {
            source: 'jsPDF',
            pageCount: pdf.internal.getNumberOfPages()
        });
    }

    static async convertText(file, targetFormat, options) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const content = e.target.result;
                    if (options.onProgress) {
                        options.onProgress(50, `📄 Converting to ${targetFormat.toUpperCase()}...`);
                    }
                    const converted = DocumentConverter.convertTextContent(content, targetFormat, {
                        fileName: file.name
                    });
                    const formatInfo = getFormatInfo(targetFormat);
                    const mimeType = formatInfo?.mime || 'text/plain';
                    const blob = new Blob([converted], { type: mimeType });
                    resolve(createResult(blob, targetFormat, file, { source: 'Text Conversion' }));
                } catch (error) {
                    reject(new Error(`Text conversion failed: ${error.message}`));
                }
            };
            reader.onerror = function() {
                reject(new Error('Failed to read file'));
            };
            reader.readAsText(file);
        });
    }

    static async convertBinary(file, targetFormat, options) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const arrayBuffer = e.target.result;
                    const uint8Array = new Uint8Array(arrayBuffer);
                    let content;
                    if (targetFormat === 'json') {
                        content = JSON.stringify({
                            fileName: file.name,
                            fileSize: file.size,
                            contentType: file.type || 'unknown',
                            data: Array.from(uint8Array.slice(0, 1000)),
                            truncated: file.size > 1000
                        }, null, 2);
                    } else {
                        content = `File: ${file.name}\nType: ${file.type || 'unknown'}\nSize: ${file.size} bytes\n\nBinary data (first 1000 bytes):\n${Array.from(uint8Array.slice(0, 1000)).join(' ')}`;
                    }
                    const formatInfo = getFormatInfo(targetFormat);
                    const mimeType = formatInfo?.mime || 'text/plain';
                    const blob = new Blob([content], { type: mimeType });
                    resolve(createResult(blob, targetFormat, file, { source: 'Binary Wrapping' }));
                } catch (error) {
                    reject(new Error(`Binary conversion failed: ${error.message}`));
                }
            };
            reader.onerror = function() {
                reject(new Error('Failed to read file'));
            };
            reader.readAsArrayBuffer(file);
        });
    }

    static convertTextContent(content, targetFormat, meta = {}) {
        const { fileName = 'file', pageCount = 0, pageTexts = [] } = meta;
        switch (targetFormat) {
            case 'txt':  return DocumentConverter.toTxt(content);
            case 'html': return DocumentConverter.toHtml(content, fileName);
            case 'csv':  return DocumentConverter.toCsv(content);
            case 'json': return DocumentConverter.toJson(content, fileName, pageCount, pageTexts);
            case 'xml':  return DocumentConverter.toXml(content, fileName, pageCount);
            case 'md':   return DocumentConverter.toMarkdown(content, fileName);
            default:     return content;
        }
    }

    static toTxt(content) {
        const text = content.replace(/<[^>]*>/g, ' ');
        return text.replace(/\s+/g, ' ').trim();
    }

    static toHtml(content, fileName) {
        const title = fileName.replace(/\.[^/.]+$/, '');
        const escaped = DocumentConverter.escapeHtml(content);
        const lines = content.split('\n');
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${DocumentConverter.escapeHtml(title)}</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f7f8fc; color: #1a202c; line-height: 1.6; }
        .container { background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
        h1 { color: #2d3748; border-bottom: 3px solid #667eea; padding-bottom: 12px; margin-top: 0; }
        .meta { color: #718096; font-size: 13px; margin: 16px 0; padding: 12px 16px; background: #f7fafc; border-radius: 6px; }
        .content { white-space: pre-wrap; word-wrap: break-word; }
        .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #a0aec0; text-align: center; }
        @media (max-width: 600px) { .container { padding: 16px; } }
    </style>
</head>
<body>
    <div class="container">
        <h1>📄 ${DocumentConverter.escapeHtml(title)}</h1>
        <div class="meta">
            📅 Converted on ${new Date().toLocaleString()}
            ${lines.length ? ` • 📊 ${lines.length} lines` : ''}
            ${content.length ? ` • 📝 ${content.split(/\s+/).length} words` : ''}
        </div>
        <div class="content">${escaped}</div>
        <div class="footer">Converted by SafeBox File Converter</div>
    </div>
</body>
</html>`;
    }

    static toCsv(content) {
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length === 0) return '';
        const firstLine = lines[0];
        const hasDelimiters = /[\t,|;]/.test(firstLine);
        if (hasDelimiters) {
            return lines.map(line => {
                const parts = line.split(/[\t,|;]/);
                return parts.map(p => `"${p.trim()}"`).join(',');
            }).join('\n');
        }
        return lines.map(line => `"${line.trim()}"`).join('\n');
    }

    static toJson(content, fileName, pageCount, pageTexts) {
        const lines = content.split('\n').filter(l => l.trim());
        try {
            const parsed = JSON.parse(content);
            return JSON.stringify(parsed, null, 2);
        } catch (e) { /* not valid JSON */ }

        const data = {
            document: {
                title: fileName.replace(/\.[^/.]+$/, ''),
                pageCount: pageCount || 1,
                lineCount: lines.length,
                wordCount: content.split(/\s+/).length,
                charCount: content.length,
                extractedText: content,
                lines,
                pages: pageTexts || [content],
                convertedAt: new Date().toISOString()
            }
        };
        return JSON.stringify(data, null, 2);
    }

    static toXml(content, fileName, pageCount) {
        const lines = content.split('\n').filter(l => l.trim());
        return `<?xml version="1.0" encoding="UTF-8"?>
<document>
    <metadata>
        <title>${DocumentConverter.escapeXml(fileName.replace(/\.[^/.]+$/, ''))}</title>
        <pageCount>${pageCount || 1}</pageCount>
        <lineCount>${lines.length}</lineCount>
        <wordCount>${content.split(/\s+/).length}</wordCount>
        <convertedAt>${new Date().toISOString()}</convertedAt>
    </metadata>
    <content>${DocumentConverter.escapeXml(content)}</content>
    <lines>
        ${lines.map(line => `        <line>${DocumentConverter.escapeXml(line)}</line>`).join('\n')}
    </lines>
</document>`;
    }

    static toMarkdown(content, fileName) {
        const title = fileName.replace(/\.[^/.]+$/, '');
        const lines = content.split('\n');
        let md = `# ${title}\n\n`;
        md += `*Converted on ${new Date().toLocaleString()}*\n\n---\n\n`;
        md += content;
        md += `\n\n---\n\n*${lines.length} lines, ${content.split(/\s+/).length} words*`;
        return md;
    }

    static escapeHtml(text) {
        if (!text) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    static escapeXml(text) {
        if (!text) return '';
        return text.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&apos;');
    }
}

// ============================================
// RESULT HELPER
// ============================================

function createResult(blob, format, originalFile, extra = {}) {
    const formatInfo = getFormatInfo(format);
    const ext = formatInfo?.ext || format;
    const mimeType = formatInfo?.mime || blob.type || 'application/octet-stream';
    const baseName = originalFile.name.replace(/\.[^/.]+$/, '');
    const fileName = `${baseName}.${ext}`;
    return {
        blob,
        fileName,
        size: blob.size,
        mimeType,
        format,
        originalName: originalFile.name,
        originalSize: originalFile.size,
        extension: ext,
        ...extra
    };
}

// ============================================
// MAIN CONVERTER CLASS
// ============================================

class FileConverter {
    constructor() {
        this._isProcessing = false;
        this.lastResult = null;
        this.options = { quality: 0.85, maxSize: 2048, preserveMetadata: true };
    }

    setQuality(quality) {
        this.options.quality = Math.max(0.1, Math.min(1, quality));
        return this;
    }

    setMaxSize(size) {
        this.options.maxSize = Math.max(64, size);
        return this;
    }

    async convert(file, targetFormat, onProgress = null) {
        if (this._isProcessing) throw new Error('Conversion already in progress');
        this._isProcessing = true;
        try {
            const category = getFileCategory(file);
            const formatInfo = getFormatInfo(targetFormat);
            if (!formatInfo) throw new Error(`Unsupported format: ${targetFormat}`);

            if (onProgress) onProgress(10, `🔍 Detected: ${category} → ${formatInfo.label}`);

            let result;
            switch (category) {
                case 'image':
                    if (onProgress) onProgress(20, '🖼️ Processing image...');
                    result = await ImageConverter.convert(file, targetFormat, {
                        ...this.options, onProgress
                    });
                    break;
                case 'document':
                default:
                    if (onProgress) onProgress(20, '📄 Processing document...');
                    result = await DocumentConverter.convert(file, targetFormat, {
                        ...this.options, onProgress
                    });
                    break;
            }

            if (onProgress) onProgress(100, '✅ Conversion complete!');
            this.lastResult = result;
            this._isProcessing = false;
            return result;
        } catch (error) {
            this._isProcessing = false;
            throw error;
        }
    }

    async download(result = null) {
        const file = result || this.lastResult;
        if (!file) throw new Error('No converted file available');

        if (typeof window.Android !== 'undefined' && window.Android.saveFileToDevice) {
            try {
                const reader = new FileReader();
                const base64 = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(file.blob);
                });
                const saved = window.Android.saveFileToDevice(file.fileName, base64, file.mimeType);
                if (saved) return { success: true, method: 'android', fileName: file.fileName };
            } catch (error) {
                console.warn('Android download failed, using browser:', error);
            }
        }

        const url = URL.createObjectURL(file.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60000);

        return { success: true, method: 'browser', fileName: file.fileName };
    }

    getFormats(category = null) {
        if (category) return getSupportedFormats(category);
        return getAllFormats();
    }

    getCategories() {
        return Object.keys(FORMAT_REGISTRY).map(key => ({
            key,
            label: FORMAT_REGISTRY[key].label,
            icon: FORMAT_REGISTRY[key].icon,
            count: Object.keys(FORMAT_REGISTRY[key].formats).length
        }));
    }

    detectCategory(file) { return getFileCategory(file); }
    isBusy() { return this._isProcessing; }
    getLastResult() { return this.lastResult; }
}

// ============================================
// GLOBAL INSTANCE
// ============================================

const converter = new FileConverter();
window.converter = converter;

// ============================================
// HELPER
// ============================================

function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ============================================
// UI LAYER
// ============================================

let _selectedFile = null;
let _lastConverted = null;
let _isConverting = false;

function initConverterUI() {
    const fromSelect = document.getElementById('convertFrom');
    const toSelect = document.getElementById('convertTo');
    const fileInput = document.getElementById('convertFileInput');
    const qualitySlider = document.getElementById('qualitySlider');
    const qualityValue = document.getElementById('qualityValue');

    if (!fromSelect || !toSelect) {
        console.warn('Converter UI elements not found');
        return;
    }

    populateToDropdown(fromSelect.value);
    populateCodecOptions(fromSelect.value);

    fromSelect.addEventListener('change', function () {
        populateToDropdown(this.value);
        populateCodecOptions(this.value);
    });

    if (fileInput) {
        fileInput.addEventListener('change', function () {
            const file = this.files && this.files[0];
            if (file) {
                _selectedFile = file;
                updateFileInfo(file);
                const detected = getFileCategory(file);
                if (detected === 'image' || detected === 'document') {
                    if (fromSelect.value !== detected) {
                        fromSelect.value = detected;
                        populateToDropdown(detected);
                        populateCodecOptions(detected);
                    }
                }
            }
        });
    }

    if (qualitySlider && qualityValue) {
        qualitySlider.addEventListener('input', function () {
            qualityValue.textContent = this.value + '%';
            converter.setQuality(this.value / 100);
        });
    }

    setTimeout(() => {
        if (toSelect.options.length === 0) populateToDropdown(fromSelect.value);
    }, 300);

    console.log('✅ Converter UI initialized');
}

function populateToDropdown(category) {
    const select = document.getElementById('convertTo');
    if (!select) return;

    const formats = getSupportedFormats(category) || {};
    const current = select.value;
    select.innerHTML = '';

    Object.entries(formats).forEach(([key, info]) => {
        if (info.encodable === false) return;

        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = info.needsInternet ? `${info.label} 🌐` : info.label;
        select.appendChild(opt);
    });

    if (current && Array.from(select.options).some(o => o.value === current)) {
        select.value = current;
    }

    select.dispatchEvent(new Event('change'));
}

function populateCodecOptions(category) {
    const container = document.getElementById('codecOptions');
    if (!container) return;

    const formats = getSupportedFormats(category) || {};
    container.innerHTML = '';

    Object.entries(formats).forEach(([key, info], idx) => {
        if (info.encodable === false) return;

        const label = document.createElement('label');
        label.className = 'codec-options-item' + (idx === 0 ? ' active' : '');
        const badge = info.needsInternet ? ' 🌐' : '';
        label.innerHTML = `
            <input type="radio" name="codec" value="${key}" ${idx === 0 ? 'checked' : ''}>
            <span>${info.label}${badge}</span>
        `;
        const radio = label.querySelector('input');
        radio.addEventListener('change', () => {
            container.querySelectorAll('label').forEach(l => l.classList.remove('active'));
            label.classList.add('active');
        });
        container.appendChild(label);
    });
}

function updateFileInfo(file) {
    const nameEl = document.getElementById('convertFileName');
    const sizeEl = document.getElementById('convertFileSize');
    const infoEl = document.getElementById('convertFileInfo');
    if (nameEl) nameEl.textContent = '📄 ' + file.name;
    if (sizeEl) sizeEl.textContent = '📊 ' + formatSize(file.size);
    if (infoEl) {
        const detected = detectFileType(file);
        infoEl.textContent = `🔍 Detected: ${detected} • ${file.type || 'unknown MIME'}`;
    }
}

async function convertFileUI() {
    if (_isConverting) { console.warn('Conversion already in progress'); return; }

    const file = _selectedFile || (document.getElementById('convertFileInput')?.files?.[0]);
    if (!file) { showToastSafe('Please select a file first', 'error'); return; }

    const toSelect = document.getElementById('convertTo');
    const targetFormat = toSelect?.value;
    if (!targetFormat) { showToastSafe('Please choose an output format', 'error'); return; }

    if (formatNeedsInternet(targetFormat) && !isEncoderReady(targetFormat)) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            showToastSafe(
                `❌ ${targetFormat.toUpperCase()} encoding requires an internet connection on first use. ` +
                `Please connect and try again.`,
                'error'
            );
            return;
        }
    }

    const opts = (typeof window.getOutputOptions === 'function') ? window.getOutputOptions() : {};

    _isConverting = true;
    const btn = document.getElementById('convertBtn');
    const progressContainer = document.getElementById('convertProgressContainer');
    const progressBar = document.getElementById('convertProgressBar');
    const progressText = document.getElementById('convertProgressText');
    const statusEl = document.getElementById('convertStatus');
    const resultBox = document.getElementById('convertResult');
    const messageEl = document.getElementById('convertMessage');

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Converting...'; }
    if (progressContainer) progressContainer.style.display = 'block';
    if (progressBar) progressBar.style.width = '5%';
    if (progressText) progressText.textContent = '5%';
    if (statusEl) statusEl.textContent = 'Starting...';
    if (resultBox) resultBox.style.display = 'none';

    try {
        const quality = (document.getElementById('qualitySlider')?.value || 80) / 100;
        converter.setQuality(quality);

        const result = await converter.convert(file, targetFormat, (pct, msg) => {
            if (progressBar) progressBar.style.width = Math.min(pct, 100) + '%';
            if (progressText) progressText.textContent = Math.round(pct) + '%';
            if (statusEl) statusEl.textContent = msg;
        });

        _lastConverted = result;

        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = '100%';
        if (statusEl) statusEl.textContent = '✅ Done!';

        const loc = opts.location || 'both';
        if ((loc === 'files' || loc === 'both') && typeof saveFile === 'function') {
            try {
                const wrappedFile = new File([result.blob], result.fileName, { type: result.mimeType });
                await saveFile({ name: result.fileName, size: result.blob.size, type: result.mimeType }, wrappedFile);
                if (statusEl) statusEl.textContent = '✅ Saved to My Files';
            } catch (e) { console.warn('Save to files failed:', e); }
        }

        if (loc === 'download' || loc === 'both') {
            await converter.download(result);
        }

        if (resultBox && messageEl) {
            messageEl.textContent = `${result.fileName} (${formatSize(result.blob.size)})`;
            resultBox.style.display = 'block';
        }

        showToastSafe(`✅ Converted to ${result.fileName}`, 'success');

        const toSelect2 = document.getElementById('convertTo');
        if (toSelect2) toSelect2.dispatchEvent(new Event('change'));

    } catch (error) {
        console.error('Conversion error:', error);
        if (statusEl) statusEl.textContent = '❌ ' + error.message;
        showToastSafe('❌ ' + error.message, 'error');
    } finally {
        _isConverting = false;
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Convert & Download'; }
    }
}

function resetConverter() {
    _selectedFile = null;
    _lastConverted = null;
    const fileInput = document.getElementById('convertFileInput');
    if (fileInput) fileInput.value = '';
    ['convertFileName','convertFileSize','convertFileInfo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    });
    const pc = document.getElementById('convertProgressContainer');
    const pb = document.getElementById('convertProgressBar');
    const rb = document.getElementById('convertResult');
    if (pc) pc.style.display = 'none';
    if (pb) pb.style.width = '0%';
    if (rb) rb.style.display = 'none';
    showToastSafe('🔄 Reset', 'info');
}

async function batchConvertFiles() {
    const input = document.getElementById('batchFileInput');
    const results = document.getElementById('batchResults');
    if (!input || !input.files || input.files.length === 0) {
        showToastSafe('Please select files first', 'error');
        return;
    }
    if (!results) return;
    results.innerHTML = '';

    const files = Array.from(input.files);
    const toSelect = document.getElementById('convertTo');
    const targetFormat = toSelect?.value || 'jpg';

    if (formatNeedsInternet(targetFormat) && !isEncoderReady(targetFormat)) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            showToastSafe(
                `❌ ${targetFormat.toUpperCase()} encoding requires an internet connection on first use.`,
                'error'
            );
            return;
        }
    }

    files.forEach((file, idx) => {
        const item = document.createElement('div');
        item.className = 'batch-item';
        item.innerHTML = `
            <span>${file.name}</span>
            <span class="status pending" id="batch-status-${idx}">Pending</span>
        `;
        results.appendChild(item);
    });

    let done = 0, failed = 0;

    for (let i = 0; i < files.length; i++) {
        const statusEl = document.getElementById(`batch-status-${i}`);
        if (statusEl) {
            statusEl.className = 'status processing';
            statusEl.textContent = 'Processing...';
        }
        try {
            const result = await converter.convert(files[i], targetFormat);
            await converter.download(result);
            done++;
            if (statusEl) {
                statusEl.className = 'status done';
                statusEl.textContent = '✅ Done';
            }
        } catch (e) {
            failed++;
            console.error('Batch file failed:', files[i].name, e);
            if (statusEl) {
                statusEl.className = 'status error';
                statusEl.textContent = '❌ ' + (e.message || 'Failed');
            }
        }
    }

    showToastSafe(`✅ Batch complete: ${done} success, ${failed} failed`, failed > 0 ? 'warning' : 'success');
}

function showToastSafe(msg, type) {
    if (typeof toast === 'function') { toast(msg, type); return; }
    if (typeof window.showToast === 'function' && window.showToast !== showToastSafe) {
        window.showToast(msg, type);
        return;
    }
    console.log(`[${type || 'info'}] ${msg}`);
}

// ============================================
// EXPOSE
// ============================================

window.formatSize = formatSize;
window.getFormatInfo = getFormatInfo;
window.getSupportedFormats = getSupportedFormats;
window.getAllFormats = getAllFormats;
window.detectFileType = detectFileType;
window.getFileCategory = getFileCategory;

window.formatNeedsInternet = formatNeedsInternet;
window.isEncoderReady = isEncoderReady;

window.initConverterUI = initConverterUI;
window.convertFileUI = convertFileUI;
window.resetConverter = resetConverter;
window.batchConvertFiles = batchConvertFiles;

console.log('🔄 File Converter loaded successfully!');
console.log(`📂 Supported: ${Object.keys(getAllFormats()).length} formats`);
console.log(`📁 Categories: ${converter.getCategories().map(c => `${c.label} (${c.count})`).join(', ')}`);
console.log('🎨 Converter UI layer loaded');
console.log('✨ Real image→PDF via jsPDF');
console.log('🌐 Internet-needed indicator active for PDF');