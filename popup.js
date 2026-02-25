document.addEventListener('DOMContentLoaded', () => {
    const toggleJams = document.getElementById('toggleJams');
    const toggleShortsHome = document.getElementById('toggleShortsHome');
    const toggleShortsSearch = document.getElementById('toggleShortsSearch');
    const toggleWatched = document.getElementById('toggleWatched');
    const oldVideoThreshold = document.getElementById('oldVideoThreshold');

    // Загрузка сохраненных настроек
    chrome.storage.local.get({
        hideJams: true,
        hideShortsHome: true,
        hideShortsSearch: true,
        hideWatched: false,
        oldVideoThreshold: "0"
    }, (settings) => {
        toggleJams.checked = settings.hideJams;
        toggleShortsHome.checked = settings.hideShortsHome;
        toggleShortsSearch.checked = settings.hideShortsSearch;
        toggleWatched.checked = settings.hideWatched;
        oldVideoThreshold.value = settings.oldVideoThreshold;
    });

    // Функция сохранения настроек
    function saveSettings() {
        chrome.storage.local.set({
            hideJams: toggleJams.checked,
            hideShortsHome: toggleShortsHome.checked,
            hideShortsSearch: toggleShortsSearch.checked,
            hideWatched: toggleWatched.checked,
            oldVideoThreshold: oldVideoThreshold.value
        });
    }

    // Слушатели событий
    toggleJams.addEventListener('change', saveSettings);
    toggleShortsHome.addEventListener('change', saveSettings);
    toggleShortsSearch.addEventListener('change', saveSettings);
    toggleWatched.addEventListener('change', saveSettings);
    oldVideoThreshold.addEventListener('change', saveSettings);
});