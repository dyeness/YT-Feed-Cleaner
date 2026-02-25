document.addEventListener('DOMContentLoaded', () => {
    const repoUrl = "https://github.com/dyeness/YT-Feed-Cleaner";

    // 1. Локализация интерфейса
    function localizeUI() {
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const messageKey = element.getAttribute('data-i18n');
            const translatedMessage = chrome.i18n.getMessage(messageKey);
            // Пропускаем динамические поля, их мы заполним функциями ниже
            if (translatedMessage && element.id !== 'thresholdLabel' && element.id !== 'statsText') {
                element.textContent = translatedMessage;
            }
        });
    }
    localizeUI();

    const elements = {
        toggleJams: document.getElementById('toggleJams'),
        toggleShortsHome: document.getElementById('toggleShortsHome'),
        toggleShortsSearch: document.getElementById('toggleShortsSearch'),
        toggleWatched: document.getElementById('toggleWatched'),
        oldVideoThreshold: document.getElementById('oldVideoThreshold'),
        watchThreshold: document.getElementById('watchThreshold'),
        thresholdLabel: document.getElementById('thresholdLabel'),
        statsText: document.getElementById('statsText'),
        footer: document.querySelector('.footer')
    };

    // 2. Загрузка данных из хранилища
    chrome.storage.local.get({
        hideJams: true,
        hideShortsHome: true,
        hideShortsSearch: true,
        hideWatched: false,
        oldVideoThreshold: "0",
        watchThreshold: 70,
        updateAvailable: false
    }, (settings) => {
        elements.toggleJams.checked = settings.hideJams;
        elements.toggleShortsHome.checked = settings.hideShortsHome;
        elements.toggleShortsSearch.checked = settings.hideShortsSearch;
        elements.toggleWatched.checked = settings.hideWatched;
        elements.oldVideoThreshold.value = settings.oldVideoThreshold;
        elements.watchThreshold.value = settings.watchThreshold;
        
        // Обновляем текст с использованием аргументов i18n
        updateThresholdLabel(settings.watchThreshold);

        // Логика баннера обновлений
        if (settings.updateAvailable) {
            const updateDiv = document.createElement('div');
            updateDiv.className = 'update-banner';
            
            const updateText = document.createElement('span');
            updateText.textContent = chrome.i18n.getMessage("updateMsg") || "Update available!";
            updateText.style.cursor = "pointer";
            updateText.onclick = () => window.open(repoUrl, '_blank');

            const closeBtn = document.createElement('button');
            closeBtn.className = 'btn-update-close';
            closeBtn.textContent = "OK";
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                chrome.storage.local.set({ updateAvailable: false }, () => location.reload());
            };

            updateDiv.appendChild(updateText);
            updateDiv.appendChild(closeBtn);
            elements.footer.parentNode.insertBefore(updateDiv, elements.footer);
        }
    });

    // Функции для корректной вставки значений в локализованные строки
    function updateThresholdLabel(val) {
        // Передаем значение в массиве вторым параметром
        const msg = chrome.i18n.getMessage("lblWatchThreshold", [val.toString()]);
        elements.thresholdLabel.textContent = msg || `Порог просмотра: ${val}%`;
    }

    function updateStats(count) {
        const msg = chrome.i18n.getMessage("statsHidden", [count.toString()]);
        elements.statsText.textContent = msg || `Скрыто элементов: ${count}`;
    }

    // 3. Сохранение настроек
    function saveSettings() {
        chrome.storage.local.set({
            hideJams: elements.toggleJams.checked,
            hideShortsHome: elements.toggleShortsHome.checked,
            hideShortsSearch: elements.toggleShortsSearch.checked,
            hideWatched: elements.toggleWatched.checked,
            oldVideoThreshold: elements.oldVideoThreshold.value,
            watchThreshold: parseInt(elements.watchThreshold.value)
        });
    }

    // Слушатели событий
    elements.watchThreshold.addEventListener('input', (e) => {
        updateThresholdLabel(e.target.value);
        saveSettings();
    });

    [elements.toggleJams, elements.toggleShortsHome, elements.toggleShortsSearch, elements.toggleWatched, elements.oldVideoThreshold].forEach(el => {
        el.addEventListener('change', saveSettings);
    });
});