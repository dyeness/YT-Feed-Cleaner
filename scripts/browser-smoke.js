// Real MV3 extension smoke test in an isolated headless Chromium profile.
// Network-free YouTube fixtures: this is not a live YouTube layout compatibility guarantee.
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfc-smoke-'));
const video = (id, href, title, extras = '') => `<ytd-rich-item-renderer id="${id}"><a id="thumbnail" href="${href}">Thumbnail</a><a id="video-title" href="${href}">${title}</a>${extras}</ytd-rich-item-renderer>`;
(async () => {
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, {
            channel: 'chromium', headless: true, viewport: { width: 800, height: 1000 },
            args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
        });
        await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html><body>
            ${video('ordinary', '/watch?v=normal', 'Mix — 10 years ago', '<div id="metadata-line"><span>1 day ago</span></div>')}
            ${video('rdvideo', '/watch?v=normal&list=RDnormal', 'Normal video in autoplay')}
            ${video('short', '/shorts/short', 'A short')}
            ${video('old', '/watch?v=old', 'Old video', '<div id="metadata-line"><span>2 years ago</span></div>')}
            ${video('watched', '/watch?v=watched', 'Watched video', '<ytd-thumbnail-overlay-resume-playback-renderer><div id="progress" style="width:80%"></div></ytd-thumbnail-overlay-resume-playback-renderer>')}
            <ytd-radio-renderer id="mix" style="display:flex"><a id="thumbnail" href="/watch?v=mix&list=RDmix">Actual Mix</a></ytd-radio-renderer>
            </body></html>` }));
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const extensionId = worker.url().split('/')[2];
        await worker.evaluate(async () => {
            // Disable system notifications in this isolated test profile.
            await chrome.storage.local.set({ updateNotifications: false, language: 'en' });
            // Wait for any installation-time check before replacing network transport.
            await checkForUpdates();
            globalThis.fetch = async url => {
                if (url.endsWith('/releases/latest')) return new Response(JSON.stringify({ id: 123, tag_name: 'v1.6.0' }));
                if (url.endsWith('/commits/trunk')) return new Response(JSON.stringify({ sha: 'b'.repeat(40), commit: { message: 'New commit' } }));
                if (url.includes('raw.githubusercontent.com')) return new Response(JSON.stringify({ version: '1.6.0' }));
                return new Response(JSON.stringify({ default_branch: 'trunk' }));
            };
            await chrome.storage.local.set({ oldVideoThreshold: 7, hideWatched: true, updateState: { commitBaseline: 'a'.repeat(40) } });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://www.youtube.com/');
        await page.waitForFunction(() => document.querySelectorAll('[data-ytfc-hidden]').length === 4);
        assert.equal(await page.locator('#ordinary').isVisible(), true);
        assert.equal(await page.locator('#rdvideo').isVisible(), true);
        assert.equal(await page.locator('#mix').isVisible(), false);
        const [youtubeTab] = await worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }));
        console.log('PASS: actual content-script injection, CSS hiding and false-positive fixtures');
        await page.locator('#short a').evaluateAll(anchors => anchors.forEach(anchor => anchor.setAttribute('href', '/watch?v=reused')));
        await page.waitForFunction(() => !document.querySelector('#short').hasAttribute('data-ytfc-hidden'));
        assert.equal(await page.locator('#short').isVisible(), true);
        console.log('PASS: recycled-card restoration in Chromium');
        const preview = await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'togglePreview' }), youtubeTab.id);
        assert.equal(preview.paused, true); assert.equal(preview.count, 0);
        assert.equal(await page.locator('#mix').isVisible(), true);
        await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'togglePreview' }), youtubeTab.id);
        assert.equal(await page.locator('#mix').isVisible(), false);
        const popup = await context.newPage();
        popup.on('pageerror', error => errors.push(error.message));
        await popup.goto(`chrome-extension://${extensionId}/popup.html`);
        await popup.waitForFunction(() => !document.getElementById('controls').disabled);
        await popup.locator('#hideLive').check();
        await popup.waitForFunction(() => document.getElementById('saveStatus').textContent.length > 0);
        assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('hideLive')).hideLive), true);
        console.log('PASS: real popup, settings storage and per-tab preview messaging');
        await popup.locator('#updatesTab').click();
        await popup.locator('#checkUpdates').click();
        await popup.waitForFunction(() => document.querySelectorAll('.update-item').length === 2);
        assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), 'NEW');
        await popup.locator('#dismissUpdates').click();
        await popup.waitForFunction(() => document.querySelectorAll('.update-item').length === 0);
        assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '');
        await popup.locator('#checkUpdates').click();
        await popup.waitForFunction(() => !document.getElementById('checkUpdates').disabled);
        assert.equal(await popup.locator('.update-item').count(), 0);
        fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
        await popup.locator('#appearanceTab').click();
        await popup.locator('#language').selectOption('ru');
        await popup.waitForFunction(() => document.documentElement.lang === 'ru');
        assert.equal(await popup.locator('h1').textContent(), 'Очистка YouTube');
        assert.equal(await popup.locator('header img').getAttribute('src'), 'icons/icon.svg');
        assert.equal(await popup.evaluate(() => getComputedStyle(document.documentElement).fontSize), '18px');
        assert.equal(await popup.evaluate(() => getComputedStyle(document.querySelector('[data-i18n="languageLabel"]')).fontSize), '18px');
        assert.equal(await popup.locator('#language').evaluate(select => getComputedStyle(select).fontSize), '18px');
        assert.match(await popup.locator('#language').evaluate(select => getComputedStyle(select).fontFamily), /system-ui/);
        await popup.locator('#textSize').selectOption('extra');
        await popup.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '20px');
        await popup.locator('#animateHiding').check();
        await popup.locator('#animationSpeed').selectOption('slow');
        await popup.waitForFunction(() => document.getElementById('animationSpeed').value === 'slow');
        await worker.evaluate(async () => {
            await chrome.storage.local.set({ enabled: false, animateHiding: true, animationSpeed: 'slow', respectReducedMotion: false });
        });
        await context.route('https://i.ytimg.com/vi/dust/hqdefault.jpg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#ef5266"/><circle cx="250" cy="60" r="55" fill="#8df0ca"/><path d="M120 45v90l80-45z" fill="white"/></svg>' }));
        await page.bringToFront();
        await page.evaluate(() => {
            const card = document.createElement('ytd-rich-item-renderer');
            card.id = 'dust';
            card.style.cssText = 'display:block;width:320px;height:225px;margin:16px;background:#18243b;color:white;opacity:.85';
            card.innerHTML = '<a id="thumbnail" href="/shorts/dust"><img src="https://i.ytimg.com/vi/dust/hqdefault.jpg" style="display:block;width:320px;height:180px"></a><a id="video-title" href="/shorts/dust">Dust animation test</a>';
            document.body.prepend(card);
        });
        await page.waitForFunction(() => document.querySelector('#dust img').complete);
        await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
        await page.waitForFunction(() => document.querySelector('#dust').hasAttribute('data-ytfc-dissolving'));
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#dust')).opacity) < .8 && !document.querySelector('#dust').hasAttribute('data-ytfc-hidden'));
        assert.equal(await page.locator('[data-ytfc-dust]').count(), 1);
        await page.screenshot({ path: path.join(root, 'dist', 'dust-preview.png') });
        await page.waitForFunction(() => document.querySelector('#dust').hasAttribute('data-ytfc-hidden') && !document.querySelector('[data-ytfc-dust]'));
        assert.equal(await page.locator('#dust').evaluate(card => card.style.opacity), '0.85');
        await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
        await page.waitForFunction(() => !document.querySelector('#dust').hasAttribute('data-ytfc-hidden'));
        await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
        await page.waitForFunction(() => document.querySelector('#dust').hasAttribute('data-ytfc-dissolving'));
        await page.locator('#dust a').evaluateAll(anchors => anchors.forEach(anchor => anchor.setAttribute('href', '/watch?v=recycled-dust')));
        await page.waitForFunction(() => !document.querySelector('#dust').hasAttribute('data-ytfc-dissolving') && !document.querySelector('[data-ytfc-dust]'));
        assert.equal(await page.locator('#dust').isVisible(), true);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await worker.evaluate(() => chrome.storage.local.set({ enabled: false, respectReducedMotion: true }));
        await page.waitForFunction(() => !document.querySelector('[data-ytfc-hidden]'));
        await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
        await page.waitForFunction(() => document.querySelector('#mix').hasAttribute('data-ytfc-hidden'));
        assert.equal(await page.locator('[data-ytfc-dissolving], [data-ytfc-dust]').count(), 0);
        await worker.evaluate(() => chrome.storage.local.set({ animateHiding: false }));
        console.log('PASS: RU/EN switching, 18/20 px text, SVG and real cancellable thumbnail disintegration');
        await popup.bringToFront();
        await popup.setViewportSize({ width: 460, height: 600 });
        await popup.locator('#textSize').selectOption('large');
        await popup.screenshot({ path: path.join(root, 'dist', 'appearance-ru-preview.png'), fullPage: true });
        await popup.locator('#language').selectOption('en');
        await popup.waitForFunction(() => document.documentElement.lang === 'en');
        assert.equal(await popup.locator('h1').textContent(), 'YouTube Cleaner');
        await popup.screenshot({ path: path.join(root, 'dist', 'appearance-en-preview.png'), fullPage: true });
        await popup.locator('#updatesTab').click();
        await popup.screenshot({ path: path.join(root, 'dist', 'updates-preview.png'), fullPage: true });
        await popup.locator('#filtersTab').click();
        await popup.screenshot({ path: path.join(root, 'dist', 'popup-preview.png'), fullPage: true });
        assert.deepEqual(errors, []);
        console.log('PASS: real service worker update checks, badge and persistent acknowledgement');
    } finally {
        if (context) await context.close();
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
