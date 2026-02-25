const GITHUB_REPO = "dyeness/YT-Feed-Cleaner";
const GITHUB_RAW_MANIFEST = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/manifest.json`;

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("checkUpdate", { periodInMinutes: 360 });
    checkForUpdates();
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "checkUpdate") {
        checkForUpdates();
    }
});

async function checkForUpdates() {
    try {
        // Получаем манифест из репозитория
        const response = await fetch(GITHUB_RAW_MANIFEST);
        if (!response.ok) return;
        const remoteManifest = await response.json();
        
        // Получаем версию текущего установленного плагина
        const localVersion = chrome.runtime.getManifest().version;

        // Сравниваем версии (например, "4.1" < "4.2")
        if (isNewerVersion(localVersion, remoteManifest.version)) {
            chrome.storage.local.set({ 
                updateAvailable: true, 
                newVersion: remoteManifest.version 
            });
        } else {
            chrome.storage.local.set({ updateAvailable: false });
        }
    } catch (error) {
        console.error("Update check failed:", error);
    }
}

// Функция для корректного сравнения строк версий
function isNewerVersion(local, remote) {
    const localParts = local.split('.').map(Number);
    const remoteParts = remote.split('.').map(Number);
    
    for (let i = 0; i < Math.max(localParts.length, remoteParts.length); i++) {
        const localPart = localParts[i] || 0;
        const remotePart = remoteParts[i] || 0;
        if (remotePart > localPart) return true;
        if (remotePart < localPart) return false;
    }
    return false;
}