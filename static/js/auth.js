const AUTH_ACCOUNTS_KEY = 'omnithread.demo.accounts.v1';
const AUTH_SESSION_KEY = 'omnithread.demo.session.v1';
const PASSWORD_ITERATIONS = 310000;

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-toggle-password]').forEach(button => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.togglePassword);
            const reveal = input.type === 'password';
            input.type = reveal ? 'text' : 'password';
            button.setAttribute('aria-pressed', String(reveal));
            button.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} password`);
            button.innerHTML = `<i class="fa-regular ${reveal ? 'fa-eye-slash' : 'fa-eye'}"></i><span>${reveal ? 'Hide' : 'Show'}</span>`;
        });
    });

    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegistration);
});

async function handleLogin(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    setAuthFormBusy(button, true);
    try {
        const email = document.getElementById('loginEmail').value.trim().toLowerCase();
        const password = document.getElementById('loginPassword').value;
        const accounts = loadDemoAccounts();
        const account = accounts.find(item => item.email === email);
        if (!account || !await verifyPassword(password, account)) {
            showAuthMessage('loginMessage', 'Email or password is incorrect.', true);
            return;
        }
        sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ userKey: account.userKey, signedInAt: new Date().toISOString() }));
        showAuthMessage('loginMessage', 'Signed in. Opening the discussion…');
        window.location.assign('index.html');
    } catch (error) {
        console.error('Unable to sign in to the local demo account.', error);
        showAuthMessage('loginMessage', 'Sign-in failed in this browser. Check storage permissions and try again.', true);
    } finally {
        setAuthFormBusy(button, false);
    }
}

async function handleRegistration(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    setAuthFormBusy(button, true);
    try {
        const name = document.getElementById('registerName').value.trim();
        const email = document.getElementById('registerEmail').value.trim().toLowerCase();
        const password = document.getElementById('registerPassword').value;
        const confirmation = document.getElementById('registerConfirmPassword').value;
        if (password !== confirmation) {
            showAuthMessage('registerMessage', 'The passwords do not match.', true);
            document.getElementById('registerConfirmPassword').focus();
            return;
        }
        if (password.length < 8) {
            showAuthMessage('registerMessage', 'Use a password with at least 8 characters.', true);
            return;
        }

        const accounts = loadDemoAccounts();
        if (accounts.some(account => account.email === email)) {
            showAuthMessage('registerMessage', 'An account with this email already exists. Try signing in instead.', true);
            return;
        }

        const userKey = createUserKey(name, accounts);
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const account = {
            userKey,
            name,
            email,
            loc: 'Community member',
            avatar: 'static/images/avatar-default.svg',
            salt: bytesToBase64(salt),
            passwordHash: await derivePasswordHash(password, salt),
            createdAt: new Date().toISOString()
        };
        accounts.push(account);
        localStorage.setItem(AUTH_ACCOUNTS_KEY, JSON.stringify(accounts));
        sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ userKey, signedInAt: new Date().toISOString() }));
        showAuthMessage('registerMessage', 'Account created. Opening the discussion…');
        window.location.assign('index.html');
    } catch (error) {
        console.error('Unable to create a local demo account.', error);
        showAuthMessage('registerMessage', 'Registration failed in this browser. Check storage permissions and try again.', true);
    } finally {
        setAuthFormBusy(button, false);
    }
}

function loadDemoAccounts() {
    const saved = localStorage.getItem(AUTH_ACCOUNTS_KEY);
    if (!saved) return [];
    const accounts = JSON.parse(saved);
    if (!Array.isArray(accounts)) throw new Error('Saved demo accounts have an invalid format.');
    return accounts;
}

function createUserKey(name, accounts) {
    const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'member';
    const prefix = `member_${slug}`;
    let userKey = prefix;
    let suffix = 2;
    while (accounts.some(account => account.userKey === userKey)) userKey = `${prefix}_${suffix++}`;
    return userKey;
}

async function verifyPassword(password, account) {
    const salt = base64ToBytes(account.salt);
    const passwordHash = await derivePasswordHash(password, salt);
    return constantTimeEqual(passwordHash, account.passwordHash);
}

async function derivePasswordHash(password, salt) {
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable in this browser context.');
    const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256);
    return bytesToBase64(new Uint8Array(bits));
}

function constantTimeEqual(first, second) {
    if (typeof second !== 'string' || first.length !== second.length) return false;
    let difference = 0;
    for (let index = 0; index < first.length; index++) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
    return difference === 0;
}

function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
}

function base64ToBytes(value) {
    return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function setAuthFormBusy(button, busy) {
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
}

function showAuthMessage(elementId, message, isError = false) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.classList.toggle('auth-message-error', isError);
}
