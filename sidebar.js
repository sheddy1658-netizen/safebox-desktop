// ============================================
// SHARED SIDEBAR — Auto-injected on every page
// LEFT-SIDE DRAWER VERSION
// Replaces old header nav with hamburger menu
// ============================================

(function() {
    'use strict';

    function init() {
        injectStyles();
        injectSidebar();
        setupEvents();
        highlightCurrentPage();
        populateUserInfo();
        startChatBadgePolling();
    }

    // --------------------------------------------
    // INJECT CSS
    // --------------------------------------------
    function injectStyles() {
        if (document.getElementById('safebox-sidebar-styles')) return;

        const style = document.createElement('style');
        style.id = 'safebox-sidebar-styles';
        style.textContent = `
            /* Hamburger button - fixed top-LEFT */
            .menu-toggle {
                position: fixed;
                top: 14px;
                left: 14px;
                z-index: 1100;
                width: 42px;
                height: 42px;
                border-radius: 10px;
                background: rgba(102, 126, 234, 0.15);
                border: 1px solid rgba(102, 126, 234, 0.3);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                color: #fff;
                font-size: 22px;
                line-height: 1;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                font-family: inherit;
                padding: 0;
            }

            .menu-toggle:hover {
                background: rgba(102, 126, 234, 0.3);
                transform: scale(1.05);
            }

            .menu-toggle:active {
                transform: scale(0.92);
            }

            .sidebar-backdrop {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.55);
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
                z-index: 1998;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.3s ease, visibility 0.3s ease;
            }

            .sidebar-backdrop.active {
                opacity: 1;
                visibility: visible;
            }

            .sidebar {
                position: fixed;
                top: 0;
                left: -320px;
                width: 300px;
                max-width: 85vw;
                height: 100vh;
                background: #0f0f1e;
                border-right: 1px solid rgba(255, 255, 255, 0.08);
                z-index: 1999;
                transition: left 0.35s cubic-bezier(0.16, 1, 0.3, 1);
                display: flex;
                flex-direction: column;
                overflow-y: auto;
                box-shadow: 10px 0 40px rgba(0, 0, 0, 0.5);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }

            .sidebar.active {
                left: 0;
            }

            .sidebar-header {
                padding: 20px 18px 14px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-shrink: 0;
            }

            .sidebar-header .brand {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 18px;
                font-weight: 700;
                background: linear-gradient(135deg, #667eea, #764ba2);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }

            .sidebar-header .close-btn {
                background: rgba(255, 255, 255, 0.06);
                border: none;
                color: rgba(255, 255, 255, 0.6);
                width: 30px;
                height: 30px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
                padding: 0;
                font-family: inherit;
            }

            .sidebar-header .close-btn:hover {
                background: rgba(239, 68, 68, 0.2);
                color: #ef4444;
            }

            .sidebar-user {
                padding: 14px 18px;
                display: flex;
                align-items: center;
                gap: 12px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                flex-shrink: 0;
            }

            .sidebar-user .avatar {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: linear-gradient(135deg, #667eea, #764ba2);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 17px;
                font-weight: 700;
                color: #fff;
                flex-shrink: 0;
            }

            .sidebar-user .info {
                min-width: 0;
                flex: 1;
            }

            .sidebar-user .info .name {
                font-weight: 600;
                color: #fff;
                font-size: 14px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .sidebar-user .info .meta {
                font-size: 11px;
                color: rgba(255, 255, 255, 0.4);
                margin-top: 2px;
            }

            .sidebar-nav {
                flex: 1;
                padding: 12px 10px 20px;
                display: flex;
                flex-direction: column;
                gap: 3px;
                overflow-y: auto;
            }

            .sidebar-nav a {
                display: flex;
                align-items: center;
                gap: 14px;
                padding: 11px 14px;
                border-radius: 10px;
                color: rgba(255, 255, 255, 0.75);
                text-decoration: none;
                font-size: 14px;
                font-weight: 500;
                transition: all 0.2s ease;
                border-left: 3px solid transparent;
                position: relative;
            }

            .sidebar-nav a:hover {
                background: rgba(102, 126, 234, 0.12);
                color: #fff;
            }

            .sidebar-nav a.active {
                background: linear-gradient(135deg, rgba(102, 126, 234, 0.22), rgba(118, 75, 162, 0.22));
                color: #fff;
                border-left-color: #667eea;
            }

            .sidebar-nav a .icon {
                font-size: 19px;
                flex-shrink: 0;
                width: 24px;
                text-align: center;
            }

            .sidebar-nav a .label {
                flex: 1;
            }

            /* ✅ Unread badge for Chat (and reusable for any item) */
            .sidebar-nav a .nav-badge {
                background: #ef4444;
                color: #fff;
                font-size: 10px;
                font-weight: 700;
                padding: 2px 7px;
                border-radius: 10px;
                min-width: 18px;
                text-align: center;
                line-height: 1.4;
                flex-shrink: 0;
                box-shadow: 0 0 0 2px #0f0f1e;
            }

            .sidebar-nav .logout-btn {
                color: #ef4444 !important;
                margin-top: 12px;
                border-top: 1px solid rgba(255, 255, 255, 0.06);
                padding-top: 14px !important;
                border-radius: 0 !important;
                border-left-color: transparent !important;
            }

            .sidebar-nav .logout-btn:hover {
                background: rgba(239, 68, 68, 0.1);
                border-left-color: #ef4444 !important;
            }

            .app-container header nav {
                display: none !important;
            }

            .app-container header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                padding-left: 70px !important;
            }

            .app-container header h1 {
                margin: 0 !important;
            }

            body {
                overflow-x: hidden;
            }
        `;
        document.head.appendChild(style);
    }

    // --------------------------------------------
    // INJECT SIDEBAR HTML
    // --------------------------------------------
    function injectSidebar() {
        if (document.getElementById('safeboxSidebar')) return;
        if (document.getElementById('menuToggle')) return;

        const html = `
            <button class="menu-toggle" id="menuToggle" aria-label="Open menu">☰</button>
            <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
            <aside class="sidebar" id="safeboxSidebar">
                <div class="sidebar-header">
                    <div class="brand">📦 SafeBox</div>
                    <button class="close-btn" id="sidebarClose" aria-label="Close menu">✕</button>
                </div>
                <div class="sidebar-user">
                    <div class="avatar" id="sidebarAvatar">U</div>
                    <div class="info">
                        <div class="name" id="sidebarUsername">User</div>
                        <div class="meta">SafeBox Account</div>
                    </div>
                </div>
                <nav class="sidebar-nav">
                    <a href="dashboard.html" data-page="dashboard">
                        <span class="icon">🏠</span>
                        <span class="label">Dashboard</span>
                    </a>
                    <a href="files.html" data-page="files">
                        <span class="icon">📁</span>
                        <span class="label">My Files</span>
                    </a>
                    <a href="chat.html" data-page="chat" id="navChat">
                        <span class="icon">💬</span>
                        <span class="label">Chat</span>
                        <span class="nav-badge" id="chatNavBadge" style="display:none;"></span>
                    </a>
                    <a href="backup.html" data-page="backup">
                        <span class="icon">💾</span>
                        <span class="label">Backup</span>
                    </a>
                    <a href="scan.html" data-page="scan">
                        <span class="icon">📷</span>
                        <span class="label">Scan</span>
                    </a>
                    <a href="share.html" data-page="share">
                        <span class="icon">📤</span>
                        <span class="label">Share</span>
                    </a>
                    <a href="games.html" data-page="games">
                        <span class="icon">🎮</span>
                        <span class="label">Games</span>
                    </a>
                    <a href="pdf.html" data-page="pdf">
                        <span class="icon">📄</span>
                        <span class="label">PDF Reader</span>
                    </a>
                    <a href="convert.html" data-page="convert">
                        <span class="icon">🔄</span>
                        <span class="label">Convert</span>
                    </a>
                    <a href="settings.html" data-page="settings">
                        <span class="icon">⚙️</span>
                        <span class="label">Settings</span>
                    </a>
                    <a href="#" class="logout-btn" id="sidebarLogout">
                        <span class="icon">🚪</span>
                        <span class="label">Logout</span>
                    </a>
                </nav>
            </aside>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
    }

    // --------------------------------------------
    // SETUP EVENTS
    // --------------------------------------------
    function setupEvents() {
        const toggle = document.getElementById('menuToggle');
        const sidebar = document.getElementById('safeboxSidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        const closeBtn = document.getElementById('sidebarClose');
        const logoutBtn = document.getElementById('sidebarLogout');

        if (!toggle || !sidebar || !backdrop) return;

        function openSidebar() {
            sidebar.classList.add('active');
            backdrop.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeSidebar() {
            sidebar.classList.remove('active');
            backdrop.classList.remove('active');
            document.body.style.overflow = '';
        }

        toggle.addEventListener('click', openSidebar);
        if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
        backdrop.addEventListener('click', closeSidebar);

        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof window.logoutUser === 'function') {
                    window.logoutUser();
                } else {
                    localStorage.removeItem('user_id');
                    localStorage.removeItem('username');
                    localStorage.removeItem('user_session');
                    sessionStorage.removeItem('user_session');
                    window.location.href = 'login.html';
                }
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('active')) {
                closeSidebar();
            }
        });
    }

    // --------------------------------------------
    // HIGHLIGHT CURRENT PAGE
    // --------------------------------------------
    function highlightCurrentPage() {
        let currentPage = window.location.pathname.split('/').pop().replace('.html', '');
        if (!currentPage || currentPage === 'index') {
            currentPage = 'dashboard';
        }

        document.querySelectorAll('.sidebar-nav a[data-page]').forEach(link => {
            if (link.dataset.page === currentPage) {
                link.classList.add('active');
            }
        });
    }

    // --------------------------------------------
    // POPULATE USER INFO
    // --------------------------------------------
    function populateUserInfo() {
        try {
            const user = typeof window.getCurrentUser === 'function' 
                ? window.getCurrentUser() 
                : null;

            if (user) {
                const nameEl = document.getElementById('sidebarUsername');
                const avatarEl = document.getElementById('sidebarAvatar');
                if (nameEl) nameEl.textContent = user.username;
                if (avatarEl) {
                    avatarEl.textContent = (user.username || 'U').charAt(0).toUpperCase();
                }
            }
        } catch (e) {
            console.warn('Could not populate user info:', e);
        }
    }

    // --------------------------------------------
    // ✅ CHAT UNREAD BADGE
    // Shows a red pill on the Chat nav item when
    // there are unread messages. Refreshes every
    // 15s, and instantly on window 'chatUpdated'.
    // --------------------------------------------
    async function refreshChatBadge() {
        const badge = document.getElementById('chatNavBadge');
        if (!badge) return;

        // Don't show the badge when we're already on the chat page
        const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
        if (currentPage === 'chat') {
            badge.style.display = 'none';
            return;
        }

        if (typeof window.getTotalUnreadCount !== 'function') {
            badge.style.display = 'none';
            return;
        }

        try {
            const count = await window.getTotalUnreadCount();
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : String(count);
                badge.style.display = '';
            } else {
                badge.style.display = 'none';
            }
        } catch (e) {
            badge.style.display = 'none';
        }
    }

    function startChatBadgePolling() {
        // Initial check (slight delay so indexeddb.js has time to load)
        setTimeout(refreshChatBadge, 800);

        // Periodic refresh
        setInterval(refreshChatBadge, 15000);

        // Instant refresh when the local chat store updates
        window.addEventListener('chatUpdated', refreshChatBadge);

        // Also refresh when the tab becomes visible again
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) refreshChatBadge();
        });
    }

    // --------------------------------------------
    // RUN
    // --------------------------------------------
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();