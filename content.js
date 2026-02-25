let currentSettings = {
    hideJams: true,
    hideShortsHome: true,
    hideShortsSearch: true,
    hideWatched: false,
    oldVideoThreshold: "0"
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
    
    let value = 1; 
    
    const numMatch = lowerText.match(/\d+/);
    if (numMatch) {
        value = parseInt(numMatch[0], 10);
    }

    if (lowerText.includes('день') || lowerText.includes('дней') || lowerText.includes('дня') || lowerText.includes('day')) return value;
    if (lowerText.includes('недел') || lowerText.includes('week')) return value * 7;
    if (lowerText.includes('месяц') || lowerText.includes('month')) return value * 30;
    if (lowerText.includes('год') || lowerText.includes('лет') || lowerText.includes('года') || lowerText.includes('year')) return value * 365;
    
    return 0; 
}

function processDOM() {
    const path = window.location.pathname;
    const isHome = path === '/';
    const isSearch = path.startsWith('/results');
    const thresholdDays = parseInt(currentSettings.oldVideoThreshold, 10);

    // 1. Джемы
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

    // 2. Shorts
    if (currentSettings.hideShortsHome && isHome) {
        document.querySelectorAll('ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])').forEach(shelf => {
            hideElement(shelf, 'shorts-home');
        });
    }

    if (currentSettings.hideShortsSearch && isSearch) {
        document.querySelectorAll('ytd-reel-shelf-renderer').forEach(shelf => {
            hideElement(shelf, 'shorts-search');
        });
    }

    // 3. Просмотренные и Старые видео на Главной
    if (isHome && (currentSettings.hideWatched || thresholdDays > 0)) {
        const videoCards = document.querySelectorAll('ytd-rich-item-renderer');
        
        videoCards.forEach(card => {
            if (card.dataset.hiddenByExt) return;
            if (card.querySelector('ytd-rich-shelf-renderer[is-shorts]')) return;

            // Обработка просмотренных видео (обновленный парсинг прогресс-бара)
            if (currentSettings.hideWatched) {
                const progressBar = card.querySelector('.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment, #progress');
                if (progressBar && progressBar.style && progressBar.style.width) {
                    const widthPercent = parseFloat(progressBar.style.width); 
                    if (widthPercent >= 70) { 
                        hideElement(card, 'watched');
                        return; 
                    }
                }
            }

            // Обработка возраста видео
            if (thresholdDays > 0) {
                const metadataSpans = card.querySelectorAll('span.inline-metadata-item, #metadata-line span, span');
                let isOld = false;
                
                for (let span of metadataSpans) {
                    const text = span.textContent.trim().toLowerCase();
                    if (text.includes('назад') || text.includes('ago')) {
                        const daysOld = getAgeInDays(text);
                        if (daysOld >= thresholdDays) {
                            isOld = true;
                            break; 
                        }
                    }
                }
                
                if (isOld) {
                    hideElement(card, 'old-video');
                }
            }
        });
    }
}

const observer = new MutationObserver(() => {
    processDOM();
});

observer.observe(document.documentElement, { 
    childList: true, 
    subtree: true 
});