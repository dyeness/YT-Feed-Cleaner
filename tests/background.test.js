const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => structuredClone(value);
function event() { return { listeners: [], addListener(fn) { this.listeners.push(fn); } }; }
async function setup(options = {}) {
    const data = clone(options.storage || {}), notifications = [], calls = [], badges = [], alarms = new Map();
    let failures = false, rateLimited = false, failNotification = false;
    const chrome = {
        runtime: { id: 'test', getManifest: () => ({ version: '1.5.0' }), onInstalled: event(), onStartup: event(), onMessage: event() },
        storage: { local: {
            async get(defaults) { return { ...clone(defaults), ...clone(data) }; },
            async set(values) {
                Object.assign(data, clone(values));
                for (const listener of chrome.storage.onChanged.listeners) listener(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue: clone(newValue) }])), 'local');
            }
        }, onChanged: event() },
        alarms: { async get(name) { return alarms.get(name); }, async create(name, value) { alarms.set(name, value); }, onAlarm: event() },
        action: { async setBadgeText(value) { badges.push(value.text); }, async setBadgeBackgroundColor() {}, async setTitle() {} },
        i18n: { getMessage: key => key },
        notifications: { async create(id, value) { if (failNotification) throw new Error('Notifications disabled by OS'); notifications.push({ id, ...value }); }, async clear() {}, onClicked: event() },
        tabs: { create() {} }
    };
    const context = vm.createContext({ chrome, console: { error() {}, warn() {} }, AbortSignal, URL, Date, setTimeout, clearTimeout, fetch: async url => {
        calls.push(url);
        if (failures) throw new Error('Network offline');
        if (rateLimited) return new Response('{}', { status: 403, headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) } });
        if (url.endsWith('/releases/latest')) return new Response(options.release ? JSON.stringify(options.release) : '{}', { status: options.release ? 200 : 404 });
        if (url.endsWith('/commits/trunk')) return new Response(JSON.stringify({ sha: 'b'.repeat(40), commit: { message: 'New work' } }));
        if (url.startsWith('https://raw.githubusercontent.com/')) return new Response(JSON.stringify({ version: options.version || '1.5.0' }));
        if (url === 'https://api.github.com/repos/dyeness/YT-Feed-Cleaner') return new Response(JSON.stringify({ default_branch: 'trunk' }));
        throw new Error(`Unexpected URL ${url}`);
    } });
    context.importScripts = (...files) => { for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context); };
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), context);
    await new Promise(resolve => setImmediate(resolve));
    const message = type => new Promise(resolve => chrome.runtime.onMessage.listeners[0]({ type }, { id: 'test' }, resolve));
    return { data, notifications, calls, badges, alarms, chrome, message, failNetwork() { failures = true; }, rateLimit() { rateLimited = true; }, failNotification() { failNotification = true; }, allowNotification() { failNotification = false; } };
}
test('worker checks actual default branch, creates alarms and establishes baseline', async () => {
    const h = await setup();
    assert.equal(h.alarms.get('checkUpdate').periodInMinutes, 360);
    const result = await h.message('checkUpdates');
    assert.equal(result.state.commitBaseline, 'b'.repeat(40));
    assert.equal(h.notifications.length, 0);
    assert.ok(h.calls.some(url => url.endsWith('/commits/trunk')));
    assert.ok(h.calls.some(url => url.includes('/' + 'b'.repeat(40) + '/manifest.json')));
});
test('worker deduplicates desktop notifications and acknowledgements survive rechecks', async () => {
    const h = await setup({ storage: { updateState: { commitBaseline: 'a'.repeat(40) } }, version: '1.6.0', release: { id: 12, tag_name: 'v1.6.0' } });
    await h.message('checkUpdates'); assert.equal(h.notifications.length, 1); assert.equal(h.badges.at(-1), 'NEW');
    await h.message('checkUpdates'); assert.equal(h.notifications.length, 1);
    await h.message('dismissUpdates'); assert.equal(h.badges.at(-1), '');
    await h.message('checkUpdates'); assert.equal(h.badges.at(-1), ''); assert.equal(h.notifications.length, 1);
});
test('offline check preserves update banner and reports an error', async () => {
    const h = await setup({ version: '1.6.0' });
    await h.message('checkUpdates'); const known = clone(h.data.updateState.version);
    h.failNetwork(); const result = await h.message('checkUpdates');
    assert.deepEqual(result.state.version, known); assert.match(result.state.error, /Network offline/); assert.equal(h.badges.at(-1), 'NEW');
});
test('GitHub rate limiting persists backoff even for manual checks', async () => {
    const h = await setup(); h.rateLimit();
    await h.message('checkUpdates'); assert.ok(h.data.updateState.retryAt > Date.now());
    const count = h.calls.length; await h.message('checkUpdates'); assert.equal(h.calls.length, count);
});
test('simultaneous update checks share a single network request sequence', async () => {
    const h = await setup();
    const results = await Promise.all([h.message('checkUpdates'), h.message('checkUpdates')]);
    assert.equal(results.length, 2); assert.equal(h.calls.length, 4);
});
test('notification opt-out keeps popup updates but makes no desktop notifications', async () => {
    const h = await setup({ storage: { updateNotifications: false }, version: '1.6.0' });
    await h.message('checkUpdates'); assert.equal(h.notifications.length, 0); assert.equal(h.badges.at(-1), 'NEW');
});
test('notifications and badge honor explicit Russian language independently of the browser', async () => {
    const h = await setup({ storage: { language: 'ru' }, version: '1.6.0' });
    await h.message('checkUpdates');
    assert.equal(h.notifications[0].title, 'YouTube Feed Cleaner');
    assert.equal(h.notifications[0].message, 'Новая версия: 1.6.0');
    assert.equal(h.badges.at(-1), 'НОВ');
    await h.chrome.storage.local.set({ language: 'en' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.badges.at(-1), 'NEW');
    h.failNetwork(); await h.message('checkUpdates');
    assert.equal(h.data.updateState.errorDetails[0].key, 'networkError');
});
test('failed desktop delivery is retried without losing version state', async () => {
    const h = await setup({ version: '1.6.0' }); h.failNotification();
    await h.message('checkUpdates'); assert.ok(h.data.updateState.version); assert.equal(h.notifications.length, 0);
    h.allowNotification(); await h.message('checkUpdates'); assert.equal(h.notifications.length, 1);
});
