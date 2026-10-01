const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const F = require('../shared.js');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const messages = JSON.parse(source('_locales/en/messages.json'));
const settle = () => new Promise(resolve => setTimeout(resolve, 200));
async function setup(t, initial = {}, options = {}) {
    const dom = new JSDOM(source('popup.html'), { url: 'https://extension.test/popup.html', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    dom.window.scrollTo = () => {};
    const stored = { ...initial }, saves = [];
    let changes, currentPort, feedError = options.feedError;
    const requests = [], feed = { protocol: 2, count: 1, counts: { age: 1 }, items: [{ title: '<img onerror=alert(1)>', reasons: ['age'] }], animation: 'off', paused: false };
    dom.window.chrome = {
        i18n: { getUILanguage: () => options.browserLanguage || 'en', getMessage(key, params = []) { return (messages[key]?.message || '').replace(/\$\w+\$/g, params[0]); } },
        storage: { local: { async get(defaults) { return { ...defaults, ...stored }; }, async set(values) { Object.assign(stored, values); saves.push(values); } }, onChanged: { addListener(fn) { changes = fn; } } },
        runtime: { getManifest: () => ({ version: '1.5.2' }), async sendMessage(message) {
            requests.push(message);
            if (['getFeedStatus', 'toggleFeedPreview', 'replayFeedAnimation'].includes(message.type)) {
                if (feedError) return { errorKey: feedError };
                if (message.type === 'toggleFeedPreview') feed.paused = !feed.paused;
                return { tabId: 3, status: { ...feed } };
            }
            return { state: { lastSuccess: 1000 } };
        } },
        tabs: { connect() {
            currentPort = { messages: [], disconnects: [], onMessage: { addListener(fn) { currentPort.messages.push(fn); } }, onDisconnect: { addListener(fn) { currentPort.disconnects.push(fn); } }, disconnect() { this.disconnects.forEach(fn => fn()); } };
            return currentPort;
        } }
    };
    dom.window.eval(source('shared.js')); dom.window.eval(source('translations.js')); dom.window.eval(source('i18n.js')); dom.window.eval(source('updates.js')); dom.window.eval(source('popup.js'));
    await settle();
    return { doc: dom.window.document, window: dom.window, stored, saves, changes, requests,
        push(status) { currentPort.messages.forEach(fn => fn({ ...feed, ...status })); },
        failConnection(key) { feedError = key; }, disconnect() { currentPort.disconnect(); }
    };
}
test('popup migrates settings, localizes controls, and renders status without HTML injection', async t => {
    const h = await setup(t, { oldVideoThreshold: '365', hideWatched: true });
    assert.equal(h.doc.getElementById('controls').disabled, false);
    assert.equal(h.doc.getElementById('oldVideoThreshold').value, '365');
    assert.equal(h.doc.querySelector('#statsText').textContent, 'Hidden on this page: 1');
    assert.equal(h.doc.querySelector('#statsDetails img'), null);
    assert.match(h.doc.querySelector('#statsDetails').textContent, /<img onerror/);
    assert.equal(h.doc.querySelector('#watchThreshold').disabled, false);
});
test('changing an input saves all normalized settings', async t => {
    const h = await setup(t);
    const input = h.doc.getElementById('hideLive'); input.checked = true;
    input.dispatchEvent(new h.window.Event('change')); await settle();
    assert.equal(h.stored.hideLive, true);
    assert.equal(h.saves.length, 1);
    assert.deepEqual(Object.keys(h.saves[0]).sort(), Object.keys(F.DEFAULTS).sort());
});
test('age is a ready-made preset selector, and choosing 90 days saves immediately', async t => {
    const h = await setup(t, { oldVideoThreshold: 0 });
    const field = h.doc.getElementById('oldVideoThreshold');
    assert.equal(field.tagName, 'SELECT');
    assert.deepEqual([...field.options].map(option => Number(option.value)), [...F.AGE_PRESETS]);
    field.focus(); field.value = '90'; field.dispatchEvent(new h.window.Event('change', { bubbles: true })); await settle();
    assert.equal(h.stored.oldVideoThreshold, 90); assert.equal(h.doc.activeElement, field);
});
test('existing non-preset cutoff is preserved, localized and never silently rounded', async t => {
    const h = await setup(t, { oldVideoThreshold: 120, language: 'ru' });
    const field = h.doc.getElementById('oldVideoThreshold');
    assert.equal(field.value, '120'); assert.match(field.selectedOptions[0].textContent, /Ранее: 120/);
    h.doc.getElementById('hideLive').checked = true; h.doc.getElementById('hideLive').dispatchEvent(new h.window.Event('change')); await settle();
    assert.equal(h.stored.oldVideoThreshold, 120);
    field.value = '90'; field.dispatchEvent(new h.window.Event('change')); await settle(); assert.equal(h.stored.oldVideoThreshold, 90);
});
test('age scope warning explains excluded recommendations but disappears when enabled', async t => {
    const h = await setup(t, { oldVideoThreshold: 90 });
    h.push({ context: 'watch' }); const warning = h.doc.getElementById('ageScopeWarning');
    assert.equal(warning.hidden, false); assert.match(warning.textContent, /Recommendations/);
    const checkbox = h.doc.getElementById('filterWatch'); checkbox.checked = true; checkbox.dispatchEvent(new h.window.Event('change')); await settle();
    h.push({ context: 'watch' }); assert.equal(warning.hidden, true);
    assert.equal(h.stored.filterHome, true); assert.equal(h.stored.filterSearch, false);
});
test('invalid partial numeric input preserves the last valid cutoff without validation popups', async t => {
    const h = await setup(t, { oldVideoThreshold: 60 });
    let reports = 0; h.doc.getElementById('settingsForm').reportValidity = () => { reports++; return false; };
    const field = h.doc.getElementById('minDuration'); field.value = '-1';
    field.dispatchEvent(new h.window.Event('input', { bubbles: true })); await settle();
    assert.equal(h.stored.oldVideoThreshold, 60); assert.equal(reports, 0);
});
test('preview toggle is per-tab and does not change persisted filters', async t => {
    const h = await setup(t);
    h.doc.getElementById('preview').click(); await settle();
    assert.match(h.doc.getElementById('statsText').textContent, /Preview/);
    assert.equal(h.saves.length, 0);
});
test('new release and commit render independently, dismiss button is available', async t => {
    const h = await setup(t, { updateState: {
        release: { id: 'release:12', version: 'v1.6.0', url: 'https://github.com/dyeness/YT-Feed-Cleaner/releases/tag/v1.6.0' },
        commit: { id: 'commit:new', sha: 'a'.repeat(40), title: '<script>bad()</script>', url: 'https://github.com/dyeness/YT-Feed-Cleaner/commit/' + 'a'.repeat(40) }
    } });
    assert.equal(h.doc.querySelectorAll('.update-item').length, 2);
    assert.equal(h.doc.querySelector('#dismissUpdates').hidden, false);
    assert.equal(h.doc.querySelector('#updateItems script'), null);
});
test('filter/update tabs support keyboard navigation and reveal their panels', async t => {
    const h = await setup(t);
    const filters = h.doc.getElementById('filtersTab');
    assert.equal(h.doc.getElementById('updatesPanel').hidden, true);
    filters.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(h.doc.getElementById('updatesPanel').hidden, false);
    assert.equal(h.doc.getElementById('filtersPanel').hidden, true);
    assert.equal(h.doc.getElementById('updatesTab').getAttribute('aria-selected'), 'true');
    h.doc.getElementById('filtersTab').click();
    assert.equal(h.doc.getElementById('filtersPanel').hidden, false);
});
test('manual language changes static labels, statistics, reasons and update errors immediately', async t => {
    const h = await setup(t, { updateState: { error: 'Network offline', errorDetails: [{ key: 'networkError', values: [] }] } });
    const language = h.doc.getElementById('language');
    language.value = 'ru'; language.dispatchEvent(new h.window.Event('change')); await settle();
    assert.equal(h.doc.documentElement.lang, 'ru');
    assert.equal(h.doc.querySelector('h1').textContent, 'YouTube Feed Cleaner');
    assert.equal(h.doc.getElementById('statsText').textContent, 'Скрыто на странице: 1');
    assert.match(h.doc.getElementById('statsDetails').textContent, /Возраст публикации/);
    assert.match(h.doc.getElementById('updateStatus').textContent, /Нет связи с GitHub/);
    assert.equal(h.stored.language, 'ru');
    language.value = 'en'; language.dispatchEvent(new h.window.Event('change')); await settle();
    assert.equal(h.doc.querySelector('h1').textContent, 'YouTube Feed Cleaner');
    assert.equal(h.doc.getElementById('statsText').textContent, 'Hidden on this page: 1');
    assert.match(h.doc.getElementById('updateStatus').textContent, /Cannot reach GitHub/);
});
test('English brand remains fixed for ru, en and Russian-browser auto mode', async t => {
    assert.equal(JSON.parse(source('manifest.json')).name, F.BRAND_NAME);
    for (const language of ['ru', 'en', 'auto']) {
        const h = await setup(t, { language }, { browserLanguage: 'ru-RU' });
        assert.equal(h.doc.querySelector('h1').textContent, 'YouTube Feed Cleaner', language);
        assert.equal(h.doc.title, 'YouTube Feed Cleaner', language);
        assert.equal(h.doc.querySelector('[role=tablist]').getAttribute('aria-label'), 'YouTube Feed Cleaner', language);
        assert.equal(h.doc.documentElement.lang, language === 'en' ? 'en' : 'ru');
        assert.equal(h.doc.getElementById('filtersTab').textContent, language === 'en' ? 'Filters' : 'Фильтры');
    }
});
test('SVG is used in popup and text size / animation controls persist independently', async t => {
    const h = await setup(t);
    assert.equal(h.doc.querySelector('header img').getAttribute('src'), 'icons/icon.svg');
    assert.equal(h.doc.documentElement.dataset.textSize, 'large');
    assert.equal(h.doc.getElementById('animationSpeed').disabled, true);
    h.doc.getElementById('textSize').value = 'extra';
    h.doc.getElementById('textSize').dispatchEvent(new h.window.Event('change')); await settle();
    assert.equal(h.doc.documentElement.dataset.textSize, 'extra');
    h.doc.getElementById('animateHiding').checked = true;
    h.doc.getElementById('animateHiding').dispatchEvent(new h.window.Event('change')); await settle();
    assert.equal(h.stored.animateHiding, true); assert.equal(h.doc.getElementById('animationSpeed').disabled, false);
    h.doc.getElementById('animateHiding').checked = false;
    h.doc.getElementById('animateHiding').dispatchEvent(new h.window.Event('change')); await settle();
    assert.equal(h.stored.animateHiding, false); assert.equal(h.stored.textSize, 'extra');
});
test('appearance tab supports End/Home keys and all existing controls remain accessible', async t => {
    const h = await setup(t);
    h.doc.getElementById('filtersTab').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(h.doc.getElementById('appearancePanel').hidden, false);
    assert.equal(h.doc.getElementById('updatesPanel').hidden, true);
    h.doc.getElementById('appearanceTab').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assert.equal(h.doc.getElementById('filtersPanel').hidden, false);
    for (const key of Object.keys(F.DEFAULTS)) assert.ok(h.doc.getElementById(key), key);
});
test('unrelated appearance storage changes never discard a pending animation edit', async t => {
    const h = await setup(t);
    const checkbox = h.doc.getElementById('animateHiding'); checkbox.checked = true;
    checkbox.dispatchEvent(new h.window.Event('change'));
    h.changes({ respectReducedMotion: { newValue: false } }, 'local');
    assert.equal(checkbox.checked, true);
    await settle(); assert.equal(h.stored.animateHiding, true);
});
test('statistics update live when cards change, without reopening the popup', async t => {
    const h = await setup(t);
    h.push({ count: 4, counts: { shorts: 4 }, items: [] });
    assert.equal(h.doc.getElementById('statsText').textContent, 'Hidden on this page: 4');
    assert.match(h.doc.getElementById('statsDetails').textContent, /Shorts: 4/);
});
test('failed connection offers recovery and restores actual stats when retried', async t => {
    const h = await setup(t, {}, { feedError: 'connectionFailed' });
    assert.equal(h.doc.getElementById('preview').disabled, true);
    assert.equal(h.doc.getElementById('statsText').textContent, 'Cannot connect to the YouTube tab.');
    h.failConnection(null); h.doc.getElementById('refreshStats').click(); await settle();
    assert.equal(h.doc.getElementById('preview').disabled, false);
    assert.equal(h.doc.getElementById('statsText').textContent, 'Hidden on this page: 1');
});
test('download latest release remains usable during API errors and without update banners', async t => {
    const h = await setup(t, { updateState: { error: 'Network offline' } });
    assert.equal(h.doc.getElementById('downloadRelease').href, 'https://github.com/dyeness/YT-Feed-Cleaner/releases/latest');
    assert.equal(h.doc.getElementById('downloadRelease').textContent, 'Download latest release');
    h.changes({ updateState: { newValue: { latestRelease: { downloadUrl: 'https://github.com/dyeness/YT-Feed-Cleaner/releases/download/v1.5.2/yt-feed-cleaner-1.5.2.zip' } } } }, 'local');
    assert.match(h.doc.getElementById('downloadRelease').href, /1\.5\.2\.zip$/);
});
test('watch threshold uses 10 percent increments and migrates old values conservatively', async t => {
    const h = await setup(t, { watchThreshold: 75 });
    const range = h.doc.getElementById('watchThreshold');
    assert.equal(range.step, '10'); assert.equal(range.min, '10'); assert.equal(range.value, '80');
});
test('animation diagnostics explain reduced motion and replay uses the actual tab', async t => {
    const h = await setup(t, { animateHiding: true });
    h.push({ animation: 'reduced' });
    assert.equal(h.doc.getElementById('replayAnimation').disabled, true);
    assert.match(h.doc.getElementById('animationStatus').textContent, /OS preference/);
    h.push({ animation: 'on' }); h.doc.getElementById('replayAnimation').click(); await settle();
    assert.ok(h.requests.some(request => request.type === 'replayFeedAnimation' && request.tabId === 3));
});
test('update failures are displayed once even when several GitHub requests fail identically', async t => {
    const h = await setup(t, { updateState: { error: 'Failed to fetch', errorDetails: [{ key: 'networkError', values: [] }, { key: 'networkError', values: [] }] } });
    assert.equal((h.doc.getElementById('updateStatus').textContent.match(/Cannot reach GitHub/g) || []).length, 1);
});
test('UI keeps controls but removes verbose design and implementation paragraphs', () => {
    const html = new JSDOM(source('popup.html'));
    for (const key of ['safeHint', 'appearanceHint', 'iconHint', 'animationHint', 'motionHint', 'manualUpdate']) assert.equal(html.window.document.querySelector(`[data-i18n="${key}"]`), null);
    html.window.close();
});
test('all popup localization keys exist in both languages', () => {
    const html = new JSDOM(source('popup.html'));
    const en = JSON.parse(source('_locales/en/messages.json')), ru = JSON.parse(source('_locales/ru/messages.json'));
    assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
    for (const node of html.window.document.querySelectorAll('[data-i18n]')) assert.ok(en[node.dataset.i18n], node.dataset.i18n);
    for (const key of Object.keys(F.DEFAULTS)) assert.ok(html.window.document.getElementById(key), key);
    html.window.close();
});
test('manifest references existing runtime assets and safe host permissions', () => {
    const manifest = JSON.parse(source('manifest.json'));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, require('../package.json').version);
    const paths = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(entry => entry.js)];
    for (const item of paths) assert.ok(fs.existsSync(path.join(__dirname, '..', item)), item);
    assert.ok(manifest.host_permissions.includes('https://api.github.com/*'));
    assert.equal(manifest.permissions.includes('tabs'), false);
    for (const size of [16,32,48,128]) {
        const image = fs.readFileSync(path.join(__dirname, '..', `icons/icon${size}.png`));
        assert.equal(image.readUInt32BE(16), size); assert.equal(image.readUInt32BE(20), size);
        const { Resvg } = require('@resvg/resvg-js');
        assert.deepEqual(image, new Resvg(source('icons/icon.svg'), { fitTo: { mode: 'width', value: size } }).render().asPng());
    }
});
