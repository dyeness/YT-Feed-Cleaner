// Real MV3 extension smoke test in an isolated headless Chromium profile.
// Network-free YouTube fixtures: this is not a live YouTube layout compatibility guarantee.
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const extensionRoot = process.env.YTFC_EXTENSION_ROOT ? path.resolve(process.env.YTFC_EXTENSION_ROOT) : root;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfc-smoke-'));
const video = (id, href, title, extras = '') => `<ytd-rich-item-renderer id="${id}"><a id="thumbnail" href="${href}">Thumbnail</a><a id="video-title" href="${href}">${title}</a>${extras}</ytd-rich-item-renderer>`;
(async () => {
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, {
            channel: 'chromium', headless: true, viewport: { width: 800, height: 1000 },
            args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`]
        });
        await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html><body>
            ${video('ordinary', '/watch?v=normal', 'Mix — 10 years ago', '<div id="metadata-line"><span>1 day ago</span></div>')}
            ${video('rdvideo', '/watch?v=normal&list=RDnormal', 'Normal video in autoplay')}
            ${video('short', '/shorts/short', 'A short')}
            ${video('old', '/watch?v=old', 'Old video', '<div id="metadata-line"><span>2 years ago</span></div>')}
            <ytd-rich-item-renderer id="watched"><yt-lockup-view-model><a class="ytLockupViewModelContentImage" href="/watch?v=watched">Thumbnail</a><h3 class="ytLockupMetadataViewModelTitle"><a href="/watch?v=watched">Watched video</a></h3><yt-thumbnail-overlay-progress-bar-view-model><div class="YtThumbnailOverlayProgressBarHostWatchedProgressBar"><div class="YtThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern" style="width:80%"></div></div></yt-thumbnail-overlay-progress-bar-view-model></yt-lockup-view-model></ytd-rich-item-renderer>
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
                if (url.endsWith('/releases/latest')) return new Response(JSON.stringify({ id: 123, tag_name: 'v1.6.0', assets: [{ name: 'yt-feed-cleaner-1.6.0.zip', state: 'uploaded', browser_download_url: 'https://github.com/dyeness/YT-Feed-Cleaner/releases/download/v1.6.0/yt-feed-cleaner-1.6.0.zip' }] }));
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
        assert.equal(await page.locator('#watched').getAttribute('data-ytfc-hidden'), 'watched');
        assert.equal((await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'feedStatus' }), youtubeTab.id)).counts.watched, 1);
        await worker.evaluate(() => chrome.storage.local.set({ watchThreshold: 90 }));
        await page.waitForFunction(() => !document.querySelector('#watched').hasAttribute('data-ytfc-hidden'));
        await worker.evaluate(() => chrome.storage.local.set({ watchThreshold: 70 }));
        await page.waitForFunction(() => document.querySelector('#watched').hasAttribute('data-ytfc-hidden'));
        await page.locator('#watched .YtThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern').evaluate(bar => { bar.style.width = '20%'; });
        await page.waitForFunction(() => !document.querySelector('#watched').hasAttribute('data-ytfc-hidden'));
        await page.locator('#watched .YtThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern').evaluate(bar => { bar.style.width = '80%'; });
        await page.waitForFunction(() => document.querySelector('#watched').hasAttribute('data-ytfc-hidden'));
        console.log('PASS: modern camelCase lockup, watched-fill classes, threshold and progress changes');
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
        await popup.waitForFunction(() => document.getElementById('statsText').textContent === 'Hidden on this page: 3', null, { timeout: 10000 }).catch(async error => {
            console.error('Stats diagnostics:', await popup.locator('#statsText').textContent(), await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({ active: true, currentWindow: true }), result: await feedBridge.request({ type: 'getFeedStatus' }) })), errors);
            throw error;
        });
        await page.evaluate(() => {
            window.__fixtureToken = 'no-reload';
            document.body.insertAdjacentHTML('beforeend', '<ytd-rich-item-renderer id="liveShort"><a id="thumbnail" href="/shorts/live">Live stats fixture</a></ytd-rich-item-renderer>');
        });
        await popup.waitForFunction(() => document.getElementById('statsText').textContent === 'Hidden on this page: 4');
        await popup.locator('#preview').click();
        await popup.waitForFunction(() => document.getElementById('statsText').textContent.startsWith('Preview:'));
        assert.equal(await page.locator('[data-ytfc-hidden]').count(), 0);
        await popup.locator('#preview').click();
        await popup.waitForFunction(() => document.getElementById('statsText').textContent === 'Hidden on this page: 4');
        await worker.evaluate(async id => {
            await chrome.scripting.executeScript({ target: { tabId: id }, func: () => { globalThis.__YTFCContent.dispose(); delete globalThis.__YTFCContent; } });
        }, youtubeTab.id);
        await popup.waitForFunction(() => document.getElementById('preview').disabled);
        await popup.locator('#refreshStats').click();
        await popup.waitForFunction(() => document.getElementById('statsText').textContent === 'Hidden on this page: 4');
        assert.equal(await page.evaluate(() => window.__fixtureToken), 'no-reload');
        assert.equal(await page.locator('style[data-ytfc-style]').count(), 1);
        assert.equal(await popup.locator('#watchThreshold').getAttribute('step'), '10');
        assert.equal(await popup.locator('section').first().evaluate(element => getComputedStyle(element).borderRadius), '2px');
        console.log('PASS: real popup statistics, live updates, correct target tab and recovery without reload');
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
        const download = 'https://github.com/dyeness/YT-Feed-Cleaner/releases/download/v1.6.0/yt-feed-cleaner-1.6.0.zip';
        assert.equal(await popup.locator('#downloadRelease').getAttribute('href'), download);
        await worker.evaluate(async () => {
            const original = globalThis.fetch;
            globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
            try { await checkForUpdates(); } finally { globalThis.fetch = original; }
        });
        await popup.waitForFunction(() => document.getElementById('updateStatus').textContent.includes('Check failed'));
        assert.equal(await popup.locator('#downloadRelease').getAttribute('href'), download);
        console.log('PASS: latest-release download survives acknowledgements and API network failures');
        fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
        await popup.locator('#appearanceTab').click();
        await popup.locator('#language').selectOption('ru');
        await popup.waitForFunction(() => document.documentElement.lang === 'ru');
        assert.equal(await popup.locator('h1').textContent(), 'YouTube Feed Cleaner');
        assert.equal(await popup.title(), 'YouTube Feed Cleaner');
        assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().name), 'YouTube Feed Cleaner');
        assert.ok((await worker.evaluate(() => chrome.action.getTitle({}))).startsWith('YouTube Feed Cleaner'));
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
        await worker.evaluate(() => chrome.storage.local.set({ respectReducedMotion: false }));
        await page.bringToFront();
        await page.waitForFunction(() => !!document.querySelector('[data-ytfc-dissolving]'));
        await page.waitForFunction(() => !document.querySelector('[data-ytfc-dust]'));
        assert.equal(await page.locator('[data-ytfc-hidden]').count(), 4);
        console.log('PASS: enabling animation replays already-hidden cards on return to YouTube');
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
        await popup.screenshot({ path: path.join(root, 'dist', 'appearance-ru-preview.png'), fullPage: true, animations: 'disabled' });
        await popup.locator('#language').selectOption('en');
        await popup.waitForFunction(() => document.documentElement.lang === 'en');
        assert.equal(await popup.locator('h1').textContent(), 'YouTube Feed Cleaner');
        await popup.screenshot({ path: path.join(root, 'dist', 'appearance-en-preview.png'), fullPage: true, animations: 'disabled' });
        await popup.locator('#updatesTab').click();
        await popup.screenshot({ path: path.join(root, 'dist', 'updates-preview.png'), fullPage: true, animations: 'disabled' });
        await popup.locator('#filtersTab').click();
        await popup.screenshot({ path: path.join(root, 'dist', 'popup-preview.png'), fullPage: true, animations: 'disabled' });
        await popup.locator('#appearanceTab').click();
        await popup.locator('#language').selectOption('ru');
        await popup.waitForFunction(() => document.documentElement.lang === 'ru');
        await popup.locator('#updatesTab').click();
        await popup.screenshot({ path: path.join(root, 'dist', 'updates-ru-preview.png'), fullPage: true, animations: 'disabled' });
        await popup.locator('#filtersTab').click();
        await popup.screenshot({ path: path.join(root, 'dist', 'filters-ru-preview.png'), fullPage: true, animations: 'disabled' });
        await context.route('https://www.youtube.com/?ytfc-age-test=1', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + [
            ['year', '1 г. назад', '1 год назад'], ['months', '9 мес. назад', '9 месяцев назад'], ['fresh', '2 дн. назад', '2 дня назад'], ['boundary', '90 дн. назад', '90 дней назад']
        ].map(([id, text, label]) => `<ytd-rich-item-renderer id="${id}" style="${id === 'year' ? 'display:grid!important' : ''}"><yt-lockup-view-model><a class="ytLockupViewModelContentImage" href="/watch?v=${id}">Thumbnail</a><h3 class="ytLockupMetadataViewModelTitle">${id}</h3><yt-content-metadata-view-model><div class="ytContentMetadataViewModelMetadataRow" role="group"><span class="ytContentMetadataViewModelMetadataText">YouTube</span><span class="ytContentMetadataViewModelMetadataText" aria-label="316 тысяч просмотров">316 тыс.</span><span class="ytAttributedStringHost ytContentMetadataViewModelMetadataText ytContentMetadataViewModelMetadataTextLastPart" role="text" aria-label="${label}">${text}</span><span class="ytContentMetadataViewModelMetadataText">8,02 тыс. Подписчики</span></div><div class="ytContentMetadataViewModelMetadataRow"><span class="ytContentMetadataViewModelMetadataText">5 VPH</span></div></yt-content-metadata-view-model></yt-lockup-view-model></ytd-rich-item-renderer>`).join('') + '</body></html>' }));
        await worker.evaluate(() => chrome.storage.local.set({ oldVideoThreshold: 90, hideWatched: false, hideJams: false, hideShortsHome: false }));
        const agePage = await context.newPage(); agePage.on('pageerror', error => errors.push(error.message));
        await agePage.goto('https://www.youtube.com/?ytfc-age-test=1');
        await agePage.waitForFunction(() => document.querySelectorAll('[data-ytfc-hidden]').length === 2).catch(async error => {
            console.error('Age diagnostics:', await agePage.evaluate(() => ({ url: location.href, hidden: [...document.querySelectorAll('[data-ytfc-hidden]')].map(n => ({ id: n.id, reasons: n.getAttribute('data-ytfc-hidden') })), metadata: [...document.querySelectorAll('yt-content-metadata-view-model')].map(n => n.outerHTML) })), await worker.evaluate(async () => ({ settings: await chrome.storage.local.get(), tabs: await chrome.tabs.query({ active: true, currentWindow: true }) })));
            throw error;
        });
        assert.equal(await agePage.locator('#year').getAttribute('data-ytfc-hidden'), 'age');
        assert.equal(await agePage.locator('#months').getAttribute('data-ytfc-hidden'), 'age');
        assert.equal(await agePage.locator('#year').isVisible(), false);
        assert.equal(await agePage.locator('#months').isVisible(), false);
        await agePage.locator('#year').evaluate(card => {
            const date = card.querySelector('[aria-label="1 год назад"]'); date.removeAttribute('aria-label'); date.classList.remove('ytContentMetadataViewModelMetadataTextLastPart');
            date.textContent = '1 \u200eг. назад';
            card.querySelector('yt-content-metadata-view-model').insertAdjacentHTML('beforeend', '<div class="ytContentMetadataViewModelMetadataRow"><span class="ytContentMetadataViewModelMetadataText">Additional statistics</span></div>');
            card.style.setProperty('display', 'grid', 'important');
        });
        await agePage.waitForFunction(() => document.querySelector('#year').getAttribute('data-ytfc-hidden') === 'age' && getComputedStyle(document.querySelector('#year')).display === 'none');
        assert.equal(await agePage.locator('#fresh').isVisible(), true);
        assert.equal(await agePage.locator('#boundary').isVisible(), true);
        const agePopup = await context.newPage(); agePopup.on('pageerror', error => errors.push(error.message));
        await agePopup.goto(`chrome-extension://${extensionId}/popup.html`);
        await agePopup.waitForFunction(() => !document.getElementById('controls').disabled);
        assert.equal(await agePopup.locator('#oldVideoThreshold').evaluate(node => node.tagName), 'SELECT');
        await agePopup.locator('#oldVideoThreshold').focus();
        await agePopup.locator('#oldVideoThreshold').selectOption('365');
        await agePage.waitForFunction(() => document.querySelectorAll('[data-ytfc-hidden]').length === 0);
        assert.equal(await agePopup.locator('#oldVideoThreshold').evaluate(node => document.activeElement === node), true);
        await agePopup.locator('#oldVideoThreshold').selectOption('90');
        await agePage.waitForFunction(() => document.querySelectorAll('[data-ytfc-hidden]').length === 2).catch(async error => {
            console.error('Age diagnostics:', await agePage.evaluate(() => ({ url: location.href, hidden: [...document.querySelectorAll('[data-ytfc-hidden]')].map(n => ({ id: n.id, reasons: n.getAttribute('data-ytfc-hidden') })), metadata: [...document.querySelectorAll('yt-content-metadata-view-model')].map(n => n.outerHTML) })), await worker.evaluate(async () => ({ settings: await chrome.storage.local.get(), tabs: await chrome.tabs.query({ active: true, currentWindow: true }) })));
            throw error;
        });
        assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('oldVideoThreshold')).oldVideoThreshold), 90);
        await agePopup.screenshot({ path: path.join(root, 'dist', 'age-presets-ru-preview.png'), fullPage: true, animations: 'disabled' });
        await agePopup.locator('#oldVideoThreshold').selectOption('365');
        await agePopup.close();
        await agePage.waitForFunction(() => document.querySelectorAll('[data-ytfc-hidden]').length === 0);
        assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('oldVideoThreshold')).oldVideoThreshold), 365);
        await worker.evaluate(() => chrome.storage.local.set({ oldVideoThreshold: 90 }));
        await agePage.bringToFront();
        await agePage.waitForFunction(() => document.querySelectorAll('[data-ytfc-hidden]').length === 2);
        console.log('PASS: ready-made age presets apply immediately and survive closing the popup');
        await agePage.locator('#months [aria-label="9 месяцев назад"]').evaluate(node => { node.textContent = '2 дн. назад'; node.setAttribute('aria-label', '2 дня назад'); });
        await agePage.waitForFunction(() => document.querySelectorAll('[data-ytfc-hidden]').length === 1);
        const [ageTab] = await worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }));
        const versionBefore = await worker.evaluate(() => chrome.runtime.getManifest().version);
        await worker.evaluate(id => chrome.scripting.executeScript({ target: { tabId: id }, func: () => { globalThis.YTFC.CONTENT_REVISION = 1; globalThis.__YTFCContent.contentRevision = 1; } }), ageTab.id);
        const recovered = await worker.evaluate(id => feedBridge.request({ type: 'getFeedStatus', tabId: id }), ageTab.id);
        assert.equal(recovered.status.count, 1); assert.equal(recovered.status.contentRevision, await worker.evaluate(() => YTFC.CONTENT_REVISION));
        assert.equal(recovered.status.version, versionBefore);
        assert.equal(await agePage.locator('style[data-ytfc-style]').count(), 1);
        console.log('PASS: 90-day preset physically hides 1 year / 9 months despite appended statistics and inline-important display; fresh/boundary dates survive, and revision 1 is upgraded without a version bump');
        await agePage.goto('https://www.youtube.com/watch?v=scope-test');
        await agePage.waitForFunction(() => document.querySelector('#old') && document.querySelectorAll('[data-ytfc-hidden]').length === 0);
        const scopePopup = await context.newPage(); scopePopup.on('pageerror', error => errors.push(error.message));
        await scopePopup.goto(`chrome-extension://${extensionId}/popup.html`);
        await scopePopup.locator('#ageScopeWarning').waitFor({ state: 'visible' });
        await scopePopup.screenshot({ path: path.join(root, 'dist', 'age-scope-warning-ru-preview.png'), fullPage: true, animations: 'disabled' });
        await scopePopup.locator('#filterWatch').check();
        await agePage.waitForFunction(() => document.querySelector('#old').getAttribute('data-ytfc-hidden') === 'age');
        assert.equal(await agePage.locator('#old').isVisible(), false);
        await scopePopup.locator('#ageScopeWarning').waitFor({ state: 'hidden' });
        console.log('PASS: excluded recommendations show an explicit scope warning and hide old videos immediately when enabled');
        assert.deepEqual(errors, []);
        console.log('PASS: real service worker update checks, badge and persistent acknowledgement');
    } finally {
        if (context) await context.close();
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
