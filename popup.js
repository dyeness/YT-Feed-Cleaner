document.addEventListener('DOMContentLoaded', async () => {
    'use strict';
    const F = globalThis.YTFC, U = globalThis.YTFCUpdates, I = globalThis.YTFCI18n;
    const $ = id => document.getElementById(id);
    let settings = F.normalizeSettings(), tabId, updateState = {}, feedData = null, feedErrorKey = 'openYouTube', saved = false;
    let feedPort = null, connectedTabId = null;
    const t = (key, values) => I.translate(key, values, settings.language);
    const localizedError = error => I.formatError(error, settings.language);
    const form = $('settingsForm');
    form.addEventListener('submit', event => event.preventDefault());
    $('version').textContent = `v${chrome.runtime.getManifest().version}`;
    const tabs = ['filters', 'updates', 'appearance'];
    function selectTab(selected) {
        for (const name of tabs) {
            const active = name === selected;
            $(`${name}Tab`).setAttribute('aria-selected', String(active));
            $(`${name}Tab`).tabIndex = active ? 0 : -1;
            $(`${name}Panel`).hidden = !active;
        }
        window.scrollTo(0, 0);
    }
    for (const name of tabs) {
        $(`${name}Tab`).addEventListener('click', () => selectTab(name));
        $(`${name}Tab`).addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(name) + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length];
            selectTab(next); $(`${next}Tab`).focus();
        });
    }
    function applyAppearance() {
        document.documentElement.lang = I.resolveLanguage(settings.language);
        document.documentElement.dataset.textSize = settings.textSize;
        document.title = t('appTitle');
        document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
        document.querySelector('[role=tablist]').setAttribute('aria-label', t('appTitle'));
        updateControls(); renderFeed(); renderUpdates(updateState);
        if (saved) $('saveStatus').textContent = t('saved');
    }
    function fill(data) {
        settings = F.normalizeSettings(data);
        for (const [key, value] of Object.entries(settings)) {
            const element = $(key);
            if (typeof value === 'boolean') element.checked = value;
            else element.value = value;
        }
        applyAppearance();
    }
    function updateControls() {
        $('thresholdLabel').textContent = t('lblWatchThreshold', [String($('watchThreshold').value)]);
        $('watchThreshold').style.setProperty('--progress', `${(Number($('watchThreshold').value) - 10) / 90 * 100}%`);
        $('watchThreshold').disabled = !$('hideWatched').checked;
        $('animationSpeed').disabled = !$('animateHiding').checked;
        renderAnimationState();
    }
    function renderAnimationState() {
        const animation = !settings.animateHiding ? 'off' : feedData?.animation || 'on';
        $('animationStatus').textContent = settings.animateHiding && !feedData ? t(feedErrorKey) : t(`animation_${animation}`);
        $('replayAnimation').disabled = !settings.animateHiding || !feedData || !feedData.count || feedData.paused || animation === 'reduced';
    }
    function renderUpdates(state) {
        state = U.transition(state, {}, chrome.runtime.getManifest().version, settings.trackCommits);
        updateState = state;
        const items = U.available(state, settings.trackCommits);
        $('downloadRelease').href = U.downloadUrl(state);
        $('updateItems').replaceChildren();
        for (const item of items) {
            const link = document.createElement('a');
            link.className = 'update-item';
            link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
            link.textContent = item.version ? `${t('newVersion')}: ${item.version}` : `${t('newCommit')}: ${item.sha.slice(0, 7)} — ${item.title}`;
            $('updateItems').appendChild(link);
        }
        $('dismissUpdates').hidden = !items.length;
        $('updatesTab').classList.toggle('has-updates', !!items.length);
        const locale = I.resolveLanguage(settings.language);
        let status = state.lastSuccess ? `${t('lastCheck')}: ${new Date(state.lastSuccess).toLocaleString(locale)}` : state.error ? '' : t('notChecked');
        if (state.error) {
            const errors = state.errorDetails?.length ? [...new Set(state.errorDetails.map(error => t(error.key, error.values)))].join(' · ') : localizedError({ message: state.error });
            status += `${status ? '\n' : ''}${t('checkFailed')}: ${errors}`;
        }
        if (state.retryAt > Date.now()) status += `\n${t('retryAfter')}: ${new Date(state.retryAt).toLocaleTimeString(locale)}`;
        $('updateStatus').textContent = status;
    }
    function renderFeed() {
        $('statsDetails').replaceChildren();
        $('refreshStats').textContent = t(feedData ? 'refreshStats' : 'reconnectStats');
        renderAnimationState();
        if (!feedData) {
            $('statsText').textContent = t(feedErrorKey); $('preview').disabled = true; return;
        }
        $('statsText').textContent = feedData.paused ? t('previewActive') : t('statsHidden', [String(feedData.count)]);
        $('preview').textContent = t(feedData.paused ? 'resumeHiding' : 'showHidden');
        $('preview').disabled = false;
        for (const [reason, count] of Object.entries(feedData.counts)) {
            const p = document.createElement('p'); p.textContent = `${t(`reason_${reason.replace(/-/g, '_')}`)}: ${count}`;
            $('statsDetails').appendChild(p);
        }
        for (const item of feedData.items) {
            const p = document.createElement('p');
            p.textContent = `${item.title || t('contentTypes')} — ${item.reasons.map(reason => t(`reason_${reason.replace(/-/g, '_')}`)).join(', ')}`;
            $('statsDetails').appendChild(p);
        }
    }
    function closeConnection() {
        const old = feedPort; feedPort = null; connectedTabId = null;
        old?.disconnect();
    }
    function connectFeed() {
        if (!tabId || typeof chrome.tabs.connect !== 'function' || (feedPort && connectedTabId === tabId)) return;
        closeConnection();
        const port = chrome.tabs.connect(tabId, { name: 'ytfc-feed' });
        feedPort = port; connectedTabId = tabId;
        port.onMessage.addListener(status => {
            if (feedPort !== port || status?.protocol !== 2 || typeof status.count !== 'number') return;
            feedData = status; renderFeed();
        });
        port.onDisconnect.addListener(() => {
            void chrome.runtime.lastError;
            if (feedPort !== port) return;
            feedPort = null; connectedTabId = null; feedData = null; feedErrorKey = 'connectionFailed'; renderFeed();
        });
    }
    async function feedStatus(action = false) {
        $('refreshStats').disabled = true;
        try {
            const type = action === true ? 'toggleFeedPreview' : action === 'replay' ? 'replayFeedAnimation' : 'getFeedStatus';
            const response = await chrome.runtime.sendMessage({ type, tabId });
            if (!response || response.errorKey || typeof response.status?.count !== 'number') {
                feedData = null; feedErrorKey = response?.errorKey || 'connectionFailed'; closeConnection();
            } else {
                tabId = response.tabId; feedData = response.status; connectFeed();
            }
        } catch { feedData = null; feedErrorKey = 'connectionFailed'; closeConnection(); }
        finally { $('refreshStats').disabled = false; renderFeed(); }
    }
    window.addEventListener('pagehide', closeConnection);
    async function save({ quiet = false } = {}) {
        const values = {};
        for (const [key, fallback] of Object.entries(F.DEFAULTS)) values[key] = typeof fallback === 'boolean' ? $(key).checked : $(key).value;
        $('maxDuration').setCustomValidity(Number(values.minDuration) > 0 && Number(values.maxDuration) > 0 && Number(values.minDuration) > Number(values.maxDuration) ? t('invalidDuration') : '');
        if (!(quiet ? form.checkValidity() : form.reportValidity())) return;
        settings = F.normalizeSettings(values);
        applyAppearance();
        try {
            await chrome.storage.local.set(settings);
            saved = true; $('saveStatus').textContent = t('saved');
            setTimeout(() => feedStatus(), 150);
        } catch (error) { saved = false; $('saveStatus').textContent = `${t('saveFailed')}: ${localizedError(error)}`; }
    }
    try {
        const data = await chrome.storage.local.get({ ...F.DEFAULTS, updateState: {} });
        fill(data); renderUpdates(data.updateState);
        $('controls').disabled = false;
        await feedStatus();
    } catch (error) { $('saveStatus').textContent = `${t('saveFailed')}: ${localizedError(error)}`; return; }
    for (const key of Object.keys(F.DEFAULTS)) {
        const element = $(key);
        element.addEventListener('change', save);
        if (element.matches('input[type=number], input[type=range], textarea')) {
            // Apply valid edits before blur or popup close. Partial invalid input
            // must not overwrite the previous setting or show a validation popup.
            element.addEventListener('input', () => save({ quiet: true }));
        }
    }
    $('watchThreshold').addEventListener('input', updateControls);
    $('preview').addEventListener('click', () => feedStatus(true));
    $('refreshStats').addEventListener('click', () => feedStatus());
    $('replayAnimation').addEventListener('click', () => feedStatus('replay'));
    $('checkUpdates').addEventListener('click', async () => {
        $('checkUpdates').disabled = true;
        $('updateStatus').textContent = t('checking');
        try {
            const response = await chrome.runtime.sendMessage({ type: 'checkUpdates' });
            if (!response || response.error) throw new Error(response?.error || 'Operation failed');
            renderUpdates(response.state);
        } catch (error) { $('updateStatus').textContent = `${t('checkFailed')}: ${localizedError(error)}`; }
        finally { $('checkUpdates').disabled = false; }
    });
    $('dismissUpdates').addEventListener('click', async () => {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'dismissUpdates' });
            if (!response || response.error) throw new Error(response?.error || 'Operation failed');
            renderUpdates(response.state);
        } catch (error) { $('updateStatus').textContent = `${t('checkFailed')}: ${localizedError(error)}`; }
    });
    $('reset').addEventListener('click', async () => {
        if (!confirm(t('resetConfirm'))) return;
        const preserved = Object.fromEntries(['language', 'textSize', 'animateHiding', 'animationSpeed', 'respectReducedMotion', 'trackCommits', 'updateNotifications'].map(key => [key, settings[key]]));
        fill({ ...F.DEFAULTS, ...preserved });
        await save();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const appearanceKeys = ['language', 'textSize', 'animateHiding', 'animationSpeed', 'respectReducedMotion'];
        if (appearanceKeys.some(key => key in changes)) {
            const next = { ...settings };
            for (const key of appearanceKeys) {
                // Do not discard a checkbox/select edit still awaiting the save debounce
                // when another appearance preference changes in a different context.
                next[key] = key in changes ? changes[key].newValue : typeof F.DEFAULTS[key] === 'boolean' ? $(key).checked : $(key).value;
            }
            settings = F.normalizeSettings(next);
            for (const key of appearanceKeys) {
                if (typeof settings[key] === 'boolean') $(key).checked = settings[key];
                else $(key).value = settings[key];
            }
            applyAppearance();
        }
        if (changes.updateState) renderUpdates(changes.updateState.newValue || {});
    });
});
