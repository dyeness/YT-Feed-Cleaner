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
    t.after(() => dom.window.close());
    let changes, message;
    const animations = [], media = { matches: !!visual.reducedMotion, listeners: [], addEventListener(event, listener) { this.listeners.push(listener); } };
    dom.window.matchMedia = () => media;
    if (initial.animateHiding) {
        dom.window.Element.prototype.getBoundingClientRect = () => ({ left: 20, top: visual.offscreen ? 2000 : 20, width: 320, height: 180, right: 340, bottom: visual.offscreen ? 2180 : 200 });
        dom.window.Element.prototype.animate = function (frames, options) {
            if (visual.throwAnimation) throw new Error('Animation failed');
            const animation = { node: this, frames, options, onfinish: null, cancelled: false, cancel() { this.cancelled = true; } };
            animations.push(animation); return animation;
        };
    }
    dom.window.chrome = {
        storage: { local: { get(defaults, callback) { callback({ ...defaults, ...initial }); } }, onChanged: { addListener(fn) { changes = fn; } } },
        runtime: { onMessage: { addListener(fn) { message = fn; } } }
    };
    dom.window.eval(source('shared.js')); dom.window.eval(source('dissolve.js')); dom.window.eval(source('content.js'));
    await settle();
    return {
        window: dom.window, doc: dom.window.document, animations,
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
test('removed cards are not retained in page statistics', async t => {
    const h = await setup(t, video({ href: '/shorts/a' }));
    h.doc.querySelector('ytd-rich-item-renderer').remove(); await settle();
    assert.equal(h.status().count, 0);
});
