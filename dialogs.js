// ============================================
// DIALOGS.JS — Modal dialogs + toasts
// Replaces native alert / confirm / prompt
// ============================================

(function () {
    'use strict';

    // --------------------------------------------
    // Inject styles once
    // --------------------------------------------
    function injectStyles() {
        if (document.getElementById('safebox-dialogs-styles')) return;

        const style = document.createElement('style');
        style.id = 'safebox-dialogs-styles';
        style.textContent = `
            .sbd-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                z-index: 100000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            .sbd-backdrop.show { opacity: 1; }

            .sbd-modal {
                background: #1a1a2e;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 22px;
                max-width: 420px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                color: #fff;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                transform: translateY(20px);
                transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
                max-height: 85vh;
                display: flex;
                flex-direction: column;
            }
            .sbd-backdrop.show .sbd-modal {
                transform: translateY(0);
            }

            .sbd-modal-icon {
                font-size: 32px;
                line-height: 1;
                margin-bottom: 10px;
            }
            .sbd-modal-title {
                font-size: 17px;
                font-weight: 700;
                margin-bottom: 6px;
                color: #fff;
            }
            .sbd-modal-message {
                font-size: 14px;
                color: rgba(255, 255, 255, 0.7);
                line-height: 1.5;
                white-space: pre-wrap;
                word-wrap: break-word;
                overflow-y: auto;
                flex: 1;
            }

            .sbd-input {
                width: 100%;
                padding: 11px 14px;
                margin-top: 14px;
                background: rgba(255, 255, 255, 0.04);
                border: 2px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                font-size: 14px;
                color: rgba(255, 255, 255, 0.95);
                outline: none;
                transition: border-color 0.2s;
                font-family: inherit;
            }
            .sbd-input:focus { border-color: #667eea; }
            .sbd-input::placeholder { color: rgba(255, 255, 255, 0.3); }

            .sbd-actions {
                display: flex;
                gap: 10px;
                margin-top: 18px;
                justify-content: flex-end;
                flex-shrink: 0;
            }
            .sbd-btn {
                padding: 10px 18px;
                border-radius: 10px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                border: none;
                font-family: inherit;
                transition: all 0.15s;
                min-width: 80px;
            }
            .sbd-btn:active { transform: scale(0.96); }
            .sbd-btn:disabled { opacity: 0.4; cursor: not-allowed; }

            .sbd-btn-primary {
                background: #667eea;
                color: white;
            }
            .sbd-btn-primary:hover { background: #5a6fd6; }

            .sbd-btn-secondary {
                background: rgba(255, 255, 255, 0.06);
                color: rgba(255, 255, 255, 0.8);
            }
            .sbd-btn-secondary:hover { background: rgba(255, 255, 255, 0.1); }

            .sbd-btn-danger {
                background: #ef4444;
                color: white;
            }
            .sbd-btn-danger:hover { background: #dc2626; }

            .sbd-btn-success {
                background: #10b981;
                color: white;
            }
            .sbd-btn-success:hover { background: #059669; }
        `;
        document.head.appendChild(style);
    }

    // --------------------------------------------
    // Core modal builder
    // --------------------------------------------
    function buildModal({ icon, title, message, input, okLabel, cancelLabel, okStyle, showCancel }) {
        injectStyles();

        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.className = 'sbd-backdrop';

            const okClass =
                okStyle === 'danger'  ? 'sbd-btn-danger'  :
                okStyle === 'success' ? 'sbd-btn-success' :
                'sbd-btn-primary';

            backdrop.innerHTML = `
                <div class="sbd-modal" role="dialog" aria-modal="true">
                    ${icon ? `<div class="sbd-modal-icon">${icon}</div>` : ''}
                    ${title ? `<div class="sbd-modal-title">${escapeHtml(title)}</div>` : ''}
                    <div class="sbd-modal-message">${escapeHtml(message || '')}</div>
                    ${input ? `<input class="sbd-input" type="${input.type || 'text'}"
                                    placeholder="${escapeHtml(input.placeholder || '')}"
                                    value="${escapeHtml(input.value || '')}">` : ''}
                    <div class="sbd-actions">
                        ${showCancel ? `<button class="sbd-btn sbd-btn-secondary" data-action="cancel">${escapeHtml(cancelLabel || 'Cancel')}</button>` : ''}
                        <button class="sbd-btn ${okClass}" data-action="ok">${escapeHtml(okLabel || 'OK')}</button>
                    </div>
                </div>
            `;

            document.body.appendChild(backdrop);
            document.body.style.overflow = 'hidden';

            requestAnimationFrame(() => backdrop.classList.add('show'));

            const inputEl = backdrop.querySelector('.sbd-input');
            const okBtn = backdrop.querySelector('[data-action="ok"]');
            const cancelBtn = backdrop.querySelector('[data-action="cancel"]');

            let closed = false;

            function close(result) {
                if (closed) return;
                closed = true;
                backdrop.classList.remove('show');
                document.removeEventListener('keydown', onKey);
                document.body.style.overflow = '';
                setTimeout(() => {
                    backdrop.remove();
                    resolve(result);
                }, 200);
            }

            function onOk() {
                if (input) {
                    close(inputEl.value);
                } else {
                    close(true);
                }
            }

            function onCancel() {
                close(input ? null : false);
            }

            function onKey(e) {
                if (e.key === 'Escape') onCancel();
                if (e.key === 'Enter' && (!input || document.activeElement === inputEl)) onOk();
            }

            okBtn.addEventListener('click', onOk);
            if (cancelBtn) cancelBtn.addEventListener('click', onCancel);

            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) onCancel();
            });

            document.addEventListener('keydown', onKey);

            // Focus the input (or the OK button)
            setTimeout(() => {
                if (inputEl) {
                    inputEl.focus();
                    inputEl.select();
                } else {
                    okBtn.focus();
                }
            }, 250);
        });
    }

    function escapeHtml(text) {
        if (text == null) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // --------------------------------------------
    // Public API
    // --------------------------------------------
    const dialog = {
        alert(message, options = {}) {
            return buildModal({
                icon: options.icon || '💡',
                title: options.title || 'Notice',
                message,
                okLabel: options.okLabel || 'OK',
                okStyle: options.style,
                showCancel: false
            });
        },

        success(message, options = {}) {
            return buildModal({
                icon: options.icon || '✅',
                title: options.title || 'Success',
                message,
                okLabel: options.okLabel || 'OK',
                okStyle: 'success',
                showCancel: false
            });
        },

        error(message, options = {}) {
            return buildModal({
                icon: options.icon || '❌',
                title: options.title || 'Error',
                message,
                okLabel: options.okLabel || 'OK',
                okStyle: 'danger',
                showCancel: false
            });
        },

        warning(message, options = {}) {
            return buildModal({
                icon: options.icon || '⚠️',
                title: options.title || 'Warning',
                message,
                okLabel: options.okLabel || 'OK',
                okStyle: 'danger',
                showCancel: false
            });
        },

        confirm(message, options = {}) {
            return buildModal({
                icon: options.icon || '❓',
                title: options.title || 'Confirm',
                message,
                okLabel: options.okLabel || 'Confirm',
                cancelLabel: options.cancelLabel || 'Cancel',
                okStyle: options.style || 'danger',
                showCancel: true
            });
        },

        prompt(message, defaultValue = '', options = {}) {
            return buildModal({
                icon: options.icon || '✏️',
                title: options.title || 'Input',
                message,
                input: {
                    type: options.type || 'text',
                    placeholder: options.placeholder || '',
                    value: defaultValue
                },
                okLabel: options.okLabel || 'OK',
                cancelLabel: options.cancelLabel || 'Cancel',
                okStyle: options.style || 'primary',
                showCancel: true
            });
        }
    };

    // --------------------------------------------
    // Expose
    // --------------------------------------------
    window.dialog = dialog;

    // Optional: also expose global shortcuts, if you want
    // window.sbAlert   = dialog.alert;
    // window.sbConfirm = dialog.confirm;
    // window.sbPrompt  = dialog.prompt;

    console.log('✅ Dialog system ready');
})();