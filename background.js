importScripts('shared.js', 'translations.js', 'i18n.js', 'updates.js');

const F = globalThis.YTFC, U = globalThis.YTFCUpdates, I = globalThis.YTFCI18n;
const API = `https://api.github.com/repos/${U.REPO}`;
let inFlight = null;

async function ensureAlarm() {
    if (!await chrome.alarms.get('checkUpdate')) await chrome.alarms.create('checkUpdate', { periodInMinutes: 360 });
}
async function renderBadge(state, settings) {
    const items = U.available(U.transition(state, {}, chrome.runtime.getManifest().version, settings.trackCommits), settings.trackCommits);
    const t = key => I.translate(key, [], settings.language);
    await chrome.action.setBadgeText({ text: items.length ? t('badgeNew') : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#e74759' });
    await chrome.action.setTitle({ title: items.length ? `${t('appTitle')} — ${t('updateMsg')}` : t('appTitle') });
}
async function fetchJSON(url, optional = false) {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github+json' } });
    if (optional && response.status === 404) return null;
    if (!response.ok) {
        const error = new Error(`GitHub HTTP ${response.status}`);
        if (response.status === 403 || response.status === 429) {
            const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
            const retry = Number(response.headers.get('retry-after')) * 1000 + Date.now();
            error.retryAt = Math.max(Date.now() + 15 * 60000, Number.isFinite(reset) ? reset : 0, Number.isFinite(retry) ? retry : 0);
        }
        throw error;
    }
    return response.json();
}
async function performCheck() {
    const stored = await chrome.storage.local.get({ ...F.DEFAULTS, updateState: {} });
    const settings = F.normalizeSettings(stored);
    const previous = stored.updateState;
    if (previous.retryAt > Date.now()) return previous;
    const snapshot = {}, failures = [], errorDetails = [];
    let retryAt = 0;
    const capture = error => { failures.push(error.message || String(error)); errorDetails.push(I.describeError(error)); retryAt = Math.max(retryAt, error.retryAt || 0); };
    await Promise.all([
        (async () => {
            try {
                const release = await fetchJSON(`${API}/releases/latest`, true);
                if (release !== null && (!release.id || typeof release.tag_name !== 'string' || release.draft || release.prerelease)) throw new Error('Invalid GitHub release');
                snapshot.release = release;
            } catch (error) { capture(error); }
        })(),
        (async () => {
            try {
                const repo = await fetchJSON(API);
                if (typeof repo.default_branch !== 'string') throw new Error('Invalid GitHub branch');
                const commit = await fetchJSON(`${API}/commits/${encodeURIComponent(repo.default_branch)}`);
                if (!/^[a-f0-9]{40}$/i.test(commit?.sha || '')) throw new Error('Invalid GitHub commit');
                snapshot.commit = commit;
                try {
                    const manifest = await fetchJSON(`https://raw.githubusercontent.com/${U.REPO}/${commit.sha}/manifest.json`);
                    if (!F.parseVersion(manifest.version)) throw new Error('Invalid remote manifest version');
                    snapshot.version = manifest.version;
                } catch (error) { capture(error); }
            } catch (error) { capture(error); }
        })()
    ]);
    // Re-read acknowledgements and toggles: the popup may have changed them during fetch.
    const latest = await chrome.storage.local.get({ updateState: {}, ...F.DEFAULTS });
    const latestSettings = F.normalizeSettings(latest);
    const state = U.transition(latest.updateState, snapshot, chrome.runtime.getManifest().version, latestSettings.trackCommits);
    state.lastAttempt = Date.now();
    if (!failures.length) state.lastSuccess = state.lastAttempt;
    state.error = failures.join('; ');
    state.errorDetails = errorDetails;
    state.retryAt = retryAt;
    const unseen = U.available(state, latestSettings.trackCommits).filter(item => !state.notifiedIds?.includes(item.id));
    // Persist before delivery; a failed notification is retried, but known updates stay visible.
    await chrome.storage.local.set({ updateState: state });
    await renderBadge(state, latestSettings);
    if (latestSettings.updateNotifications && unseen.length) {
        try {
            const version = unseen.find(item => item.version);
            const t = key => I.translate(key, [], latestSettings.language);
            await chrome.notifications.create('ytfc-update', {
                type: 'basic', iconUrl: 'icons/icon128.png', title: t('appTitle'),
                message: version ? `${t('newVersion')}: ${version.version}` : `${t('newCommit')}: ${unseen[0].sha.slice(0, 7)}`
            });
            // Merge again so acknowledging while the notification is delivered is not undone.
            const current = (await chrome.storage.local.get({ updateState: state })).updateState;
            current.notifiedIds = [...new Set([...(current.notifiedIds || []), ...unseen.map(item => item.id)])].slice(-30);
            await chrome.storage.local.set({ updateState: current });
            return current;
        } catch (error) { console.warn('Update notification failed:', error); }
    }
    return state;
}
function checkForUpdates() {
    if (!inFlight) inFlight = performCheck().finally(() => { inFlight = null; });
    return inFlight;
}
async function initialize() {
    await ensureAlarm();
    const data = await chrome.storage.local.get({ ...F.DEFAULTS, updateState: {} });
    await renderBadge(data.updateState, F.normalizeSettings(data));
}
chrome.runtime.onInstalled.addListener(() => { initialize().then(checkForUpdates).catch(console.error); });
chrome.runtime.onStartup.addListener(() => { initialize().then(checkForUpdates).catch(console.error); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'checkUpdate') checkForUpdates().catch(console.error); });
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.updateState || changes.trackCommits || changes.language)) initialize().catch(console.error);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || (sender.tab && sender.url !== chrome.runtime.getURL('popup.html'))) return;
    if (message?.type === 'checkUpdates') {
        checkForUpdates().then(state => respond({ state })).catch(error => respond({ error: error.message }));
        return true;
    }
    if (message?.type === 'dismissUpdates') {
        (async () => {
            const data = await chrome.storage.local.get({ updateState: {}, ...F.DEFAULTS });
            const state = data.updateState;
            state.dismissedVersion = (state.release || state.version)?.id;
            state.dismissedCommit = state.commit?.id;
            await chrome.storage.local.set({ updateState: state });
            await chrome.notifications.clear('ytfc-update');
            await renderBadge(state, F.normalizeSettings(data));
            respond({ state });
        })().catch(error => respond({ error: error.message }));
        return true;
    }
});
chrome.notifications.onClicked.addListener(id => {
    if (id !== 'ytfc-update') return;
    chrome.storage.local.get({ updateState: {}, trackCommits: true }, data => {
        const item = U.available(data.updateState, data.trackCommits)[0];
        if (item) chrome.tabs.create({ url: item.url });
        chrome.notifications.clear(id);
    });
});
initialize().catch(console.error);
