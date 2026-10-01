/* DOM adapter: only explicit card metadata is passed to the pure filter engine. */
(() => {
    'use strict';
    const F = globalThis.YTFC;
    const version = chrome.runtime.getManifest?.().version || 'test';
    const existing = globalThis.__YTFCContent;
    if (existing?.version === version && existing.contentRevision === F.CONTENT_REVISION && existing.alive) return;
    existing?.dispose?.();
    // Drop stale extension-owned markers left by an invalidated content world.
    document.querySelectorAll('[data-ytfc-hidden], [data-ytfc-dissolving]').forEach(element => {
        element.removeAttribute('data-ytfc-hidden'); element.removeAttribute('data-ytfc-dissolving');
    });
    document.querySelectorAll('[data-ytfc-dust], style[data-ytfc-style]').forEach(element => element.remove());
    let alive = true, scheduleTimer = null, replayRequested = false, lastPublished = '';
    const ports = new Set(), cleanup = [];
    let resolveReady;
    const bootReady = new Promise(resolve => { resolveReady = resolve; });
    const CARD = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-radio-renderer, ytd-compact-radio-renderer, ytd-playlist-renderer, ytd-compact-playlist-renderer, yt-lockup-view-model, ytd-reel-item-renderer, yt-shorts-lockup-view-model';
    const PRIMARY = 'a#thumbnail[href], a#video-title[href], a#video-title-link[href], a.yt-lockup-view-model__content-image[href], a.ytLockupViewModelContentImage[href], a.YtLockupViewModelContentImage[href], .yt-lockup-metadata-view-model__title a[href], .ytLockupMetadataViewModelTitle a[href], .YtLockupMetadataViewModelTitle a[href], a.shortsLockupViewModelHostEndpoint[href]';
    // CSS class names are case-sensitive. YouTube now uses capital Yt and
    // SegmentModern as well as the older yt-prefixed watched-fill variants.
    const WATCHED_FILL = 'ytd-thumbnail-overlay-resume-playback-renderer #progress, .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment, .YtThumbnailOverlayProgressBarHostWatchedProgressBarSegment, .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern, .YtThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern';
    const METADATA_TEXT = '.yt-content-metadata-view-model__metadata-text, .ytContentMetadataViewModelMetadataText, .YtContentMetadataViewModelMetadataText';
    const METADATA_ROW = '.yt-content-metadata-view-model__metadata-row, .ytContentMetadataViewModelMetadataRow, .YtContentMetadataViewModelMetadataRow';
    let settings = F.normalizeSettings(), ready = false, scheduled = false, temporarilyPaused = false;
    const hidden = new Map();
    const dust = globalThis.YTFCDust.createController();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const style = document.createElement('style');
    style.setAttribute('data-ytfc-style', '');
    style.textContent = '[data-ytfc-hidden] { display: none !important; } [data-ytfc-dissolving] { pointer-events: none !important; }';
    document.documentElement.appendChild(style);

    function ownNodes(card, selector) {
        return [...card.querySelectorAll(selector)].filter(node => {
            let owner = node.closest(CARD);
            while (owner?.parentElement?.closest(CARD)) owner = owner.parentElement.closest(CARD);
            return owner === card;
        });
    }
    function primaryUrl(card) {
        for (const link of ownNodes(card, PRIMARY)) {
            try {
                const url = new URL(link.getAttribute('href'), location.origin);
                if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com') return url;
            } catch { /* A partially rendered link is unknown, not a match. */ }
        }
        // Shorts view models sometimes use an unstyled primary anchor.
        if (card.matches('ytd-reel-item-renderer, yt-shorts-lockup-view-model')) {
            const link = card.querySelector('a[href^="/shorts/"]');
            if (link) return new URL(link.getAttribute('href'), location.origin);
        }
        return null;
    }
    function channelFacts(card) {
        const links = ownNodes(card, '#channel-name a[href], ytd-channel-name a[href], .yt-content-metadata-view-model__metadata-row a[href]');
        for (const link of links) {
            try {
                const url = new URL(link.getAttribute('href'), location.origin);
                if (!['www.youtube.com', 'youtube.com'].includes(url.hostname)) continue;
                const path = decodeURIComponent(url.pathname).replace(/\/$/, '');
                if (!/^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)$/.test(path)) continue;
                return { name: link.textContent.trim(), path, handle: path.startsWith('/@') ? path.slice(1) : '' };
            } catch { /* Unknown channel. */ }
        }
        return {};
    }
    function factsFor(card) {
        const url = primaryUrl(card);
        const titleNode = ownNodes(card, '#video-title, #video-title-link, .yt-lockup-metadata-view-model__title, .ytLockupMetadataViewModelTitle, .YtLockupMetadataViewModelTitle, .shortsLockupViewModelHostMetadataTitle')[0];
        const title = titleNode?.textContent.trim() || '';
        const badges = ownNodes(card, 'ytd-badge-supported-renderer, yt-badge-view-model, .yt-thumbnail-overlay-badge-view-model__badge-text, ytd-thumbnail-overlay-time-status-renderer, .yt-badge-shape__text');
        const labels = badges.map(node => F.normalizeText(node.textContent));
        const radio = card.matches('ytd-radio-renderer, ytd-compact-radio-renderer') || !!card.querySelector('ytd-radio-renderer, ytd-compact-radio-renderer');
        const rd = !!url?.searchParams.get('list')?.startsWith('RD');
        const mixBadge = labels.some(label => ['mix', 'my mix', 'джем', 'мой джем'].includes(label));
        const playlistOverlay = ownNodes(card, 'ytd-thumbnail-overlay-side-panel-renderer, ytd-thumbnail-overlay-bottom-panel-renderer, .yt-thumbnail-overlay-collection-view-model')[0];
        const mixIdentity = card.getAttribute('content-id') || ownNodes(card, '[content-id]')[0]?.getAttribute('content-id');
        const mix = rd && (radio || mixBadge || !!playlistOverlay || url.pathname === '/playlist' || mixIdentity?.startsWith('RD'));
        const shorts = url?.pathname.startsWith('/shorts/') || card.matches('ytd-reel-item-renderer, yt-shorts-lockup-view-model');
        const playlist = !!url && (url.pathname === '/playlist' || radio || card.matches('ytd-playlist-renderer, ytd-compact-playlist-renderer'));
        const video = !!url && ((url.pathname === '/watch' && !!url.searchParams.get('v') && !mix && !radio) || shorts);
        const live = labels.some(label => ['live', 'live now', 'в эфире', 'прямой эфир'].includes(label)) || !!ownNodes(card, '[overlay-style="LIVE"], .badge-style-type-live-now')[0];
        const upcoming = labels.some(label => ['upcoming', 'запланировано'].includes(label)) || !!ownNodes(card, '[overlay-style="UPCOMING"], ytd-thumbnail-overlay-upcoming-event-reminder-renderer')[0];
        let age = null;
        // Only publication metadata. Never use card/title/thumbnail aria-labels.
        const metadata = ownNodes(card, `#metadata-line span, #metadata-line yt-formatted-string, ${METADATA_TEXT}, yt-content-metadata-view-model span, ${METADATA_ROW}`);
        const accessibleAges = [], visibleAges = [];
        for (const item of metadata) {
            if (item.closest('a, #channel-name, ytd-channel-name') || item.querySelector('a')) continue;
            const row = item.closest(METADATA_ROW), host = item.closest('yt-content-metadata-view-model');
            const rows = host ? [...host.querySelectorAll(METADATA_ROW)] : [];
            if (row && rows.length > 1 && row !== rows.at(-1)) continue; // Channel-name row.
            const fields = row ? [...row.querySelectorAll(METADATA_TEXT)] : [];
            if (fields.length && item === row) continue; // Inspect fields, not their concatenated names.
            const field = item.closest(METADATA_TEXT);
            if (field && fields.length > 1 && field !== fields.at(-1)) continue;
            const visibleAge = F.parsePublicationAge(item.textContent);
            // Current YouTube emits "9 мес. назад" with a full publication-date
            // label on that specific metadata field, not on the video card.
            const accessibleAge = F.parseAge(item.getAttribute('aria-label'));
            if (accessibleAge !== null) {
                accessibleAges.push(visibleAge === null ? accessibleAge : Math.min(visibleAge, accessibleAge));
            } else if (visibleAge !== null) visibleAges.push(visibleAge);
        }
        const publicationAges = accessibleAges.length ? accessibleAges : visibleAges;
        if (publicationAges.length) age = Math.min(...publicationAges);
        let duration = null;
        for (const badge of ownNodes(card, 'ytd-thumbnail-overlay-time-status-renderer #text, .yt-thumbnail-overlay-badge-view-model__badge-text, .yt-badge-shape__text')) {
            const parsed = F.parseDuration(badge.textContent);
            if (parsed !== null) { duration = parsed; break; }
        }
        let progress = null;
        for (const bar of ownNodes(card, WATCHED_FILL)) {
            const parsed = F.parseProgress(bar.style.width);
            if (parsed !== null) { progress = parsed; break; }
        }
        return { title, channel: channelFacts(card), mix, shorts: !!shorts, playlist, video, live, upcoming, age, duration, progress };
    }
    function context() {
        if (location.pathname === '/') return 'home';
        if (location.pathname === '/results') return 'search';
        if (location.pathname === '/watch') return 'watch';
        if (location.pathname === '/feed/subscriptions') return 'subscriptions';
        return 'other';
    }
    function setHidden(element, reasons, title = '', identity = '') {
        let previous = hidden.get(element);
        if (previous && previous.identity !== identity) {
            dust.cancel(element);
            element.removeAttribute('data-ytfc-hidden');
            hidden.delete(element);
            previous = null;
        }
        if (reasons.length) {
            const entry = previous || { reasons, title, identity, phase: 'pending' };
            entry.reasons = reasons; entry.title = title;
            hidden.set(element, entry);
            const animate = settings.animateHiding && !(settings.respectReducedMotion && reducedMotion?.matches);
            if (!previous) {
                if (animate && document.hidden) replayRequested = true;
                if (!animate || !dust.start(element, settings, () => {
                    if (hidden.get(element) !== entry) return;
                    entry.phase = 'hidden';
                    // Reclassify the current DOM before final hiding: never trust an old timer.
                    processDOM();
                })) entry.phase = 'hidden';
            } else if (!animate && entry.phase === 'pending') {
                dust.cancel(element); entry.phase = 'hidden';
            }
            if (entry.phase === 'hidden') {
                const value = reasons.join(',');
                if (element.getAttribute('data-ytfc-hidden') !== value) element.setAttribute('data-ytfc-hidden', value);
            }
        } else {
            dust.cancel(element);
            if (element.hasAttribute('data-ytfc-hidden')) element.removeAttribute('data-ytfc-hidden');
            hidden.delete(element);
        }
    }
    function processDOM() {
        scheduled = false;
        if (!ready || !alive) return;
        const page = context();
        for (const element of hidden.keys()) {
            if (!element.isConnected) { dust.cancel(element); hidden.delete(element); }
            else if (!element.matches(CARD + ', ytd-rich-section-renderer, ytd-reel-shelf-renderer')) setHidden(element, []);
        }
        const active = settings.enabled && !temporarilyPaused;
        document.querySelectorAll('ytd-rich-section-renderer, ytd-reel-shelf-renderer').forEach(shelf => {
            const isShorts = shelf.matches('ytd-reel-shelf-renderer') || !!shelf.querySelector('ytd-rich-shelf-renderer[is-shorts]');
            const enabled = page === 'home' ? settings.hideShortsHome : page === 'search' ? settings.hideShortsSearch : settings.hideShortsOther;
            // Do not bypass channel exceptions by hiding an entire shelf.
            setHidden(shelf, active && isShorts && enabled && !F.lines(settings.allowedChannels).length ? ['shorts'] : [], '', location.pathname);
        });
        document.querySelectorAll(CARD).forEach(card => {
            // A rich-item wrapper owns nested lockups; never hide both parent and child.
            if (card.parentElement?.closest(CARD)) { setHidden(card, []); return; }
            const facts = factsFor(card);
            setHidden(card, active ? F.classify(facts, settings, page) : [], facts.title, `${primaryUrl(card)?.href || ''}|${facts.title}`);
        });
        publishStatus();
    }
    function schedule() {
        if (alive && !scheduled) { scheduled = true; scheduleTimer = setTimeout(processDOM, 80); }
    }
    function animationState() {
        if (!settings.animateHiding) return 'off';
        if (settings.respectReducedMotion && reducedMotion?.matches) return 'reduced';
        if (document.hidden) return 'background';
        return 'on';
    }
    function statusSnapshot() {
        const visibleHidden = [...hidden].filter(([element]) => element.isConnected && !element.parentElement?.closest('[data-ytfc-hidden], [data-ytfc-dissolving]'));
        const counts = {};
        for (const [, item] of visibleHidden) for (const reason of item.reasons) counts[reason] = (counts[reason] || 0) + 1;
        return { protocol: 2, version, contentRevision: F.CONTENT_REVISION, count: visibleHidden.length, counts, paused: temporarilyPaused, context: context(), animation: animationState(), items: visibleHidden.slice(0, 30).map(([, item]) => ({ title: item.title, reasons: item.reasons })) };
    }
    function publishStatus() {
        if (!ports.size) return;
        const status = statusSnapshot(), signature = JSON.stringify(status);
        if (signature === lastPublished) return;
        lastPublished = signature;
        for (const port of ports) try { port.postMessage(status); } catch { ports.delete(port); }
    }
    function resetHidden() {
        dust.cancelAll();
        for (const element of hidden.keys()) element.removeAttribute('data-ytfc-hidden');
        hidden.clear();
    }
    function requestReplay() {
        if (!settings.animateHiding || temporarilyPaused || !settings.enabled) return;
        if (document.hidden) { replayRequested = true; return; }
        replayRequested = false;
        resetHidden();
        processDOM();
    }
    chrome.storage.local.get(F.DEFAULTS, data => {
        if (!alive) return;
        settings = F.normalizeSettings(data); ready = true; processDOM(); resolveReady();
    });
    const onStorage = (changes, area) => {
        if (!alive || area !== 'local' || !Object.keys(changes).some(key => key in F.DEFAULTS)) return;
        const next = { ...settings }, previouslyAnimated = settings.animateHiding;
        const previouslyReduced = settings.respectReducedMotion && reducedMotion?.matches;
        for (const [key, change] of Object.entries(changes)) if (key in F.DEFAULTS) next[key] = change.newValue;
        settings = F.normalizeSettings(next);
        if (!settings.animateHiding) replayRequested = false;
        if (settings.animateHiding && (!previouslyAnimated || (previouslyReduced && !settings.respectReducedMotion))) requestReplay();
        processDOM();
    };
    chrome.storage.onChanged.addListener(onStorage);
    cleanup.push(() => chrome.storage.onChanged.removeListener?.(onStorage));
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['href', 'style', 'class', 'title', 'aria-label', 'is-shorts', 'overlay-style', 'content-id']
    });
    function listen(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        cleanup.push(() => target.removeEventListener(event, handler, options));
    }
    ['yt-navigate-finish', 'yt-page-data-updated', 'popstate'].forEach(event => listen(window, event, schedule));
    if (reducedMotion) listen(reducedMotion, 'change', () => {
        if (settings.animateHiding && settings.respectReducedMotion && !reducedMotion.matches) requestReplay();
        processDOM();
    });
    function finishVisuals() {
        if (!dust.size()) return;
        dust.cancelAll();
        for (const entry of hidden.values()) if (entry.phase === 'pending') entry.phase = 'hidden';
        processDOM();
    }
    // YouTube dispatches scroll events from carousels/progress UI as well. Only an
    // actual viewport scroll may cancel a fixed-position particle layer.
    let scrollX = window.scrollX, scrollY = window.scrollY;
    listen(window, 'scroll', () => {
        if (window.scrollX === scrollX && window.scrollY === scrollY) return;
        scrollX = window.scrollX; scrollY = window.scrollY; finishVisuals();
    }, { passive: true });
    let width = window.innerWidth, height = window.innerHeight;
    listen(window, 'resize', () => {
        if (width === window.innerWidth && height === window.innerHeight) return;
        width = window.innerWidth; height = window.innerHeight; finishVisuals();
    }, { passive: true });
    listen(document, 'visibilitychange', () => {
        if (document.hidden) finishVisuals();
        else if (replayRequested) requestReplay();
        publishStatus();
    });
    const onMessage = (message, sender, respond) => {
        if (!alive || !['feedStatus', 'togglePreview', 'replayAnimation'].includes(message?.type)) return;
        const answer = () => {
            if (!alive) return;
            if (message.type === 'togglePreview') temporarilyPaused = !temporarilyPaused;
            if (message.type === 'replayAnimation') requestReplay();
            processDOM(); respond(statusSnapshot());
        };
        if (!ready) { bootReady.then(answer); return true; }
        answer();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    cleanup.push(() => chrome.runtime.onMessage.removeListener?.(onMessage));
    const onConnect = port => {
        if (!alive || port.name !== 'ytfc-feed') return;
        ports.add(port);
        port.onDisconnect.addListener(() => ports.delete(port));
        bootReady.then(() => {
            if (!alive || !ports.has(port)) return;
            try { port.postMessage(statusSnapshot()); } catch { ports.delete(port); }
        });
    };
    chrome.runtime.onConnect?.addListener(onConnect);
    cleanup.push(() => chrome.runtime.onConnect?.removeListener(onConnect));
    const instance = { version, contentRevision: F.CONTENT_REVISION, alive: true, dispose() {
        if (!alive) return;
        alive = false; instance.alive = false;
        clearTimeout(scheduleTimer); observer.disconnect(); resetHidden(); style.remove();
        for (const stop of cleanup) try { stop(); } catch { /* Invalidated extension context. */ }
        for (const port of ports) try { port.disconnect(); } catch { /* Already closed. */ }
        ports.clear(); resolveReady();
    } };
    globalThis.__YTFCContent = instance;
})();
