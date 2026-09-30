/* DOM adapter: only explicit card metadata is passed to the pure filter engine. */
(() => {
    'use strict';
    const F = globalThis.YTFC;
    const CARD = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-radio-renderer, ytd-compact-radio-renderer, ytd-playlist-renderer, ytd-compact-playlist-renderer, yt-lockup-view-model, ytd-reel-item-renderer, yt-shorts-lockup-view-model';
    const PRIMARY = 'a#thumbnail[href], a#video-title[href], a#video-title-link[href], a.yt-lockup-view-model__content-image[href], .yt-lockup-metadata-view-model__title a[href], a.shortsLockupViewModelHostEndpoint[href]';
    let settings = F.normalizeSettings(), ready = false, scheduled = false, temporarilyPaused = false;
    const hidden = new Map();
    const dust = globalThis.YTFCDust.createController();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const style = document.createElement('style');
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
        const titleNode = ownNodes(card, '#video-title, #video-title-link, .yt-lockup-metadata-view-model__title, .shortsLockupViewModelHostMetadataTitle')[0];
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
        // Never search arbitrary spans, titles, descriptions or accessibility labels.
        const metadata = ownNodes(card, '#metadata-line > span, #metadata-line > yt-formatted-string, .yt-content-metadata-view-model__metadata-text');
        for (const item of metadata) {
            const parsed = F.parseAge(item.textContent);
            if (parsed !== null) { age = parsed; break; }
        }
        let duration = null;
        for (const badge of ownNodes(card, 'ytd-thumbnail-overlay-time-status-renderer #text, .yt-thumbnail-overlay-badge-view-model__badge-text, .yt-badge-shape__text')) {
            const parsed = F.parseDuration(badge.textContent);
            if (parsed !== null) { duration = parsed; break; }
        }
        let progress = null;
        for (const bar of ownNodes(card, 'ytd-thumbnail-overlay-resume-playback-renderer #progress, .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment')) {
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
        if (!ready) return;
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
    }
    function schedule() {
        if (!scheduled) { scheduled = true; setTimeout(processDOM, 80); }
    }
    chrome.storage.local.get(F.DEFAULTS, data => { settings = F.normalizeSettings(data); ready = true; schedule(); });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !Object.keys(changes).some(key => key in F.DEFAULTS)) return;
        const next = { ...settings };
        for (const [key, change] of Object.entries(changes)) if (key in F.DEFAULTS) next[key] = change.newValue;
        settings = F.normalizeSettings(next);
        processDOM();
    });
    new MutationObserver(schedule).observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['href', 'style', 'class', 'title', 'aria-label', 'is-shorts', 'overlay-style', 'content-id']
    });
    ['yt-navigate-finish', 'yt-page-data-updated', 'popstate'].forEach(event => window.addEventListener(event, schedule));
    reducedMotion?.addEventListener('change', processDOM);
    function finishVisuals() {
        dust.cancelAll();
        for (const entry of hidden.values()) if (entry.phase === 'pending') entry.phase = 'hidden';
        processDOM();
    }
    window.addEventListener('scroll', finishVisuals, { passive: true, capture: true });
    window.addEventListener('resize', finishVisuals, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) finishVisuals(); });
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.type === 'feedStatus' || message?.type === 'togglePreview') {
            if (message.type === 'togglePreview') temporarilyPaused = !temporarilyPaused;
            processDOM();
            const visibleHidden = [...hidden].filter(([element]) => !element.parentElement?.closest('[data-ytfc-hidden], [data-ytfc-dissolving]'));
            const counts = {};
            for (const [, item] of visibleHidden) for (const reason of item.reasons) counts[reason] = (counts[reason] || 0) + 1;
            respond({ count: visibleHidden.length, counts, paused: temporarilyPaused, context: context(), items: visibleHidden.slice(0, 30).map(([, item]) => ({ title: item.title, reasons: item.reasons })) });
        }
    });
})();
