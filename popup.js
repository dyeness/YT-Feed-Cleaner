document.addEventListener('DOMContentLoaded', () => {
    const repoUrl = "https://github.com/dyeness/YT-Feed-Cleaner";

    // 1. Локализация интерфейса (RU/EN)
    function localizeUI() {
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const messageKey = element.getAttribute('data-i18n');
            const translatedMessage = chrome.i18n.getMessage(messageKey);
            if (translatedMessage) {
                element.textContent = translatedMessage;
            }
        });
    }
    localizeUI();

    // 2. Инициализация элементов управления
    const toggleJams = document.getElementById('toggleJams');
    const toggleShortsHome = document.getElementById('toggleShortsHome');
    const toggleShortsSearch = document.getElementById('toggleShortsSearch');
    const toggleWatched = document.getElementById('toggleWatched');
    const oldVideoThreshold = document.getElementById('oldVideoThreshold');
    const footer = document.querySelector('.footer');
    
    // 3. Загрузка настроек и логика уведомлений
    chrome.storage.local.get({
        hideJams: true,
        hideShortsHome: true,
        hideShortsSearch: true,
        hideWatched: false,
        oldVideoThreshold: "0",
        updateAvailable: false,
        newSha: ""
    }, (settings) => {
        // Проставляем сохраненные галочки
        toggleJams.checked = settings.hideJams;
        toggleShortsHome.checked = settings.hideShortsHome;
        toggleShortsSearch.checked = settings.hideShortsSearch;
        toggleWatched.checked = settings.hideWatched;
        oldVideoThreshold.value = settings.oldVideoThreshold;

        // Если найдено обновление — создаем баннер ВНУТРИ этого блока
        if (settings.updateAvailable) {
            const updateDiv = document.createElement('div');
            updateDiv.className = 'update-banner';
            
            const updateText = document.createElement('span');
            updateText.textContent = chrome.i18n.getMessage("updateMsg") || "New version available!";
            updateText.onclick = () => window.open(repoUrl, '_blank');

            const closeBtn = document.createElement('button');
            closeBtn.className = 'btn-update-close';
            closeBtn.textContent = "OK";
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                chrome.storage.local.set({ 
                    updateAvailable: false, 
                    lastKnownSha: settings.newSha 
                }, () => location.reload());
            };

            updateDiv.appendChild(updateText);
            updateDiv.appendChild(closeBtn);
            // Вставляем ПЕРЕД футером, чтобы уведомление было внизу основного контента
            footer.parentNode.insertBefore(updateDiv, footer);
        }
    });

    // 4. Функция сохранения настроек при изменении пользователем
    function saveSettings() {
        chrome.storage.local.set({
            hideJams: toggleJams.checked,
            hideShortsHome: toggleShortsHome.checked,
            hideShortsSearch: toggleShortsSearch.checked,
            hideWatched: toggleWatched.checked,
            oldVideoThreshold: oldVideoThreshold.value
        });
    }

    // Навешиваем слушатели на все элементы
    toggleJams.addEventListener('change', saveSettings);
    toggleShortsHome.addEventListener('change', saveSettings);
    toggleShortsSearch.addEventListener('change', saveSettings);
    toggleWatched.addEventListener('change', saveSettings);
    oldVideoThreshold.addEventListener('change', saveSettings);
});