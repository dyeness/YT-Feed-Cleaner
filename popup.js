document.addEventListener('DOMContentLoaded', () => {
    // Автоматическая локализация интерфейса
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

    const toggleJams = document.getElementById('toggleJams');
    const toggleShortsHome = document.getElementById('toggleShortsHome');
    const toggleShortsSearch = document.getElementById('toggleShortsSearch');
    const toggleWatched = document.getElementById('toggleWatched');
    const oldVideoThreshold = document.getElementById('oldVideoThreshold');
    const repoUrl = "https://github.com/dyeness/YT-Feed-Cleaner";

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
    updateDiv.onclick = () => {
    window.open(repoUrl, '_blank');
};

    function saveSettings() {
        chrome.storage.local.set({
            hideJams: toggleJams.checked,
            hideShortsHome: toggleShortsHome.checked,
            hideShortsSearch: toggleShortsSearch.checked,
            hideWatched: toggleWatched.checked,
            oldVideoThreshold: oldVideoThreshold.value
        });
    }

    toggleJams.addEventListener('change', saveSettings);
    toggleShortsHome.addEventListener('change', saveSettings);
    toggleShortsSearch.addEventListener('change', saveSettings);
    toggleWatched.addEventListener('change', saveSettings);
    oldVideoThreshold.addEventListener('change', saveSettings);
});