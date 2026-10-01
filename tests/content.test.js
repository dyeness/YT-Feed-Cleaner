const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 130));
function video({ tag = 'ytd-rich-item-renderer', href = '/watch?v=abc', title = 'Ordinary video', metadata = '', extras = '', channel = '' } = {}) {
    return `<${tag}><a id="thumbnail" href="${href}"></a><a id="video-title" href="${href}">${title}</a><div id="metadata-line">${metadata}</div>${channel ? `<div id="channel-name"><a href="/@${channel}">${channel}</a></div>` : ''}${extras}</${tag}>`;
}
async function setup(t, html, initial = {}, url = 'https://www.youtube.com/', visual = {}) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => { dom.window.__YTFCContent?.dispose(); dom.window.close(); });
    if (visual.hidden) Object.defineProperty(dom.window.document, 'hidden', { value: true, configurable: true });
    let changes, message, connect;
    const animations = [], media = { matches: !!visual.reducedMotion, listeners: [], addEventListener(event, listener) { this.listeners.push(listener); } };
    dom.window.matchMedia = () => media;
    if (initial.animateHiding || visual.animations) {
        dom.window.Element.prototype.getBoundingClientRect = () => ({ left: 20, top: visual.offscreen ? 2000 : 20, width: 320, height: 180, right: 340, bottom: visual.offscreen ? 2180 : 200 });
        dom.window.Element.prototype.animate = function (frames, options) {
            if (visual.throwAnimation) throw new Error('Animation failed');
            const animation = { node: this, frames, options, onfinish: null, cancelled: false, cancel() { this.cancelled = true; } };
            animations.push(animation); return animation;
        };
    }
    dom.window.chrome = {
        storage: { local: { get(defaults, callback) { callback({ ...defaults, ...initial }); } }, onChanged: { addListener(fn) { changes = fn; } } },
        runtime: { onMessage: { addListener(fn) { message = fn; } }, onConnect: { addListener(fn) { connect = fn; }, removeListener() {} } }
    };
    dom.window.eval(source('shared.js')); dom.window.eval(source('dissolve.js')); dom.window.eval(source('content.js'));
    await settle();
    return {
        window: dom.window, doc: dom.window.document, animations,
        subscribe() {
            const messages = [], port = { name: 'ytfc-feed', postMessage(status) { messages.push(status); }, onDisconnect: { addListener() {} }, disconnect() {} };
            connect(port); return messages;
        },
        async motion(value) { media.matches = value; for (const listener of media.listeners) listener(); await settle(); },
        async change(values, area = 'local') { changes(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), area); await settle(); },
        status(type = 'feedStatus') { let result; message({ type }, {}, value => { result = value; }); return result; },
        async navigate(pathname) { dom.reconfigure({ url: `https://www.youtube.com${pathname}` }); dom.window.dispatchEvent(new dom.window.Event('yt-navigate-finish')); await settle(); }
    };
}
const hidden = card => card.hasAttribute('data-ytfc-hidden');

test('a title mentioning Mix or years ago is not a mix or publication date', async t => {
    const h = await setup(t, video({ title: 'Mix: what happened 10 years ago', metadata: '<span>100 views</span><span>2 days ago</span>' }), { oldVideoThreshold: 7 });
    assert.equal(hidden(h.doc.querySelector('ytd-rich-item-renderer')), false);
    assert.equal(h.status().count, 0);
});
test('an incidental RD link in the description does not hide a normal video', async t => {
    const h = await setup(t, video({ extras: '<div id="description"><a href="/watch?v=x&list=RDx">Music mix</a></div>' }));
    assert.equal(h.status().count, 0);
});
test('even a primary watch RD URL needs actual mix evidence', async t => {
    const h = await setup(t, video({ href: '/watch?v=abc&list=RDabc', title: 'Mix' }));
    assert.equal(h.status().count, 0);
});
test('real radio mix hides and restores without destroying inline styles', async t => {
    const h = await setup(t, '<ytd-radio-renderer style="display:flex"><a id="thumbnail" href="/watch?v=abc&list=RDabc"></a></ytd-radio-renderer>');
    const card = h.doc.querySelector('ytd-radio-renderer');
    assert.equal(hidden(card), true); assert.equal(card.style.display, 'flex');
    await h.change({ hideJams: false });
    assert.equal(hidden(card), false); assert.equal(card.style.display, 'flex');
});
test('recycled cards restore after their URL/type changes', async t => {
    const h = await setup(t, video({ href: '/shorts/old' }));
    const card = h.doc.querySelector('ytd-rich-item-renderer');
    assert.equal(hidden(card), true);
    card.querySelectorAll('a').forEach(a => a.setAttribute('href', '/watch?v=new'));
    await settle(); assert.equal(hidden(card), false);
});
test('only dedicated progress overlays with percent width match watched filter', async t => {
    const h = await setup(t, video({ extras: '<div id="progress" style="width:90%"></div><ytd-thumbnail-overlay-resume-playback-renderer><div id="progress" style="width:90px"></div></ytd-thumbnail-overlay-resume-playback-renderer>' }), { hideWatched: true });
    const bar = h.doc.querySelector('ytd-thumbnail-overlay-resume-playback-renderer #progress');
    assert.equal(h.status().count, 0);
    bar.style.width = '75%'; await settle(); assert.equal(h.status().count, 1);
    bar.style.width = '10%'; await settle(); assert.equal(h.status().count, 0);
});
test('modern watched overlay with capital Y and Modern suffix reaches the filter', async t => {
    const h = await setup(t, video({ extras: '<yt-thumbnail-overlay-progress-bar-view-model><div class="YtThumbnailOverlayProgressBarHostWatchedProgressBar"><div class="YtThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern" style="width:85%"></div></div></yt-thumbnail-overlay-progress-bar-view-model>' }), { hideWatched: true });
    assert.equal(h.status().count, 1);
    assert.equal(h.status().counts.watched, 1);
});
test('modern watched lockup with camelCase thumbnail link is classified as a video', async t => {
    const html = '<ytd-rich-item-renderer><yt-lockup-view-model><a class="ytLockupViewModelContentImage" href="/watch?v=watched"></a><h3 class="ytLockupMetadataViewModelTitle"><a href="/watch?v=watched">Watched video</a></h3><yt-thumbnail-overlay-progress-bar-view-model><div class="YtThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern" style="width:85%"></div></yt-thumbnail-overlay-progress-bar-view-model></yt-lockup-view-model></ytd-rich-item-renderer>';
    const h = await setup(t, html, { hideWatched: true });
    assert.equal(h.status().count, 1);
    assert.equal(hidden(h.doc.querySelector('ytd-rich-item-renderer')), true);
    assert.equal(hidden(h.doc.querySelector('yt-lockup-view-model')), false);
    assert.equal(h.status().items[0].title, 'Watched video');
});
test('all known modern watched fills preserve threshold boundaries and react to progress updates', async t => {
    for (const className of ['ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment', 'YtThumbnailOverlayProgressBarHostWatchedProgressBarSegment', 'ytThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern', 'YtThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern']) {
        const h = await setup(t, video({ extras: `<yt-thumbnail-overlay-progress-bar-view-model><div style="width:100%"><div class="${className}" style="width:69.9%"></div></div></yt-thumbnail-overlay-progress-bar-view-model>` }), { hideWatched: true });
        const bar = h.doc.querySelector(`.${className}`);
        assert.equal(h.status().count, 0, className);
        bar.style.width = '70%'; await settle(); assert.equal(h.status().counts.watched, 1, className);
        await h.change({ watchThreshold: 80 }); assert.equal(h.status().count, 0, className);
        bar.style.width = '100%'; await settle(); assert.equal(h.status().count, 1, className);
        bar.style.width = '0%'; await settle(); assert.equal(h.status().count, 0, className);
    }
});
test('modern thumbnail track, player progress and pixel widths are never mistaken for watched percent', async t => {
    const extras = '<yt-thumbnail-overlay-progress-bar-view-model><div class="YtThumbnailOverlayProgressBarHostWatchedProgressBar" style="width:100%"><div class="YtThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern" style="width:80px"></div></div></yt-thumbnail-overlay-progress-bar-view-model><div class="ytp-play-progress" style="width:100%"></div>';
    const h = await setup(t, video({ extras }), { hideWatched: true });
    assert.equal(h.status().count, 0);
});
test('modern watched filtering respects scope and channel exceptions', async t => {
    const h = await setup(t, video({ channel: 'creator', extras: '<div class="YtThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern" style="width:100%"></div>' }), { hideWatched: true }, 'https://www.youtube.com/results?search_query=test');
    assert.equal(h.status().count, 0);
    await h.change({ filterSearch: true }); assert.equal(h.status().count, 1);
    await h.change({ allowedChannels: '@creator' }); assert.equal(h.status().count, 0);
});
test('changing a modern watched lockup to a new unwatched video restores its rich wrapper', async t => {
    const html = '<ytd-rich-item-renderer><yt-lockup-view-model><a class="YtLockupViewModelContentImage" href="/watch?v=old"></a><h3 class="YtLockupMetadataViewModelTitle"><a href="/watch?v=old">Old</a></h3><div class="YtThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern" style="width:100%"></div></yt-lockup-view-model></ytd-rich-item-renderer>';
    const h = await setup(t, html, { hideWatched: true });
    assert.equal(h.status().count, 1);
    h.doc.querySelectorAll('a').forEach(anchor => anchor.setAttribute('href', '/watch?v=new'));
    h.doc.querySelector('.YtThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern').remove();
    await settle(); assert.equal(h.status().count, 0); assert.equal(hidden(h.doc.querySelector('ytd-rich-item-renderer')), false);
});
test('60 day age threshold hides one-year and nine-month camelCase publication metadata', async t => {
    const card = (id, age, prefix) => `<ytd-rich-item-renderer><yt-lockup-view-model><a class="ytLockupViewModelContentImage" href="/watch?v=${id}"></a><h3 class="ytLockupMetadataViewModelTitle">Fresh title</h3><yt-content-metadata-view-model><span class="${prefix}ContentMetadataViewModelMetadataText">${age}</span></yt-content-metadata-view-model></yt-lockup-view-model></ytd-rich-item-renderer>`;
    const h = await setup(t, card('year', '1 год назад', 'yt') + card('months', '9 месяцев назад', 'Yt') + card('fresh', '2 дня назад', 'yt'), { oldVideoThreshold: 60 });
    assert.equal(h.status().count, 2); assert.equal(h.status().counts.age, 2);
    assert.equal(hidden(h.doc.querySelectorAll('ytd-rich-item-renderer')[2]), false);
});
test('publication dates in modern metadata components and bullet-separated rows are recognized', async t => {
    const h = await setup(t, video({ extras: '<yt-content-metadata-view-model><div class="ytContentMetadataViewModelMetadataRow"><span class="yt-core-attributed-string">1 год назад</span></div></yt-content-metadata-view-model>' }) + video({ href: '/watch?v=months', extras: '<span class="yt-content-metadata-view-model__metadata-text">125 тыс. просмотров • 9 месяцев назад</span>' }), { oldVideoThreshold: 60 });
    assert.equal(h.status().count, 2); assert.equal(h.status().counts.age, 2);
});
test('actual compact metadata shape hides nine months and one year at 60 days and restores updates', async t => {
    const field = (text, label) => `<span class="ytAttributedStringHost ytContentMetadataViewModelMetadataText ytContentMetadataViewModelMetadataTextLastPart" role="text" aria-label="${label}">${text}</span>`;
    const metadata = value => `<yt-content-metadata-view-model><div class="ytContentMetadataViewModelMetadataRow" role="group"><span class="ytContentMetadataViewModelMetadataText">YouTube</span><span class="ytContentMetadataViewModelMetadataText" aria-label="316 тысяч просмотров">316 тыс.</span>${value}</div></yt-content-metadata-view-model>`;
    const h = await setup(t, video({ extras: metadata(field('9 мес. назад', '9 месяцев назад')) }) + video({ href: '/watch?v=year', extras: metadata(field('1 г. назад', '1 год назад')) }), { oldVideoThreshold: 60 });
    assert.equal(h.status().counts.age, 2);
    const date = h.doc.querySelector('[aria-label="9 месяцев назад"]');
    date.textContent = '2 дн. назад'; date.setAttribute('aria-label', '2 дня назад');
    await settle(); assert.equal(h.status().counts.age, 1);
    await h.change({ oldVideoThreshold: 365 }); assert.equal(h.status().count, 0);
});
test('only the publication field accessibility label is read, never card or thumbnail labels', async t => {
    const h = await setup(t, video({ extras: '<yt-content-metadata-view-model><span class="ytContentMetadataViewModelMetadataText" aria-label="9 месяцев назад">9 мес.</span></yt-content-metadata-view-model>' }) + video({ href: '/watch?v=fresh', title: '1 год назад', extras: '<span aria-label="1 год назад">Описание</span><div id="description">9 месяцев назад</div>' }), { oldVideoThreshold: 60 });
    h.doc.querySelectorAll('a').forEach(anchor => anchor.setAttribute('aria-label', '1 год назад'));
    await settle(); assert.equal(h.status().count, 1);
});
test('channel names resembling publication dates never override the real fresh date', async t => {
    const h = await setup(t, video({ title: '1 год назад', extras: '<yt-content-metadata-view-model><div class="ytContentMetadataViewModelMetadataRow"><span class="ytContentMetadataViewModelMetadataText">9 месяцев назад</span><span class="ytContentMetadataViewModelMetadataText">100 просмотров</span><span class="ytContentMetadataViewModelMetadataText" aria-label="2 дня назад">2 дн. назад</span></div></yt-content-metadata-view-model>' }), { oldVideoThreshold: 60 });
    assert.equal(h.status().count, 0);
});
test('same-version recovery replaces a stale content revision rather than keeping old date code', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }));
    const old = h.window.__YTFCContent; old.contentRevision = 0;
    h.window.eval(source('content.js'));
    assert.equal(old.alive, false); assert.notEqual(h.window.__YTFCContent, old);
    assert.equal(h.doc.querySelectorAll('style[data-ytfc-style]').length, 1);
    assert.equal(h.status().contentRevision, h.window.YTFC.CONTENT_REVISION);
});
test('publication metadata updates hide and restore a reused card', async t => {
    const h = await setup(t, video({ metadata: '<span>999 views</span><span>2 years ago</span>' }), { oldVideoThreshold: 30 });
    assert.equal(h.status().count, 1);
    h.doc.querySelector('#metadata-line span:last-child').textContent = '1 day ago';
    await settle(); assert.equal(h.status().count, 0);
});
test('modern nested lockup metadata belongs to its rich-item wrapper', async t => {
    const html = `<ytd-rich-item-renderer><yt-lockup-view-model><a class="yt-lockup-view-model__content-image" href="/watch?v=abc"></a><h3 class="yt-lockup-metadata-view-model__title"><a href="/watch?v=abc">Fresh title</a></h3><div class="yt-content-metadata-view-model__metadata-row"><a href="/@creator">Creator</a><span class="yt-content-metadata-view-model__metadata-text">3 years ago</span></div><span class="yt-badge-shape__text">20:00</span></yt-lockup-view-model></ytd-rich-item-renderer>`;
    const h = await setup(t, html, { oldVideoThreshold: 30 });
    assert.equal(hidden(h.doc.querySelector('ytd-rich-item-renderer')), true);
    assert.equal(hidden(h.doc.querySelector('yt-lockup-view-model')), false);
    assert.equal(h.status().count, 1);
    await h.change({ allowedChannels: '@creator' }); assert.equal(h.status().count, 0);
});
test('modern RD collection identity is accepted only with a primary RD URL', async t => {
    const html = '<ytd-rich-item-renderer><yt-lockup-view-model content-id="RDabc"><a class="yt-lockup-view-model__content-image" href="/watch?v=abc&list=RDabc"></a></yt-lockup-view-model></ytd-rich-item-renderer>';
    const h = await setup(t, html);
    assert.equal(h.status().count, 1);
    h.doc.querySelector('a').setAttribute('href', '/watch?v=normal');
    await settle(); assert.equal(h.status().count, 0);
});
test('SPA navigation recalculates home-only filters', async t => {
    const h = await setup(t, video({ metadata: '<span>2 years ago</span>' }), { oldVideoThreshold: 7 });
    assert.equal(h.status().count, 1);
    await h.navigate('/results?search_query=x'); assert.equal(h.status().count, 0);
    await h.change({ filterSearch: true }); assert.equal(h.status().count, 1);
});
test('temporary preview restores cards and continues tracking mutations', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }));
    assert.equal(h.status().count, 1);
    assert.equal(h.status('togglePreview').paused, true); assert.equal(h.status().count, 0);
    h.doc.body.insertAdjacentHTML('beforeend', video({ href: '/shorts/b' })); await settle();
    assert.equal(h.status().count, 0);
    assert.equal(h.status('togglePreview').count, 2);
});
test('update storage and sync settings do not affect local filter state', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }));
    await h.change({ updateAvailable: true }); assert.equal(h.status().count, 1);
    await h.change({ hideShortsHome: false }, 'sync'); assert.equal(h.status().count, 1);
    await h.change({ hideShortsHome: false }); assert.equal(h.status().count, 0);
});
test('Shorts shelf preserves channel exceptions instead of hiding the parent', async t => {
    const html = `<ytd-rich-section-renderer><ytd-rich-shelf-renderer is-shorts>${video({ href: '/shorts/a', channel: 'safe' })}${video({ href: '/shorts/b', channel: 'blocked' })}</ytd-rich-shelf-renderer></ytd-rich-section-renderer>`;
    const h = await setup(t, html, { allowedChannels: '@safe' });
    assert.equal(hidden(h.doc.querySelector('ytd-rich-section-renderer')), false);
    const cards = h.doc.querySelectorAll('ytd-rich-item-renderer'); assert.equal(hidden(cards[0]), false); assert.equal(hidden(cards[1]), true);
});
test('live title is not a live badge; explicit badge changes trigger filtering', async t => {
    const h = await setup(t, video({ title: 'LIVE', extras: '<ytd-badge-supported-renderer>HD</ytd-badge-supported-renderer>' }), { hideLive: true });
    assert.equal(h.status().count, 0);
    h.doc.querySelector('ytd-badge-supported-renderer').textContent = 'LIVE'; await settle();
    assert.equal(h.status().count, 1);
});
test('ambiguous premiere badges never hide already released videos', async t => {
    const h = await setup(t, video({ extras: '<ytd-badge-supported-renderer>PREMIERE</ytd-badge-supported-renderer>' }), { hideUpcoming: true });
    assert.equal(h.status().count, 0);
    h.doc.querySelector('ytd-rich-item-renderer').insertAdjacentHTML('beforeend', '<ytd-thumbnail-overlay-upcoming-event-reminder-renderer></ytd-thumbnail-overlay-upcoming-event-reminder-renderer>');
    await settle(); assert.equal(h.status().count, 1);
});
test('opt-in dust finishes hiding, removes particles and preserves original styles', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), { animateHiding: true, animationSpeed: 'slow' });
    const card = h.doc.querySelector('ytd-rich-item-renderer');
    assert.equal(hidden(card), false); assert.equal(card.hasAttribute('data-ytfc-dissolving'), true);
    assert.equal(h.animations.length, 49); assert.equal(h.status().count, 1);
    h.animations.at(-1).onfinish();
    assert.equal(hidden(card), true); assert.equal(card.hasAttribute('data-ytfc-dissolving'), false);
    assert.equal(h.doc.querySelector('[data-ytfc-dust]'), null);
    assert.equal(card.getAttribute('style'), null);
});
test('turning animation off finishes pending hiding immediately without extra effects', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), { animateHiding: true });
    await h.change({ animateHiding: false });
    assert.equal(hidden(h.doc.querySelector('ytd-rich-item-renderer')), true);
    assert.equal(h.doc.querySelector('[data-ytfc-dust]'), null);
    assert.ok(h.animations.every(animation => animation.cancelled));
});
test('disabling filtering mid-effect restores cards and makes stale callbacks harmless', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), { animateHiding: true });
    const finish = h.animations.at(-1).onfinish;
    await h.change({ enabled: false }); finish();
    assert.equal(h.status().count, 0);
    assert.equal(h.doc.querySelector('[data-ytfc-hidden], [data-ytfc-dissolving], [data-ytfc-dust]'), null);
});
test('a recycled card is never hidden by an earlier animation callback', async t => {
    const h = await setup(t, video({ href: '/shorts/old' }), { animateHiding: true });
    const finish = h.animations.at(-1).onfinish;
    h.doc.querySelectorAll('a').forEach(a => a.setAttribute('href', '/watch?v=new'));
    await settle(); finish();
    assert.equal(h.status().count, 0); assert.equal(h.doc.querySelector('[data-ytfc-dust]'), null);
});
test('reduced-motion preference is respected, configurable, and reacts during an effect', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), { animateHiding: true }, undefined, { reducedMotion: true });
    assert.equal(h.animations.length, 0); assert.equal(h.status().count, 1);
    await h.change({ enabled: false, respectReducedMotion: false });
    await h.change({ enabled: true });
    assert.equal(h.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-ytfc-dissolving'), true);
    await h.change({ respectReducedMotion: true });
    assert.equal(h.doc.querySelector('[data-ytfc-dissolving], [data-ytfc-dust]'), null);
});
test('motion change during animation falls back to normal immediate hiding', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), { animateHiding: true });
    await h.motion(true);
    assert.equal(hidden(h.doc.querySelector('ytd-rich-item-renderer')), true);
    assert.equal(h.doc.querySelector('[data-ytfc-dust]'), null);
});
test('offscreen cards hide immediately without wasting animation resources', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), { animateHiding: true }, undefined, { offscreen: true });
    assert.equal(h.animations.length, 0); assert.equal(h.status().count, 1);
});
test('visual errors never prevent hiding and clean up the effect layer', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), { animateHiding: true }, undefined, { throwAnimation: true });
    assert.equal(hidden(h.doc.querySelector('ytd-rich-item-renderer')), true);
    assert.equal(h.doc.querySelector('[data-ytfc-dust]'), null);
});
test('concurrent effects are capped and scrolling completes them with no leftovers', async t => {
    const h = await setup(t, Array.from({ length: 6 }, (_, i) => video({ href: `/shorts/${i}` })).join(''), { animateHiding: true });
    assert.equal(h.doc.querySelectorAll('[data-ytfc-dissolving]').length, 4);
    assert.equal(h.doc.querySelectorAll('[data-ytfc-hidden]').length, 2);
    Object.defineProperty(h.window, 'scrollY', { value: 100, configurable: true });
    h.window.dispatchEvent(new h.window.Event('scroll'));
    assert.equal(h.doc.querySelectorAll('[data-ytfc-hidden]').length, 6);
    assert.equal(h.doc.querySelector('[data-ytfc-dust]'), null);
});
test('preview cancels particle effects and does not restart until resumed', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), { animateHiding: true });
    assert.equal(h.status('togglePreview').count, 0);
    assert.equal(h.doc.querySelector('[data-ytfc-dust]'), null);
    assert.equal(h.doc.querySelector('[data-ytfc-dissolving]'), null);
});
test('enabling animation replays cards already hidden by the cleaner', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), {}, undefined, { animations: true });
    assert.equal(hidden(h.doc.querySelector('ytd-rich-item-renderer')), true);
    await h.change({ animateHiding: true });
    assert.equal(h.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-ytfc-dissolving'), true);
    assert.equal(h.animations.length, 49);
});
test('overriding reduced motion replays existing matches instead of requiring new cards', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), { animateHiding: true }, undefined, { reducedMotion: true });
    assert.equal(h.animations.length, 0); assert.equal(h.status().animation, 'reduced');
    await h.change({ respectReducedMotion: false });
    assert.equal(h.animations.length, 49); assert.equal(h.status().animation, 'on');
});
test('background-tab replay starts on return to YouTube instead of silently disappearing', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), { animateHiding: true }, undefined, { hidden: true });
    assert.equal(h.status().animation, 'background'); assert.equal(h.animations.length, 0);
    Object.defineProperty(h.doc, 'hidden', { value: false, configurable: true });
    h.doc.dispatchEvent(new h.window.Event('visibilitychange'));
    assert.equal(h.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-ytfc-dissolving'), true);
});
test('carousel and synthetic scroll events do not cancel particle effects', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }), { animateHiding: true });
    h.doc.querySelector('ytd-rich-item-renderer').dispatchEvent(new h.window.Event('scroll', { bubbles: true }));
    h.window.dispatchEvent(new h.window.Event('scroll'));
    assert.equal(h.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-ytfc-dissolving'), true);
});
test('recovery injection is idempotent and leaves only one script instance and stylesheet', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }));
    const original = h.window.__YTFCContent;
    h.window.eval(source('content.js'));
    assert.equal(h.window.__YTFCContent, original);
    assert.equal(h.doc.querySelectorAll('style[data-ytfc-style]').length, 1);
    assert.equal(h.status().protocol, 2);
});
test('live statistics subscribers receive DOM changes, with no polling', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }));
    const messages = h.subscribe(); await settle();
    assert.equal(messages.at(-1).count, 1);
    h.doc.body.insertAdjacentHTML('beforeend', video({ href: '/shorts/b' })); await settle();
    assert.equal(messages.at(-1).count, 2);
});
test('replay command rechecks filters and never animates non-matching videos', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }) + video({ href: '/watch?v=normal' }), { animateHiding: true });
    h.animations.at(-1).onfinish();
    h.status('replayAnimation');
    assert.equal(h.doc.querySelectorAll('[data-ytfc-dissolving]').length, 1);
    assert.equal(h.status().count, 1);
});
test('removed cards are not retained in page statistics', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }));
    h.doc.querySelector('ytd-rich-item-renderer').remove(); await settle();
    assert.equal(h.status().count, 0);
});
