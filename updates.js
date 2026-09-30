/* Pure update-state transition. Failed sources must never erase a known update. */
(function (root) {
    'use strict';
    const F = root.YTFC || (typeof require === 'function' ? require('./shared.js') : null);
    const REPO = 'dyeness/YT-Feed-Cleaner';
    const URL = `https://github.com/${REPO}`;
    function transition(previous, snapshot, localVersion, trackCommits) {
        const next = { ...previous };
        if (Object.hasOwn(snapshot, 'release')) {
            const release = snapshot.release;
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
    const api = { REPO, URL, transition, available };
    root.YTFCUpdates = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
