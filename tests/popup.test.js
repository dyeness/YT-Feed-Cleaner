const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const F = require('../shared.js');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const messages = JSON.parse(source('_locales/en/messages.json'));
const settle = () => new Promise(resolve => setTimeout(resolve, 200));
async function setup(t, initial = {}) {
    const dom = new JSDOM(source('popup.html'), { url: 'https://extension.test/popup.html', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    dom.window.scrollTo = () => {};
    const stored = { ...initial }, saves = [];
    let changes;
    dom.window.chrome = {
        i18n: { getUILanguage: () => 'en', getMessage(key, params = []) { return (messages[key]?.message || '').replace(/\$\w+\$/g, params[0]); } },
        storage: { local: { async get(defaults) { return { ...defaults, ...stored }; }, async set(values) { Object.assign(stored, values); saves.push(values); } }, onChanged: { addListener(fn) { changes = fn; } } },
        runtime: { getManifest: () => ({ version: '1.5.0' }), async sendMessage() { return { state: { lastSuccess: 1000 } }; } },
        tabs: { async query() { return [{ id: 3 }]; }, async sendMessage(id, message) { return { count: 1, counts: { age: 1 }, items: [{ title: '<img onerror=alert(1)>', reasons: ['age'] }], paused: message.type === 'togglePreview' }; } }
    };
    dom.window.eval(source('shared.js')); dom.window.eval(source('translations.js')); dom.window.eval(source('i18n.js')); dom.window.eval(source('updates.js')); dom.window.eval(source('popup.js'));
    await settle();
    return { doc: dom.window.document, window: dom.window, stored, saves, changes };
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
    assert.equal(h.doc.querySelector('h1').textContent, 'Очистка YouTube');
    assert.equal(h.doc.getElementById('statsText').textContent, 'Скрыто на странице: 1');
    assert.match(h.doc.getElementById('statsDetails').textContent, /Возраст публикации/);
    assert.match(h.doc.getElementById('updateStatus').textContent, /Нет связи с GitHub/);
    assert.equal(h.stored.language, 'ru');
    language.value = 'en'; language.dispatchEvent(new h.window.Event('change')); await settle();
    assert.equal(h.doc.querySelector('h1').textContent, 'YouTube Cleaner');
    assert.equal(h.doc.getElementById('statsText').textContent, 'Hidden on this page: 1');
    assert.match(h.doc.getElementById('updateStatus').textContent, /Cannot reach GitHub/);
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
