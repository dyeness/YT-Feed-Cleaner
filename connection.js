/* Recover a missing/stale content script without reloading the user's video. */
(function (root) {
    'use strict';
    const F = root.YTFC || (typeof require === 'function' ? require('./shared.js') : null);
    const MATCHES = ['https://www.youtube.com/*', 'https://youtube.com/*'];
    const FILES = ['shared.js', 'dissolve.js', 'content.js'];
    function isYouTube(url) {
        try { const parsed = new URL(url); return parsed.protocol === 'https:' && ['www.youtube.com', 'youtube.com'].includes(parsed.hostname); }
        catch { return false; }
    }
    function createBridge(chrome) {
        const connecting = new Map();
        const version = chrome.runtime.getManifest().version;
        async function resolveTab(requestedId, source) {
            if (Number.isInteger(requestedId)) {
                try { const tab = await chrome.tabs.get(requestedId); if (isYouTube(tab.url)) return tab; } catch { /* Tab closed. */ }
            }
            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (active && isYouTube(active.url)) return active;
            // Opening popup.html as a tab should target the last YouTube tab, not itself.
            // Chrome does not expose extension-tab URLs without the broad tabs
            // permission. Use the trusted runtime sender instead of requesting it.
            const ownPopupTab = Number.isInteger(active?.id) && source?.tab?.id === active.id && source.url === chrome.runtime.getURL('popup.html');
            if (ownPopupTab || active?.url?.startsWith(chrome.runtime.getURL(''))) {
                const candidates = await chrome.tabs.query({ url: MATCHES, currentWindow: true });
                return candidates.filter(tab => isYouTube(tab.url) && !tab.discarded).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
            }
            return null;
        }
        function valid(status) {
            return status?.protocol === 2 && status.version === version && status.contentRevision === F.CONTENT_REVISION && typeof status.count === 'number' && status.counts && Array.isArray(status.items);
        }
        async function ensure(tabId) {
            if (connecting.has(tabId)) return connecting.get(tabId);
            const task = (async () => {
                try { const status = await chrome.tabs.sendMessage(tabId, { type: 'feedStatus' }); if (valid(status)) return status; } catch { /* Already-open or outdated tab. */ }
                const tab = await chrome.tabs.get(tabId);
                if (!isYouTube(tab.url) || tab.discarded) throw new Error('Unsupported or discarded tab');
                await chrome.scripting.executeScript({ target: { tabId }, files: FILES });
                const status = await chrome.tabs.sendMessage(tabId, { type: 'feedStatus' });
                if (!valid(status)) throw new Error('Content script did not initialize');
                return status;
            })();
            connecting.set(tabId, task);
            try { return await task; } finally { connecting.delete(tabId); }
        }
        async function request(message, source) {
            const tab = await resolveTab(message.tabId, source);
            if (!tab) return { errorKey: 'openYouTube' };
            try {
                let status = await ensure(tab.id);
                if (message.type === 'toggleFeedPreview') status = await chrome.tabs.sendMessage(tab.id, { type: 'togglePreview' });
                if (message.type === 'replayFeedAnimation') status = await chrome.tabs.sendMessage(tab.id, { type: 'replayAnimation' });
                if (!valid(status)) throw new Error('Invalid tab response');
                return { tabId: tab.id, status };
            } catch { return { tabId: tab.id, errorKey: 'connectionFailed' }; }
        }
        async function ensureOpenTabs() {
            const tabs = await chrome.tabs.query({ url: MATCHES });
            await Promise.all(tabs.filter(tab => isYouTube(tab.url) && !tab.discarded && tab.status !== 'loading').map(tab => ensure(tab.id).catch(() => null)));
        }
        return { request, ensure, ensureOpenTabs };
    }
    const api = { createBridge, isYouTube, MATCHES };
    root.YTFCConnection = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
