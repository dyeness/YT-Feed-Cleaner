// Copy only runtime files. Load dist/yt-feed-cleaner as an unpacked extension.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const output = path.join(root, 'dist', 'yt-feed-cleaner');
fs.mkdirSync(output, { recursive: true });
for (const item of ['manifest.json', 'shared.js', 'translations.js', 'i18n.js', 'updates.js', 'connection.js', 'dissolve.js', 'content.js', 'background.js', 'popup.html', 'popup.js', 'popup.css', '_locales', 'icons', 'LICENSE']) {
    fs.cpSync(path.join(root, item), path.join(output, item), { recursive: true });
}
console.log(`Extension ready: ${output}`);
