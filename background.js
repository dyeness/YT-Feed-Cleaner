const GITHUB_REPO = "dyeness/YT-Feed-Cleaner";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/commits/main`;

// Проверка при установке и запуск таймера
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("checkUpdate", { periodInMinutes: 360 }); // Раз в 6 часов
    checkForUpdates();
});

// Слушатель будильника
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "checkUpdate") {
        checkForUpdates();
    }
});

async function checkForUpdates() {
    try {
        const response = await fetch(GITHUB_API_URL);
        if (!response.ok) return;

        const data = await response.json();
        const latestSha = data.sha;

        chrome.storage.local.get(["lastKnownSha"], (result) => {
            if (result.lastKnownSha && result.lastKnownSha !== latestSha) {
                // Если SHA отличается от сохраненного, значит есть обновление
                chrome.storage.local.set({ 
                    updateAvailable: true, 
                    newSha: latestSha 
                });
            } else if (!result.lastKnownSha) {
                // Первая инициализация
                chrome.storage.local.set({ lastKnownSha: latestSha });
            }
        });
    } catch (error) {
        console.error("Update check failed:", error);
    }
}