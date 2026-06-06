let currentSettings = {
    hideJams: true,
    hideShortsHome: true,
    hideShortsSearch: true,
    hideWatched: false,
    oldVideoThreshold: "0",
    watchThreshold: 70
};

chrome.storage.local.get(currentSettings, (res) => {
    currentSettings = res;
    processDOM();
});

chrome.storage.onChanged.addListener((changes) => {
    for (let [key, { newValue }] of Object.entries(changes)) {
        currentSettings[key] = newValue;
    }
    restoreAllElements();
    processDOM();
});

function hideElement(el, hideReason) {
    if (el && el.style.display !== 'none') {
        el.style.display = 'none';
        el.dataset.hiddenByExt = hideReason; 
    }
}

function restoreAllElements() {
    const hiddenElements = document.querySelectorAll('[data-hidden-by-ext]');
    hiddenElements.forEach(el => {
        el.style.display = '';
        delete el.dataset.hiddenByExt;
    });
}

function getAgeInDays(text) {
    if (!text) return 0;
    const lowerText = text.trim().toLowerCase();
    if (!lowerText.includes('назад') && !lowerText.includes('ago')) return 0;

    const valueMatch = lowerText.match(/\d+|\ba\b|\ban\b|\bone\b|\bодин\b|\bодна\b/);
    const value = valueMatch && /^\d+$/.test(valueMatch[0]) ? parseInt(valueMatch[0], 10) : 1;

    if (/день|дня|дней|\bday\b|\bdays\b/.test(lowerText)) return value;
    if (/недел|\bweek\b|\bweeks\b|\bwk\b|\bwks\b/.test(lowerText)) return value * 7;
    if (/месяц|месяца|месяцев|\bmonth\b|\bmonths\b|\bmo\b|\bmos\b/.test(lowerText)) return value * 30;
    if (/год|года|лет|\byear\b|\byears\b|\byr\b|\byrs\b/.test(lowerText)) return value * 365;
    return 0;
}

function getAgeTextCandidates(card) {
    const candidates = [];
    const selectors = [
        '#metadata-line',
        'ytd-video-meta-block',
        'yt-content-metadata-view-model',
        'span.inline-metadata-item',
        'yt-formatted-string',
        'span',
        '[aria-label]',
        '[title]'
    ];

    selectors.forEach(selector => {
        card.querySelectorAll(selector).forEach(el => {
            candidates.push(el.textContent);
            candidates.push(el.getAttribute('aria-label'));
            candidates.push(el.getAttribute('title'));
        });
    });

    candidates.push(card.getAttribute('aria-label'));
    return candidates.filter(Boolean);
}

function getCardAgeInDays(card) {
    for (let text of getAgeTextCandidates(card)) {
        const age = getAgeInDays(text);
        if (age > 0) return age;
    }
    return 0;
}

function processDOM() {
    const path = window.location.pathname;
    const isHome = path === '/';
    const isSearch = path.startsWith('/results');
    const thresholdDays = parseInt(currentSettings.oldVideoThreshold, 10);

    // 1. Скрытие Джемов
    if (currentSettings.hideJams) {
        document.querySelectorAll('a[href*="list=RD"]').forEach(link => {
            const card = link.closest('ytd-rich-item-renderer, ytd-compact-radio-renderer, ytd-radio-renderer, ytd-video-renderer');
            hideElement(card, 'jam');
        });
        document.querySelectorAll('#text, span, div').forEach(badge => {
            const text = badge.textContent.trim().toLowerCase();
            if (text === 'джем' || text === 'мой джем' || text === 'mix') {
                const card = badge.closest('ytd-rich-item-renderer, ytd-compact-radio-renderer, ytd-radio-renderer, ytd-video-renderer');
                hideElement(card, 'jam');
            }
        });
    }

    // 2. Скрытие Shorts
    if (currentSettings.hideShortsHome && isHome) {
        document.querySelectorAll('ytd-rich-section-renderer').forEach(shelf => {
            if (shelf.querySelector('ytd-rich-shelf-renderer[is-shorts]')) hideElement(shelf, 'shorts-home');
        });
    }
    if (currentSettings.hideShortsSearch && isSearch) {
        document.querySelectorAll('ytd-reel-shelf-renderer').forEach(shelf => hideElement(shelf, 'shorts-search'));
    }

    // 3. Просмотренные и Старые (только Главная)
    if (isHome) {
        const videoCards = document.querySelectorAll('ytd-rich-item-renderer');
        videoCards.forEach(card => {
            if (card.dataset.hiddenByExt) return;

            // Проверка прогресса просмотра
            if (currentSettings.hideWatched) {
                const progressBar = card.querySelector('.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment, #progress');
                if (progressBar && progressBar.style.width) {
                    const widthPercent = parseFloat(progressBar.style.width); 
                    if (widthPercent >= currentSettings.watchThreshold) { 
                        hideElement(card, 'watched');
                        return; 
                    }
                }
            }

            // Проверка возраста видео
            if (thresholdDays > 0) {
                if (getCardAgeInDays(card) >= thresholdDays) {
                    hideElement(card, 'old-video');
                }
            }
        });
    }
}

const observer = new MutationObserver(() => processDOM());
observer.observe(document.documentElement, { childList: true, subtree: true });
