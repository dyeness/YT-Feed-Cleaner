const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../connection.js');
const status = () => ({ protocol: 2, contentRevision: require('../shared.js').CONTENT_REVISION, version: '1.5.2', count: 2, counts: { mix: 2 }, items: [], animation: 'on' });
function setup({ current = { id: 1, url: 'https://www.youtube.com/' }, tabs = [], missing = false, stale = false, denied = false } = {}) {
    let connected = !missing, injections = 0, calls = [];
    const allTabs = [current, ...tabs];
    const chrome = {
        runtime: { getManifest: () => ({ version: '1.5.2' }), getURL: suffix => `chrome-extension://test/${suffix}` },
        tabs: {
            async get(id) { const tab = allTabs.find(tab => tab.id === id); if (!tab) throw new Error('No tab'); return tab; },
            async query(query) { return query.active ? [current] : allTabs; },
            async sendMessage(id, message) {
                calls.push({ id, type: message.type });
                if (!connected) throw new Error('Receiving end does not exist');
                if (stale && !injections) return { count: 7, items: [] };
                return { ...status(), paused: message.type === 'togglePreview' };
            }
        },
        scripting: { async executeScript(options) { if (denied) throw new Error('Host permission denied'); injections++; connected = true; calls.push(options); } }
    };
    return { bridge: C.createBridge(chrome), chrome, calls, injections: () => injections };
}
test('missing content script is injected into an already-open YouTube tab without reload', async () => {
    const h = setup({ missing: true }); const result = await h.bridge.request({ type: 'getFeedStatus' });
    assert.equal(result.status.count, 2); assert.equal(result.tabId, 1); assert.equal(h.injections(), 1);
    assert.deepEqual(h.calls.find(item => item.files).files, ['shared.js', 'dissolve.js', 'content.js']);
});
test('stale protocol is replaced instead of reporting broken statistics', async () => {
    const h = setup({ stale: true }); const result = await h.bridge.request({ type: 'getFeedStatus' });
    assert.equal(result.status.protocol, 2); assert.equal(h.injections(), 1);
});
test('outdated content revision is replaced without changing manifest version', async () => {
    const h = setup(); const send = h.chrome.tabs.sendMessage;
    h.chrome.tabs.sendMessage = (id, message) => h.injections() ? send(id, message) : Promise.resolve({ ...status(), contentRevision: 0 });
    const result = await h.bridge.request({ type: 'getFeedStatus' });
    assert.equal(h.injections(), 1); assert.equal(result.status.version, '1.5.2');
    assert.equal(result.status.contentRevision, require('../shared.js').CONTENT_REVISION);
});
test('healthy connection avoids duplicate scripts and toggles preview exactly once', async () => {
    const h = setup(); const result = await h.bridge.request({ type: 'toggleFeedPreview' });
    assert.equal(result.status.paused, true); assert.equal(h.injections(), 0);
    assert.equal(h.calls.filter(item => item.type === 'togglePreview').length, 1);
});
test('extension popup opened as tab targets the most recently accessed YouTube tab', async () => {
    const h = setup({ current: { id: 5, url: 'chrome-extension://test/popup.html' }, tabs: [{ id: 1, url: 'https://www.youtube.com/', lastAccessed: 10 }, { id: 2, url: 'https://youtube.com/watch?v=x', lastAccessed: 20 }] });
    const result = await h.bridge.request({ type: 'getFeedStatus' }); assert.equal(result.tabId, 2);
});
test('Chrome redacted extension-tab URL is resolved using trusted runtime sender without tabs permission', async () => {
    const h = setup({ current: { id: 5 }, tabs: [{ id: 1, url: 'https://www.youtube.com/' }] });
    const result = await h.bridge.request({ type: 'getFeedStatus' }, { tab: { id: 5 }, url: 'chrome-extension://test/popup.html' });
    assert.equal(result.tabId, 1);
    assert.deepEqual(await h.bridge.request({ type: 'getFeedStatus' }, { tab: { id: 5 }, url: 'https://evil.test/' }), { errorKey: 'openYouTube' });
});
test('a non-YouTube active tab is never silently replaced by an unrelated tab', async () => {
    const h = setup({ current: { id: 5, url: 'https://example.com' }, tabs: [{ id: 1, url: 'https://www.youtube.com/' }] });
    assert.deepEqual(await h.bridge.request({ type: 'getFeedStatus' }), { errorKey: 'openYouTube' }); assert.equal(h.calls.length, 0);
});
test('concurrent popup requests share one recovery injection', async () => {
    const h = setup({ missing: true }); await Promise.all([h.bridge.ensure(1), h.bridge.ensure(1)]);
    assert.equal(h.injections(), 1);
});
test('denied permission produces a useful reconnect state, never fake zero statistics', async () => {
    const h = setup({ missing: true, denied: true });
    assert.deepEqual(await h.bridge.request({ type: 'getFeedStatus' }), { tabId: 1, errorKey: 'connectionFailed' });
});
test('existing tab injection on installation only affects supported, non-discarded pages', async () => {
    const h = setup({ missing: true, tabs: [{ id: 2, url: 'https://example.com/' }, { id: 3, url: 'https://www.youtube.com/', discarded: true }] });
    await h.bridge.ensureOpenTabs(); assert.equal(h.injections(), 1);
});
test('YouTube URL matching rejects deceptive hosts and non-HTTPS origins', () => {
    assert.equal(C.isYouTube('https://www.youtube.com/watch?v=x'), true);
    for (const url of ['https://www.youtube.com.evil.test/', 'http://www.youtube.com/', 'chrome://extensions', 'https://music.youtube.com/']) assert.equal(C.isYouTube(url), false);
});
