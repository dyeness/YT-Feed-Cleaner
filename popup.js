document.addEventListener('DOMContentLoaded', () => {
    const toggleJams = document.getElementById('toggleJams');
    const toggleShortsHome = document.getElementById('toggleShortsHome');
    const toggleShortsSearch = document.getElementById('toggleShortsSearch');

    // Загрузка сохраненных настроек (по умолчанию всё включено)
    chrome.storage.local.get({
        hideJams: true,
        hideShortsHome: true,
        hideShortsSearch: true
    }, (settings) => {
        toggleJams.checked = settings.hideJams;
        toggleShortsHome.checked = settings.hideShortsHome;
        toggleShortsSearch.checked = settings.hideShortsSearch;
    });

    // Функция сохранения настроек при клике
    function saveSettings() {
        chrome.storage.local.set({
            hideJams: toggleJams.checked,
            hideShortsHome: toggleShortsHome.checked,
            hideShortsSearch: toggleShortsSearch.checked
        });
    }

    toggleJams.addEventListener('change', saveSettings);
    toggleShortsHome.addEventListener('change', saveSettings);
    toggleShortsSearch.addEventListener('change', saveSettings);
});