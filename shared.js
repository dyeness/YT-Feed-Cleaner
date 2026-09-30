/* Shared, dependency-free settings and predicates. Also used by Node regression tests. */
(function (root) {
    'use strict';
    const DEFAULTS = Object.freeze({
        enabled: true, hideJams: true, hideShortsHome: true, hideShortsSearch: true,
        hideShortsOther: false, hideWatched: false, watchThreshold: 70, oldVideoThreshold: 0,
        filterHome: true, filterSearch: false, filterWatch: false, filterSubscriptions: false,
        hideLive: false, hideUpcoming: false, hidePlaylists: false,
        minDuration: 0, maxDuration: 0, titleKeywords: '', blockedChannels: '', allowedChannels: '',
        updateNotifications: true, trackCommits: true,
        language: 'auto', textSize: 'large', animateHiding: false,
        animationSpeed: 'normal', respectReducedMotion: true
    });
    const bounded = (value, fallback, min, max) => {
        if (value === '' || value === null || typeof value === 'boolean') return fallback;
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    };
    function normalizeSettings(input = {}) {
        const result = {};
        for (const [key, fallback] of Object.entries(DEFAULTS)) {
            if (typeof fallback === 'boolean') result[key] = typeof input[key] === 'boolean' ? input[key] : fallback;
            else if (typeof fallback === 'string') result[key] = typeof input[key] === 'string' ? input[key].slice(0, 10000) : fallback;
            else result[key] = bounded(input[key], fallback, key === 'watchThreshold' ? 1 : 0, key === 'watchThreshold' ? 100 : 100000);
        }
        for (const [key, choices] of Object.entries({ language: ['auto', 'ru', 'en'], textSize: ['normal', 'large', 'extra'], animationSpeed: ['fast', 'normal', 'slow'] })) {
            if (!choices.includes(result[key])) result[key] = DEFAULTS[key];
        }
        return result;
    }
    const normalizeText = text => String(text || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    const lines = text => String(text || '').split(/\r?\n/).map(normalizeText).filter(Boolean);
    function parseAge(text) {
        // Only a publication metadata item, never a title, aria-label or combined view count.
        const match = normalizeText(text).match(/^(?:(?:streamed|premiered)\s+|(?:трансляция|премьера)\s+)?(\d+|a|an|one|один|одна|одну)\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?|секунд[ауы]?|минут[ауы]?|час(?:а|ов)?|день|дня|дней|недел[яьиью]+|месяц(?:а|ев)?|год(?:а)?|лет)\s+(?:ago|назад)$/u);
        if (!match) return null;
        const value = /^\d+$/.test(match[1]) ? Number(match[1]) : 1;
        const unit = match[2];
        // Conservative lower bound for rounded month/year labels.
        const factor = /^(year|год|лет)/.test(unit) ? 365 : /^(month|месяц)/.test(unit) ? 28 : /^(week|недел)/.test(unit) ? 7 : /^(day|день|дня|дней)/.test(unit) ? 1 : /^(hour|час)/.test(unit) ? 1 / 24 : /^(minute|минут)/.test(unit) ? 1 / 1440 : 1 / 86400;
        return value * factor;
    }
    function parseDuration(text) {
        const value = String(text || '').trim();
        if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(value)) return null;
        const parts = value.split(':').map(Number);
        if (parts.slice(1).some(part => part > 59)) return null;
        return parts.reduce((sum, part) => sum * 60 + part, 0);
    }
    function parseProgress(width) {
        const match = String(width || '').trim().match(/^(\d+(?:\.\d+)?)%$/);
        return match && Number(match[1]) <= 100 ? Number(match[1]) : null;
    }
    function channelMatches(rules, channel) {
        return String(rules || '').split(/\r?\n/).map(rule => rule.trim()).filter(Boolean).some(rule => {
            let identity = rule, isUrl = false;
            try {
                if (/^https?:\/\//i.test(rule)) {
                    const url = new URL(rule);
                    if (!['youtube.com', 'www.youtube.com'].includes(url.hostname)) return false;
                    identity = decodeURIComponent(url.pathname).replace(/\/$/, '');
                    isUrl = true;
                }
            } catch { return false; }
            // YouTube channel IDs are case-sensitive; handles and display names are not.
            if (identity.startsWith('/channel/')) return identity === channel.path;
            if (/^\/?@[^/]+$/.test(identity)) {
                const handle = channel.handle || (channel.path?.startsWith('/@') ? channel.path.slice(1) : '');
                return normalizeText(identity.replace(/^\//, '')) === normalizeText(handle);
            }
            if (/^\/(?:c|user)\/[^/]+$/.test(identity)) return normalizeText(identity) === normalizeText(channel.path);
            if (isUrl) return false;
            return normalizeText(identity) === normalizeText(channel.name);
        });
    }
    function classify(facts, settings, context) {
        if (!settings.enabled || channelMatches(settings.allowedChannels, facts.channel || {})) return [];
        const reasons = [];
        if (settings.hideJams && facts.mix) reasons.push('mix');
        const shortsSetting = context === 'home' ? settings.hideShortsHome : context === 'search' ? settings.hideShortsSearch : settings.hideShortsOther;
        if (shortsSetting && facts.shorts) reasons.push('shorts');
        const inScope = ({ home: settings.filterHome, search: settings.filterSearch, watch: settings.filterWatch, subscriptions: settings.filterSubscriptions })[context];
        if (!inScope) return reasons;
        if (settings.hidePlaylists && facts.playlist && !facts.mix) reasons.push('playlist');
        if (!facts.video) return reasons;
        if (settings.hideLive && facts.live) reasons.push('live');
        if (settings.hideUpcoming && facts.upcoming) reasons.push('upcoming');
        if (settings.hideWatched && facts.progress !== null && facts.progress >= settings.watchThreshold) reasons.push('watched');
        if (settings.oldVideoThreshold > 0 && facts.age !== null && facts.age > settings.oldVideoThreshold) reasons.push('age');
        if (!facts.live && !facts.upcoming && facts.duration !== null) {
            if (settings.minDuration > 0 && facts.duration < settings.minDuration * 60) reasons.push('short-duration');
            if (settings.maxDuration > 0 && facts.duration > settings.maxDuration * 60) reasons.push('long-duration');
        }
        if (lines(settings.titleKeywords).some(word => normalizeText(facts.title).includes(word))) reasons.push('keyword');
        if (channelMatches(settings.blockedChannels, facts.channel || {})) reasons.push('channel');
        return reasons;
    }
    function parseVersion(value) {
        const match = String(value || '').match(/^v?(\d+(?:\.\d+){0,3})$/);
        return match ? match[1].split('.').map(Number) : null;
    }
    function isNewerVersion(local, remote) {
        const a = parseVersion(local), b = parseVersion(remote);
        if (!a || !b) return false;
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if ((b[i] || 0) !== (a[i] || 0)) return (b[i] || 0) > (a[i] || 0);
        }
        return false;
    }
    const api = { DEFAULTS, normalizeSettings, normalizeText, lines, parseAge, parseDuration, parseProgress, channelMatches, classify, parseVersion, isNewerVersion };
    root.YTFC = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
