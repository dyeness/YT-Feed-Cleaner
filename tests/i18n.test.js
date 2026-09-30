const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../i18n.js');
const F = require('../shared.js');
const translations = require('../translations.js');

test('manual Russian/English override browser language, auto uses browser locale with English fallback', () => {
    assert.equal(I.resolveLanguage('ru', 'en-US'), 'ru');
    assert.equal(I.resolveLanguage('en', 'ru-RU'), 'en');
    assert.equal(I.resolveLanguage('auto', 'ru-RU'), 'ru');
    assert.equal(I.resolveLanguage('auto', 'en-GB'), 'en');
    assert.equal(I.resolveLanguage('auto', 'de'), 'en');
});
test('dynamic substitutions and error descriptions translate in both languages', () => {
    assert.equal(I.translate('lblWatchThreshold', ['75'], 'ru'), 'Порог просмотра: 75%');
    assert.equal(I.translate('statsHidden', ['12'], 'en'), 'Hidden on this page: 12');
    assert.equal(I.formatError({ message: 'GitHub HTTP 429' }, 'ru'), 'GitHub вернул HTTP 429');
    assert.equal(I.formatError({ message: 'Network offline' }, 'ru'), 'Нет связи с GitHub. Проверьте подключение.');
    assert.equal(I.formatError({ name: 'TimeoutError' }, 'en'), 'GitHub did not respond in time.');
    assert.equal(I.formatError({ message: 'Invalid GitHub release' }, 'ru'), 'GitHub вернул некорректные данные.');
});
test('generated runtime dictionary exactly matches canonical locale files', () => {
    for (const language of ['ru', 'en']) assert.deepEqual(translations[language], JSON.parse(fs.readFileSync(path.join(__dirname, `../_locales/${language}/messages.json`), 'utf8')));
});
test('appearance preferences normalize safely and opt-in animation remains off by default', () => {
    assert.equal(F.DEFAULTS.animateHiding, false);
    assert.equal(F.DEFAULTS.textSize, 'large');
    assert.equal(F.DEFAULTS.respectReducedMotion, true);
    const s = F.normalizeSettings({ language: 'de', textSize: 'tiny', animationSpeed: 'forever', animateHiding: 'true' });
    assert.equal(s.language, 'auto'); assert.equal(s.textSize, 'large'); assert.equal(s.animationSpeed, 'normal'); assert.equal(s.animateHiding, false);
});
