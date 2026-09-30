/* One translation API for popup, toolbar and notifications, including manual language selection. */
(function (root) {
    'use strict';
    const dictionaries = root.YTFCTranslations || (typeof require === 'function' ? require('./translations.js') : {});
    function resolveLanguage(preference = 'auto', browserLanguage) {
        if (preference === 'ru' || preference === 'en') return preference;
        const language = browserLanguage || root.chrome?.i18n?.getUILanguage?.() || root.navigator?.language || 'en';
        return /^ru(?:-|$)/i.test(language) ? 'ru' : 'en';
    }
    function translate(key, values = [], preference = 'auto') {
        const language = resolveLanguage(preference);
        const entry = dictionaries[language]?.[key] || dictionaries.en?.[key];
        if (!entry) return key;
        return entry.message.replace(/\$([a-z_]+)\$/gi, (token, name) => {
            const placeholder = entry.placeholders?.[name.toLowerCase()];
            return placeholder ? placeholder.content.replace(/\$(\d+)/g, (_, index) => String(values[Number(index) - 1] ?? '')) : token;
        });
    }
    function describeError(error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return { key: 'timeoutError', values: [] };
        const message = String(error?.message || error || '');
        const http = message.match(/GitHub HTTP (\d+)/);
        if (http) return { key: 'httpError', values: [http[1]] };
        if (error?.name === 'SyntaxError' || /^Invalid (GitHub|remote)/.test(message)) return { key: 'invalidResponse', values: [] };
        if (/network|fetch|offline|connection/i.test(message)) return { key: 'networkError', values: [] };
        return { key: 'operationError', values: [] };
    }
    function formatError(error, preference = 'auto') {
        const description = describeError(error);
        return translate(description.key, description.values, preference);
    }
    const api = { resolveLanguage, translate, describeError, formatError };
    root.YTFCI18n = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
