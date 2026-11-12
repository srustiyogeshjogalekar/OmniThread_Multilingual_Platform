const USERS = {
    alex_m: { name: 'Alex Morgan', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100', loc: 'San Francisco, US', is_admin: true },
    yuki_t: { name: 'Yuki Tanaka', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100', loc: 'Tokyo, JP', is_admin: false },
    priya_s: { name: 'Priya Sharma', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100', loc: 'Bengaluru, IN', is_admin: false },
    elena_r: { name: 'Elena Rostova', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100', loc: 'Moscow, RU', is_admin: false },
    spammer_99: { name: 'Bot Account 99', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100', loc: 'Unknown IP', is_admin: false }
};

const TRANSLATION_DB = {
    es: {
        'Hello everyone! Excited to share this real-time system architecture.': '¡Hola a todos! Emocionado de compartir esta arquitectura de sistema en tiempo real.',
        'このシステムは日本語とリアルタイム翻訳をサポートしています。素晴らしいですね！': 'Este sistema admite japonés y traducción en tiempo real. ¡Es fantástico!'
    },
    en: {
        'このシステムは日本語とリアルタイム翻訳をサポートしています。素晴らしいですね！': 'This system supports Japanese and real-time translation. Fantastic!',
        'इस प्लेटफ़ॉर्म में ऑटो-मॉडरेशन और स्पैम फ़िल्टर बहुत प्रभावी हैं。': 'The auto-moderation and spam filters on this platform are very effective.'
    },
    ja: {
        'Hello everyone! Excited to share this real-time system architecture.': '皆さんこんにちは！このリアルタイムシステムアーキテクチャを共有できることを嬉しく思います。'
    }
};

const BLOCKED_WORDS = ['scam', 'cheap-crypto', 'hack_account', 'abusive_word_x', 'idiot'];
const STORAGE_KEY = 'omnithread.demo.v1';
const REPORT_REASONS = ['Spam / Commercial Ads', 'Harassment or Bullying', 'Offensive Content', 'Malicious Link / Virus'];
const DEFAULT_STATE = {
    currentUserKey: 'alex_m',
    preferredLang: 'en',
    editLimitMinutes: 5,
    rateLimitMax: 3,
    userPostingTimestamps: {},
    requireCaptcha: false,
    captchaAnswer: 0,
    filteredCount: 0,
    comments: [
        { id: 'c1', parent_id: null, user_key: 'alex_m', text: 'Hello everyone! Excited to share this real-time system architecture.', timestamp: new Date(Date.now() - 7200000).toISOString(), lang: 'en', likes: ['yuki_t', 'priya_s'], dislikes: [], version: 1, history: [], is_deleted: false, translated_cache: {} },
        { id: 'c2', parent_id: 'c1', user_key: 'yuki_t', text: 'このシステムは日本語とリアルタイム翻訳をサポートしています。素晴らしいですね！', timestamp: new Date(Date.now() - 3600000).toISOString(), lang: 'ja', likes: ['alex_m'], dislikes: [], version: 1, history: [], is_deleted: false, translated_cache: {} }
    ],
    reports: [],
    moderationRecords: []
};

let state = loadState();
let databaseConnected = false;
let databaseWriteQueue = Promise.resolve();
const pendingTranslations = new Set();

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    loadRegisteredDemoUsers();
    const session = getDemoSession();
    if (session && USERS[session.userKey]) state.currentUserKey = session.userKey;
    renderAuthNavigation(Boolean(session && USERS[session.userKey]));
    configureProfileSelector(Boolean(session && USERS[session.userKey]));

    try {
        const response = await fetch('/api/state', { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Database request failed (${response.status}).`);
        const payload = await response.json();
        databaseConnected = true;
        if (payload.state) {
            state = { ...structuredClone(DEFAULT_STATE), ...payload.state };
        } else {
            persistState();
        }
        if (session && USERS[session.userKey]) state.currentUserKey = session.userKey;
        setDatabaseStatus(true);
    } catch (error) {
        console.error('Unable to connect to the SQLite database.', error);
        setDatabaseStatus(false);
    }

    if (!USERS[state.currentUserKey]) state.currentUserKey = 'alex_m';
    document.getElementById('currentUserSelect').value = state.currentUserKey;
    document.getElementById('cfgEditLimit').value = state.editLimitMinutes;
    document.getElementById('cfgRateLimit').value = state.rateLimitMax;
    document.getElementById('userPreferredLang').value = state.preferredLang;
    switchUser(state.currentUserKey);
    renderComments();
    updateStats();
    if (state.requireCaptcha) triggerCaptcha();
}

window.addEventListener('storage', event => {
    if (event.key === 'omnithread.demo.accounts.v1') {
        loadRegisteredDemoUsers();
        return;
    }
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
        state = { ...structuredClone(DEFAULT_STATE), ...JSON.parse(event.newValue) };
        const session = getDemoSession();
        if (session && USERS[session.userKey]) state.currentUserKey = session.userKey;
        document.getElementById('currentUserSelect').value = state.currentUserKey;
        document.getElementById('userPreferredLang').value = state.preferredLang;
        renderCurrentUser();
        renderComments();
        updateStats();
    } catch (error) {
        console.error('Unable to synchronize OmniThread demo data from another tab.', error);
        showToast('Updates from another tab could not be loaded.', 'error');
    }
});

function loadRegisteredDemoUsers() {
    try {
        const accounts = JSON.parse(localStorage.getItem('omnithread.demo.accounts.v1') || '[]');
        if (!Array.isArray(accounts)) throw new Error('Registered demo accounts have an invalid format.');
        accounts.forEach(account => {
            if (!account || typeof account.userKey !== 'string' || typeof account.name !== 'string') return;
            USERS[account.userKey] = {
                name: account.name,
                avatar: account.avatar || 'static/images/avatar-default.svg',
                loc: account.loc || 'Community member',
                is_admin: false
            };
            const select = document.getElementById('currentUserSelect');
            if (select && !Array.from(select.options).some(option => option.value === account.userKey)) {
                const option = document.createElement('option');
                option.value = account.userKey;
                option.textContent = `${account.name} (Member)`;
                select.appendChild(option);
            }
        });
    } catch (error) {
        console.error('Unable to load registered demo profiles.', error);
        showToast('Registered profiles could not be loaded from this browser.', 'error');
    }
}

function getDemoSession() {
    try {
        const session = JSON.parse(sessionStorage.getItem('omnithread.demo.session.v1') || 'null');
        return session && typeof session.userKey === 'string' ? session : null;
    } catch (error) {
        console.error('Unable to read the local demo sign-in session.', error);
        return null;
    }
}

function renderAuthNavigation(isSignedIn) {
    const navigation = document.querySelector('.auth-nav');
    if (!navigation) return;
    navigation.innerHTML = isSignedIn
        ? '<button class="auth-nav-link" type="button" onclick="signOutDemo()">Sign out</button>'
        : '<a href="login.html">Sign in</a><a class="btn btn-primary btn-small" href="register.html">Create account</a>';
}

function configureProfileSelector(isSignedIn) {
    const selector = document.getElementById('currentUserSelect');
    const label = selector.closest('.user-selector').querySelector('label');
    selector.disabled = isSignedIn;
    label.innerHTML = isSignedIn
        ? '<i class="fa-solid fa-user"></i> Signed in as:'
        : '<i class="fa-solid fa-user-gear"></i> Active Persona:';
}

function signOutDemo() {
    sessionStorage.removeItem('omnithread.demo.session.v1');
    state.currentUserKey = 'alex_m';
    document.getElementById('currentUserSelect').value = state.currentUserKey;
    configureProfileSelector(false);
    renderAuthNavigation(false);
    switchUser(state.currentUserKey);
}

function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return structuredClone(DEFAULT_STATE);
        const parsed = JSON.parse(saved);
        return { ...structuredClone(DEFAULT_STATE), ...parsed };
    } catch (error) {
        console.error('Unable to load saved OmniThread demo data.', error);
        showToast('Saved data could not be loaded. Starting with the sample discussion.', 'error');
        return structuredClone(DEFAULT_STATE);
    }
}

function persistState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error('Unable to save OmniThread demo data.', error);
        showToast('Your change could not be saved in this browser.', 'error');
    }
    if (!databaseConnected) return;
    const snapshot = structuredClone(state);
    databaseWriteQueue = databaseWriteQueue.then(async () => {
        const response = await fetch('/api/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot)
        });
        if (!response.ok) {
            const result = await response.json();
            throw new Error(result.error || `Database save failed (${response.status}).`);
        }
        setDatabaseStatus(true);
    }).catch(error => {
        databaseConnected = false;
        setDatabaseStatus(false);
        console.error('Unable to save data to SQLite.', error);
        showToast('Database save failed. Changes remain only in this browser.', 'error');
    });
}

function setDatabaseStatus(connected) {
    const status = document.getElementById('dbStatus');
    if (!status) return;
    status.textContent = connected
        ? 'SQLite database connected'
        : 'Database offline; browser-only fallback active';
    status.classList.toggle('text-danger', !connected);
}

function switchUser(userKey) {
    if (!USERS[userKey]) return;
    const session = getDemoSession();
    if (session && session.userKey !== userKey) {
        document.getElementById('currentUserSelect').value = session.userKey;
        return;
    }
    state.currentUserKey = userKey;
    renderCurrentUser();
    persistState();
    renderComments();
    updateStats();
}

function renderCurrentUser() {
    const user = USERS[state.currentUserKey];
    if (!user) return;
    document.getElementById('currentUserAvatar').src = user.avatar;
    document.getElementById('currentUserName').innerText = `${user.name}${user.is_admin ? ' (Admin)' : ''}`;
    document.getElementById('currentUserLoc').innerHTML = `<i class="fa-solid fa-location-dot"></i> ${escapeHtml(user.loc)}`;
}

function updateConfig() {
    state.editLimitMinutes = Math.max(1, Math.min(60, Number.parseInt(document.getElementById('cfgEditLimit').value, 10) || 5));
    state.rateLimitMax = Math.max(1, Math.min(10, Number.parseInt(document.getElementById('cfgRateLimit').value, 10) || 3));
    document.getElementById('cfgEditLimit').value = state.editLimitMinutes;
    document.getElementById('cfgRateLimit').value = state.rateLimitMax;
    persistState();
}

function updatePreferredLang(lang) {
    state.preferredLang = lang;
    persistState();
    renderComments();
}

function detectLanguage(text) {
    if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(text)) return 'ja';
    if (/[\u0900-\u097f]/u.test(text)) return 'hi';
    if (/[\u0400-\u04ff]/u.test(text)) return 'ru';
    if (/[áéíóúñ¿¡]/iu.test(text)) return 'es';
    return 'en';
}

function normalizeComment(text) {
    return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

function evaluateModeration(text, userKey, excludedCommentId = null, checkRateLimit = true) {
    const now = Date.now();
    const timestamps = (state.userPostingTimestamps[userKey] || []).filter(time => now - time < 60000);
    state.userPostingTimestamps[userKey] = timestamps;
    if (checkRateLimit && timestamps.length >= state.rateLimitMax) {
        state.requireCaptcha = true;
        triggerCaptcha();
        return { ok: false, reason: 'Posting limit reached. Complete the CAPTCHA before posting again.' };
    }
    if (!text.trim()) return { ok: false, reason: 'A comment cannot be empty.' };
    if (Array.from(text).length > 1000) return { ok: false, reason: 'Comments must be 1,000 characters or fewer.' };

    const normalized = normalizeComment(text);
    const duplicate = state.comments.some(comment =>
        comment.id !== excludedCommentId &&
        !comment.is_deleted &&
        comment.user_key === userKey &&
        normalizeComment(comment.text) === normalized
    );
    if (duplicate) return { ok: false, reason: 'Duplicate comment blocked.' };

    const foldedText = text.normalize('NFKC').toLocaleLowerCase();
    const blockedWord = BLOCKED_WORDS.find(word => new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(word)}([^\\p{L}\\p{N}_]|$)`, 'iu').test(foldedText));
    if (blockedWord) return { ok: false, reason: 'Comment blocked by the profanity filter.' };
    if (/(.)\1{5,}/u.test(text) || /([\p{Extended_Pictographic}\p{P}\p{S}])\1{4,}/u.test(text)) {
        return { ok: false, reason: 'Repeated characters, punctuation, or emoji are not allowed.' };
    }
    const meaningfulChars = Array.from(text).filter(char => /[\p{L}\p{N}\s]/u.test(char)).length;
    if (Array.from(text).length >= 8 && meaningfulChars / Array.from(text).length < 0.35) {
        return { ok: false, reason: 'Comment blocked: too many repeated special characters.' };
    }
    if (/(?:https?:|ftp:|javascript:|data:|mailto:|www\.)/iu.test(text) ||
        /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?/iu.test(text) ||
        /\b(?:\d{1,3}\.){3}\d{1,3}\b/u.test(text)) {
        return { ok: false, reason: 'Links are blocked until they can be reviewed for safety.' };
    }
    return { ok: true };
}

function recordModeration(action, details) {
    state.moderationRecords.unshift({ id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, action, details, actor: state.currentUserKey, timestamp: new Date().toISOString() });
}

function triggerCaptcha() {
    const box = document.getElementById('captchaBox');
    box.classList.remove('hidden');
    const n1 = Math.floor(Math.random() * 10) + 1;
    const n2 = Math.floor(Math.random() * 10) + 1;
    state.captchaAnswer = n1 + n2;
    document.getElementById('captchaQuestion').innerText = `Security Check: ${n1} + ${n2} = ?`;
}

function verifyCaptcha() {
    const answer = Number.parseInt(document.getElementById('captchaAnswer').value, 10);
    if (answer !== state.captchaAnswer) {
        showToast('That answer is not correct. Please try again.', 'error');
        triggerCaptcha();
        return;
    }
    state.requireCaptcha = false;
    state.userPostingTimestamps[state.currentUserKey] = [];
    document.getElementById('captchaAnswer').value = '';
    document.getElementById('captchaBox').classList.add('hidden');
    persistState();
    showToast('CAPTCHA verified. You can post again.');
}

function checkInputTriggers(event) {
    const input = event.target;
    const wrapper = input.closest('.textarea-wrapper');
    const dropdown = wrapper && wrapper.querySelector('.mention-dropdown');
    if (!dropdown) return;
    const match = input.value.match(/(?:^|\s)@([\w]*)$/u);
    if (!match) {
        dropdown.classList.add('hidden');
        return;
    }
    const query = match[1].toLowerCase();
    const matches = Object.keys(USERS).filter(key => key.includes(query));
    dropdown.innerHTML = matches.map(key =>
        `<button type="button" class="mention-item" onclick="insertMention('${escapeHtml(key)}', '${escapeHtml(input.id)}')"><img src="${USERS[key].avatar}" alt=""> @${escapeHtml(key)} (${escapeHtml(USERS[key].name)})</button>`
    ).join('');
    dropdown.classList.toggle('hidden', matches.length === 0);
}

function insertMention(username, inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = input.value.replace(/(?:^|\s)@[\w]*$/u, match => `${match.startsWith(' ') ? ' ' : ''}@${username} `);
    input.closest('.textarea-wrapper').querySelector('.mention-dropdown').classList.add('hidden');
    input.focus();
}

function submitComment(event, parentId = null) {
    if (event) event.preventDefault();
    if (state.requireCaptcha) {
        showToast('Complete the CAPTCHA before posting.', 'warning');
        return;
    }
    const input = document.getElementById(parentId ? `replyInput_${parentId}` : 'mainCommentInput');
    if (!input) return;
    const text = input.value.trim();
    const result = evaluateModeration(text, state.currentUserKey);
    if (!result.ok) {
        state.filteredCount++;
        recordModeration('blocked', result.reason);
        persistState();
        updateStats();
        showToast(result.reason, 'error');
        return;
    }
    if (parentId && !state.comments.some(comment => comment.id === parentId)) {
        showToast('The parent comment no longer exists. Refresh and try again.', 'error');
        return;
    }
    const comment = {
        id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        parent_id: parentId,
        user_key: state.currentUserKey,
        text,
        timestamp: new Date().toISOString(),
        lang: detectLanguage(text),
        likes: [],
        dislikes: [],
        version: 1,
        history: [],
        is_deleted: false,
        translated_cache: {}
    };
    state.comments.push(comment);
    state.userPostingTimestamps[state.currentUserKey].push(Date.now());
    recordModeration('posted', `Comment ${comment.id}`);
    input.value = '';
    persistState();
    renderComments();
    updateStats();
    showToast('Comment posted.');
}

async function translateComment(commentId) {
    const comment = state.comments.find(item => item.id === commentId);
    if (!comment || comment.is_deleted) return;
    if (comment.lang === state.preferredLang) {
        showToast('This comment is already in your selected language.');
        return;
    }
    const targetLanguage = state.preferredLang;
    const translationKey = `${comment.id}:${targetLanguage}`;
    if (pendingTranslations.has(translationKey)) return;
    const sampleTranslation = TRANSLATION_DB[targetLanguage]?.[comment.text];
    if (sampleTranslation) {
        comment.translated_cache[targetLanguage] = sampleTranslation;
        persistState();
        renderComments();
        return;
    }
    const originalText = comment.text;
    const originalVersion = comment.version;
    pendingTranslations.add(translationKey);
    renderComments();
    try {
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: originalText, source: 'auto', target: targetLanguage })
        });
        let payload;
        try {
            payload = await response.json();
        } catch (error) {
            throw new Error('The translation service returned an invalid response.');
        }
        if (!response.ok) {
            throw new Error(payload.error || `Translation failed (${response.status}).`);
        }
        if (typeof payload.translatedText !== 'string' || !payload.translatedText.trim()) {
            throw new Error('The translation service did not return translated text.');
        }
        const currentComment = state.comments.find(item => item.id === commentId);
        if (!currentComment || currentComment.is_deleted || currentComment.version !== originalVersion || currentComment.text !== originalText) {
            showToast('This comment changed during translation. Try again.', 'warning');
            return;
        }
        currentComment.translated_cache[targetLanguage] = payload.translatedText;
        persistState();
    } catch (error) {
        console.error('Unable to translate comment.', error);
        showToast(`Translation failed: ${error.message}`, 'error');
    } finally {
        pendingTranslations.delete(translationKey);
        renderComments();
    }
}

function toggleOriginalText(commentId) {
    const comment = state.comments.find(item => item.id === commentId);
    if (comment) {
        delete comment.translated_cache[state.preferredLang];
        persistState();
        renderComments();
    }
}

function handleReaction(commentId, type) {
    const comment = state.comments.find(item => item.id === commentId);
    if (!comment || comment.is_deleted) return;
    const user = state.currentUserKey;
    const ownList = type === 'like' ? comment.likes : comment.dislikes;
    const otherList = type === 'like' ? comment.dislikes : comment.likes;
    const index = ownList.indexOf(user);
    if (index >= 0) ownList.splice(index, 1);
    else {
        ownList.push(user);
        const otherIndex = otherList.indexOf(user);
        if (otherIndex >= 0) otherList.splice(otherIndex, 1);
    }
    persistState();
    renderComments();
}

function openEditModal(commentId) {
    const comment = state.comments.find(item => item.id === commentId);
    if (!comment || comment.user_key !== state.currentUserKey || comment.is_deleted) return;
    if (!isEditable(comment)) {
        showToast('The edit window for this comment has expired.', 'warning');
        return;
    }
    document.getElementById('editCommentId').value = comment.id;
    document.getElementById('editOriginalVersion').value = comment.version;
    document.getElementById('editCommentInput').value = comment.text;
    document.getElementById('editModal').classList.remove('hidden');
}

function isEditable(comment) {
    return Date.now() - new Date(comment.timestamp).getTime() <= state.editLimitMinutes * 60000;
}

function saveEditedComment() {
    const commentId = document.getElementById('editCommentId').value;
    const expectedVersion = Number.parseInt(document.getElementById('editOriginalVersion').value, 10);
    const text = document.getElementById('editCommentInput').value.trim();
    const comment = state.comments.find(item => item.id === commentId);
    if (!comment || comment.user_key !== state.currentUserKey || comment.is_deleted) {
        showToast('This comment can no longer be edited.', 'error');
        closeModal('editModal');
        return;
    }
    if (comment.version !== expectedVersion) {
        showToast('Edit conflict: this comment changed. Reopen the editor to review the latest version.', 'warning');
        closeModal('editModal');
        return;
    }
    if (!isEditable(comment)) {
        showToast('The edit window for this comment has expired.', 'warning');
        closeModal('editModal');
        return;
    }
    if (!text || text === comment.text) {
        showToast(text ? 'No changes to save.' : 'A comment cannot be empty.', text ? 'warning' : 'error');
        return;
    }
    const result = evaluateModeration(text, state.currentUserKey, comment.id, false);
    if (!result.ok) {
        state.filteredCount++;
        recordModeration('blocked', result.reason);
        persistState();
        updateStats();
        showToast(result.reason, 'error');
        return;
    }
    comment.history.push({ version: comment.version, text: comment.text, edited_at: new Date().toISOString() });
    comment.text = text;
    comment.lang = detectLanguage(text);
    comment.version++;
    comment.translated_cache = {};
    recordModeration('edited', `Comment ${comment.id} updated to version ${comment.version}`);
    persistState();
    closeModal('editModal');
    renderComments();
    updateStats();
    showToast('Revision saved.');
}

function deleteComment(commentId) {
    const comment = state.comments.find(item => item.id === commentId);
    if (!comment || comment.user_key !== state.currentUserKey || comment.is_deleted) return;
    if (!isEditable(comment)) {
        showToast('The edit and delete window for this comment has expired.', 'warning');
        return;
    }
    if (!window.confirm('Delete this comment? Its replies and history will be preserved.')) return;
    softDeleteComment(comment, 'author_deleted');
    renderComments();
    updateStats();
}

function softDeleteComment(comment, reason) {
    comment.is_deleted = true;
    comment.deleted_at = new Date().toISOString();
    comment.delete_reason = reason;
    comment.history.push({ version: comment.version, text: comment.text, edited_at: comment.deleted_at, action: 'deleted' });
    comment.text = '[This comment has been deleted]';
    comment.translated_cache = {};
    recordModeration('deleted', `Comment ${comment.id}: ${reason}`);
    persistState();
}

function openReportModal(commentId) {
    const comment = state.comments.find(item => item.id === commentId);
    if (!comment || comment.is_deleted || comment.user_key === state.currentUserKey) return;
    if (state.reports.some(report => report.comment_id === commentId && report.reported_by === state.currentUserKey)) {
        showToast('You have already reported this comment.', 'warning');
        return;
    }
    document.getElementById('reportCommentId').value = commentId;
    document.getElementById('reportModal').classList.remove('hidden');
}

function submitReport() {
    const commentId = document.getElementById('reportCommentId').value;
    const reasonInput = document.querySelector('input[name="reportReason"]:checked');
    const comment = state.comments.find(item => item.id === commentId);
    if (!comment || comment.is_deleted || !reasonInput || !REPORT_REASONS.includes(reasonInput.value)) {
        showToast('This report could not be submitted. The comment may no longer be available.', 'error');
        closeModal('reportModal');
        return;
    }
    if (state.reports.some(report => report.comment_id === commentId && report.reported_by === state.currentUserKey)) {
        showToast('You have already reported this comment.', 'warning');
        closeModal('reportModal');
        return;
    }
    const report = {
        id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        comment_id: commentId,
        comment_text: comment.text,
        reported_by: state.currentUserKey,
        reason: reasonInput.value,
        status: 'pending',
        timestamp: new Date().toISOString()
    };
    state.reports.unshift(report);
    recordModeration('reported', `Comment ${commentId} reported for ${report.reason}`);
    persistState();
    closeModal('reportModal');
    updateStats();
    showToast('Report sent to the administrator review queue.');
}

function resolveReport(reportId, decision) {
    const report = state.reports.find(item => item.id === reportId);
    if (!report || !USERS[state.currentUserKey].is_admin || !['removed', 'dismissed'].includes(decision)) return;
    report.status = decision;
    report.reviewed_by = state.currentUserKey;
    report.reviewed_at = new Date().toISOString();
    if (decision === 'removed') {
        const comment = state.comments.find(item => item.id === report.comment_id);
        if (comment && !comment.is_deleted) softDeleteComment(comment, 'admin_moderated');
        state.reports.filter(item => item.comment_id === report.comment_id && item.status === 'pending').forEach(item => {
            item.status = 'removed';
            item.reviewed_by = state.currentUserKey;
            item.reviewed_at = report.reviewed_at;
        });
    }
    recordModeration('report_resolved', `Report ${report.id}: ${decision}`);
    persistState();
    updateStats();
    renderComments();
    showToast(decision === 'removed' ? 'Comment removed; report recorded.' : 'Report dismissed and recorded.');
}

function openHistoryModal(commentId) {
    const comment = state.comments.find(item => item.id === commentId);
    if (!comment || !comment.history.length) return;
    const body = document.getElementById('historyModalBody');
    body.innerHTML = comment.history.map(entry => `
        <div class="history-entry">
            <div class="history-meta">v${entry.version} — ${new Date(entry.edited_at).toLocaleString()}${entry.action ? ` · ${escapeHtml(entry.action)}` : ''}</div>
            <div>${escapeHtml(entry.text)}</div>
        </div>
    `).join('') + `<div class="history-current"><strong>Current:</strong> ${escapeHtml(comment.text)}</div>`;
    document.getElementById('historyModal').classList.remove('hidden');
}

function getSortedComments(list) {
    const sortValue = document.getElementById('sortSelect').value;
    const sorted = [...list];
    if (sortValue === 'newest') sorted.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    else if (sortValue === 'oldest') sorted.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    else if (sortValue === 'most_liked') sorted.sort((a, b) => (b.likes.length - b.dislikes.length) - (a.likes.length - a.dislikes.length));
    else if (sortValue === 'most_relevant') sorted.sort((a, b) =>
        ((b.likes.length * 2) - b.dislikes.length + (b.parent_id ? 0 : 1)) -
        ((a.likes.length * 2) - a.dislikes.length + (a.parent_id ? 0 : 1)) ||
        (new Date(b.timestamp) - new Date(a.timestamp))
    );
    return sorted;
}

function renderComments() {
    const container = document.getElementById('commentsContainer');
    if (!container) return;
    const roots = getSortedComments(state.comments.filter(comment => comment.parent_id === null));
    document.getElementById('totalCommentCount').innerText = state.comments.filter(comment => !comment.is_deleted).length;
    container.innerHTML = roots.map(comment => renderCommentCard(comment)).join('');
}

function renderCommentCard(comment) {
    const author = USERS[comment.user_key] || { name: 'Unknown user', avatar: '', loc: 'Global' };
    const isOwner = comment.user_key === state.currentUserKey;
    const isLiked = comment.likes.includes(state.currentUserKey);
    const isDisliked = comment.dislikes.includes(state.currentUserKey);
    const translatedText = comment.translated_cache[state.preferredLang];
    const translationKey = `${comment.id}:${state.preferredLang}`;
    const isTranslating = pendingTranslations.has(translationKey);
    const replies = getSortedComments(state.comments.filter(reply => reply.parent_id === comment.id));
    const formattedText = escapeHtml(comment.text).replace(/@([\w]+)/gu, '<span class="mention-link">@$1</span>');
    const timestamp = new Date(comment.timestamp);
    const commentDate = Number.isNaN(timestamp.getTime()) ? '' : timestamp.toLocaleString();
    return `
        <article class="comment-card glass-card" id="comment_${escapeHtml(comment.id)}">
            <div class="comment-header">
                <div class="comment-author-meta">
                    <img src="${escapeHtml(author.avatar)}" class="avatar" alt="${escapeHtml(author.name)}">
                    <div class="author-details">
                        <div class="author-name-row">
                            <span class="author-name">${escapeHtml(author.name)}</span>
                            <span class="author-handle">@${escapeHtml(comment.user_key)}</span>
                            <span class="loc-tag">${escapeHtml(author.loc)}</span>
                            <span class="lang-tag">${escapeHtml(comment.lang.toUpperCase())}</span>
                        </div>
                        <time class="comment-timestamp" datetime="${escapeHtml(comment.timestamp)}">${escapeHtml(commentDate)}</time>
                    </div>
                </div>
                ${comment.version > 1 || comment.history.length ? `<button class="edited-tag" onclick="openHistoryModal('${escapeHtml(comment.id)}')">${comment.version > 1 ? '(Edited · history)' : '(History)'}</button>` : ''}
            </div>
            <div class="comment-body ${comment.is_deleted ? 'text-muted' : ''}">${formattedText}</div>
            ${translatedText ? `
                <div class="translation-box">
                    <div class="translation-meta">
                        <span>Translated to ${escapeHtml(state.preferredLang.toUpperCase())}</span>
                        <button class="text-link" onclick="toggleOriginalText('${escapeHtml(comment.id)}')">Show original</button>
                    </div>
                    <div>${escapeHtml(translatedText)}</div>
                </div>
            ` : ''}
            <div class="comment-actions">
                ${!comment.is_deleted ? `
                    <button class="action-btn ${isLiked ? 'active-like' : ''}" onclick="handleReaction('${escapeHtml(comment.id)}', 'like')" aria-label="Like comment"><i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-thumbs-up"></i> ${comment.likes.length}</button>
                    <button class="action-btn ${isDisliked ? 'active-dislike' : ''}" onclick="handleReaction('${escapeHtml(comment.id)}', 'dislike')" aria-label="Dislike comment"><i class="${isDisliked ? 'fa-solid' : 'fa-regular'} fa-thumbs-down"></i> ${comment.dislikes.length}</button>
                    <button class="action-btn" onclick="toggleReplyBox('${escapeHtml(comment.id)}')"><i class="fa-regular fa-comment"></i> Reply</button>
                    ${translatedText ? '' : `<button class="action-btn translate-btn" onclick="translateComment('${escapeHtml(comment.id)}')" ${isTranslating ? 'disabled aria-busy="true"' : ''}><i class="fa-solid fa-language"></i> ${isTranslating ? 'Translating…' : 'Translate'}</button>`}
                    ${isOwner && isEditable(comment) ? `<button class="action-btn" onclick="openEditModal('${escapeHtml(comment.id)}')">Edit</button>` : ''}
                    ${isOwner && isEditable(comment) ? `<button class="action-btn text-danger" onclick="deleteComment('${escapeHtml(comment.id)}')">Delete</button>` : ''}
                    ${!isOwner ? `<button class="action-btn text-muted" onclick="openReportModal('${escapeHtml(comment.id)}')">Report</button>` : ''}
                ` : '<span class="deleted-parent-notice">Comment deleted; replies and history are preserved.</span>'}
            </div>
            ${!comment.is_deleted ? `
                <div id="replyBox_${escapeHtml(comment.id)}" class="reply-box hidden">
                    <div class="textarea-wrapper">
                        <textarea id="replyInput_${escapeHtml(comment.id)}" rows="2" maxlength="1000" placeholder="Write a reply... Use @username to mention someone." oninput="checkInputTriggers(event)"></textarea>
                        <div class="mention-dropdown hidden"></div>
                    </div>
                    <button class="btn btn-primary btn-small" onclick="submitComment(event, '${escapeHtml(comment.id)}')">Reply</button>
                </div>
            ` : ''}
            ${replies.length ? `
                <div class="replies-container">
                    ${comment.is_deleted ? '<div class="deleted-parent-notice">Parent comment removed; this thread is preserved.</div>' : ''}
                    ${replies.map(reply => renderCommentCard(reply)).join('')}
                </div>
            ` : ''}
        </article>
    `;
}

function renderAdminQueue() {
    const queue = document.getElementById('adminReportQueue');
    const records = document.getElementById('moderationHistory');
    const currentUser = USERS[state.currentUserKey];
    const isAdmin = Boolean(currentUser && currentUser.is_admin);
    if (!isAdmin) {
        queue.innerHTML = '<p class="empty-state">Administrator access is required to review reports.</p>';
        records.innerHTML = '<p class="empty-state">Administrator access is required to view moderation records.</p>';
        return;
    }
    const pending = state.reports.filter(report => report.status === 'pending');
    queue.innerHTML = pending.length ? pending.map(report => `
        <div class="report-item">
            <div class="report-item-header"><span>${escapeHtml(report.reason)}</span><time>${new Date(report.timestamp).toLocaleString()}</time></div>
            <div>Comment: "${escapeHtml(report.comment_text)}"</div>
            <div>Reported by @${escapeHtml(report.reported_by)}</div>
            <div class="report-actions">
                <button class="btn btn-danger btn-small" onclick="resolveReport('${escapeHtml(report.id)}', 'removed')">Remove</button>
                <button class="btn btn-secondary btn-small" onclick="resolveReport('${escapeHtml(report.id)}', 'dismissed')">Dismiss</button>
            </div>
        </div>
    `).join('') : '<p class="empty-state">No flagged comments pending review.</p>';
    records.innerHTML = state.moderationRecords.slice(0, 10).map(record => `
        <div class="moderation-record"><strong>${escapeHtml(record.action)}</strong> · ${escapeHtml(record.details)}<time>${new Date(record.timestamp).toLocaleString()} · @${escapeHtml(record.actor)}</time></div>
    `).join('') || '<p class="empty-state">No moderation activity recorded yet.</p>';
}

function updateStats() {
    document.getElementById('statFiltered').innerText = state.filteredCount;
    document.getElementById('statFlagged').innerText = state.reports.filter(report => report.status === 'pending').length;
    document.getElementById('reportBadge').innerText = `${state.reports.filter(report => report.status === 'pending').length} Pending`;
    const timestamps = (state.userPostingTimestamps[state.currentUserKey] || []).filter(time => Date.now() - time < 60000);
    const rateLimit = document.getElementById('statRateLimit');
    rateLimit.innerText = `${timestamps.length}/${state.rateLimitMax}`;
    rateLimit.classList.toggle('text-danger', timestamps.length >= state.rateLimitMax);
    renderAdminQueue();
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toggleTheme() {
    document.body.setAttribute('data-theme', document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

function toggleReplyBox(id) {
    const box = document.getElementById(`replyBox_${id}`);
    if (box) box.classList.toggle('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'warning' ? 'toast-warning' : ''}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
}
