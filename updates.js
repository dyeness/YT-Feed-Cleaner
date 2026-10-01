/* Pure update-state transition. Failed sources must never erase a known update. */
(function (root) {
    'use strict';
    const F = root.YTFC || (typeof require === 'function' ? require('./shared.js') : null);
    const REPO = 'dyeness/YT-Feed-Cleaner';
    const URL = `https://github.com/${REPO}`;
    function safeDownload(candidate) {
        try {
            const parsed = new root.URL(candidate);
            if (parsed.origin === 'https://github.com' && !parsed.username && !parsed.password && parsed.pathname.startsWith(`/${REPO}/releases/download/`) && parsed.pathname.endsWith('.zip')) return parsed.href;
        } catch { /* Untrusted or incomplete release metadata. */ }
        return null;
    }
    function downloadUrl(state = {}) {
        return safeDownload(state.latestRelease?.downloadUrl) || `${URL}/releases/latest`;
    }
    function releaseInfo(release) {
        if (!release) return null;
        const version = String(release.tag_name || '').replace(/^v/, '');
        const assets = Array.isArray(release.assets) ? release.assets : [];
        const asset = assets.find(item => item?.name === `yt-feed-cleaner-${version}.zip` && (!item.state || item.state === 'uploaded'));
        return { version: release.tag_name, downloadUrl: safeDownload(asset?.browser_download_url) || `${URL}/releases/latest` };
    }
    function transition(previous, snapshot, localVersion, trackCommits) {
        const next = { ...previous };
        if (Object.hasOwn(snapshot, 'release')) {
            const release = snapshot.release;
            next.latestRelease = releaseInfo(release);
            if (release && F.isNewerVersion(localVersion, release.tag_name)) {
                next.release = { id: `release:${release.id}`, version: release.tag_name, url: `${URL}/releases/tag/${encodeURIComponent(release.tag_name)}` };
            } else next.release = null;
        }
        if (Object.hasOwn(snapshot, 'version')) {
            next.version = F.isNewerVersion(localVersion, snapshot.version) ? { id: `version:${snapshot.version}`, version: snapshot.version, url: URL } : null;
        }
        if (Object.hasOwn(snapshot, 'commit')) {
            const commit = snapshot.commit;
            if (commit?.sha && /^[a-f0-9]{40}$/i.test(commit.sha)) {
                if (next.commitBaseline && next.commitBaseline !== commit.sha && trackCommits) {
                    next.commit = { id: `commit:${commit.sha}`, sha: commit.sha, title: String(commit.commit?.message || '').split('\n')[0].slice(0, 160), url: `${URL}/commit/${commit.sha}` };
                }
                next.commitBaseline = commit.sha;
            }
        }
        if (!trackCommits) next.commit = null;
        // A local upgrade makes cached version alerts obsolete, even while offline.
        if (next.release && !F.isNewerVersion(localVersion, next.release.version)) next.release = null;
        if (next.version && !F.isNewerVersion(localVersion, next.version.version)) next.version = null;
        return next;
    }
    function available(state, trackCommits = true) {
        const version = state.release || state.version;
        return [version, trackCommits ? state.commit : null].filter(item => item && item.id !== state.dismissedVersion && item.id !== state.dismissedCommit);
    }
    const api = { REPO, URL, transition, available, downloadUrl };
    root.YTFCUpdates = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
