let currentSettings = {
    hideJams: true,
    hideShortsHome: true,
    hideShortsSearch: true
};

// Загружаем настройки при инициализации
chrome.storage.local.get(currentSettings, (res) => {
    currentSettings = res;
    processDOM();
});

// Слушаем изменения настроек из popup.js
chrome.storage.onChanged.addListener((changes) => {
    for (let [key, { newValue }] of Object.entries(changes)) {
        currentSettings[key] = newValue;
    }
    // Восстанавливаем все скрытые элементы перед новой фильтрацией
    restoreAllElements();
    processDOM();
});

// Функция для безопасного скрытия элемента
function hideElement(el, hideReason) {
    if (el && el.style.display !== 'none') {
        el.style.display = 'none';
        el.dataset.hiddenByExt = hideReason; // Помечаем, чтобы можно было восстановить
    }
}

// Функция для восстановления элементов
function restoreAllElements() {
    const hiddenElements = document.querySelectorAll('[data-hidden-by-ext]');
    hiddenElements.forEach(el => {
        el.style.display = '';
        delete el.dataset.hiddenByExt;
    });
}

function processDOM() {
    const path = window.location.pathname;
    const isHome = path === '/';
    const isSearch = path.startsWith('/results');

    // 1. Обработка Джемов
    if (currentSettings.hideJams) {
        // Поиск по URL (list=RD)
        document.querySelectorAll('a[href*="list=RD"]').forEach(link => {
            const card = link.closest('ytd-rich-item-renderer, ytd-compact-radio-renderer, ytd-radio-renderer, ytd-video-renderer');
            hideElement(card, 'jam');
        });

        // Поиск по тексту бейджей
        document.querySelectorAll('#text, span, div').forEach(badge => {
            const text = badge.textContent.trim().toLowerCase();
            if (text === 'джем' || text === 'мой джем' || text === 'mix') {
                const card = badge.closest('ytd-rich-item-renderer, ytd-compact-radio-renderer, ytd-radio-renderer, ytd-video-renderer');
                hideElement(card, 'jam');
            }
        });
    }

    // 2. Обработка Shorts на Главной
    if (currentSettings.hideShortsHome && isHome) {
        document.querySelectorAll('ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])').forEach(shelf => {
            hideElement(shelf, 'shorts-home');
        });
    }

    // 3. Обработка Shorts в Поиске
    if (currentSettings.hideShortsSearch && isSearch) {
        document.querySelectorAll('ytd-reel-shelf-renderer').forEach(shelf => {
            hideElement(shelf, 'shorts-search');
        });
    }
}

// Настраиваем MutationObserver для динамически подгружаемого контента
const observer = new MutationObserver(() => {
    processDOM();
});

observer.observe(document.documentElement, { 
    childList: true, 
    subtree: true 
});