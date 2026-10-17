// ============================================
// SESSION CHECK - KEEP USER LOGGED IN (EVEN ON REFRESH)
// ============================================

(function checkSession() {
    console.log('🔍 Checking session...');
    
    // Check both localStorage and sessionStorage
    const user = getCurrentUser();
    const session = getUserSession();
    
    const currentPage = window.location.pathname.split('/').pop();
    const loginPages = ['login.html', 'register.html'];
    const protectedPages = ['dashboard.html', 'files.html', 'backup.html', 'share.html', 'games.html', 'pdf.html', 'convert.html', 'settings.html', 'view.html'];
    
    // If user is logged in and on login/register page, redirect to dashboard
    if ((user || session) && loginPages.includes(currentPage)) {
        console.log('🔄 User already logged in, redirecting to dashboard');
        window.location.href = 'dashboard.html';
        return;
    }
    
    // If user is NOT logged in and on a protected page, redirect to login
    if (!user && !session && protectedPages.includes(currentPage)) {
        console.log('❌ No user session, redirecting to login');
        window.location.href = 'login.html';
        return;
    }
    
    // If user is logged in, update UI with user info
    if (user || session) {
        const username = user?.username || session?.username;
        const userId = user?.id || session?.id;
        console.log('✅ User logged in:', username);
        
        // Update UI elements
        updateUserUI({ id: userId, username: username });
        
        // Restore to localStorage if only in sessionStorage
        if (session && !user) {
            localStorage.setItem('user_id', session.id);
            localStorage.setItem('username', session.username);
        }
    }
    
    console.log('✅ Session check complete');
})();

// ============================================
// UPDATE UI WITH USER INFO
// ============================================
function updateUserUI(user) {
    if (!user) return;
    
    // Update username in header/nav
    const userElements = document.querySelectorAll('.user-name, .username-display, #userName');
    userElements.forEach(el => {
        if (el) el.textContent = user.username;
    });
    
    // Update avatar if exists
    const avatarElements = document.querySelectorAll('.user-avatar');
    avatarElements.forEach(el => {
        if (el) el.textContent = user.username.charAt(0).toUpperCase();
    });
}

// ============================================
// EXPOSE FUNCTIONS
// ============================================
window.updateUserUI = updateUserUI;

console.log('✅ Session check loaded!');
console.log('💡 User will stay logged in even after refresh');