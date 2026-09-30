const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../shared.js');
const U = require('../updates.js');
const sha = char => char.repeat(40);
const commit = char => ({ sha: sha(char), commit: { message: `Commit ${char}\nDetails` } });

test('versions compare numerically and ignore malformed/prerelease labels', () => {
    assert.equal(F.isNewerVersion('1.9', 'v1.10.0'), true);
    assert.equal(F.isNewerVersion('2.0.0', '1.99'), false);
    assert.equal(F.isNewerVersion('1.5.0', '1.5'), false);
    for (const remote of ['garbage', '1.6-beta', '1.2.x', '', 'v', '1.6.0.0.1']) assert.equal(F.isNewerVersion('1.5.0', remote), false);
});
test('first check establishes commit baseline, not a fake update', () => {
    const state = U.transition({}, { commit: commit('a'), version: '1.5.0', release: null }, '1.5.0', true);
    assert.equal(state.commitBaseline, sha('a')); assert.deepEqual(U.available(state), []);
});
test('new commits notify once and stay available until acknowledged', () => {
    let state = U.transition({ commitBaseline: sha('a') }, { commit: commit('b') }, '1.5.0', true);
    assert.equal(U.available(state)[0].id, `commit:${sha('b')}`);
    state = U.transition(state, { commit: commit('b') }, '1.5.0', true);
    assert.equal(U.available(state).length, 1);
    state.dismissedCommit = state.commit.id;
    assert.equal(U.available(state).length, 0);
    state = U.transition(state, { commit: commit('c') }, '1.5.0', true);
    assert.equal(U.available(state).length, 1);
});
test('release and manifest version are distinct from a new commit', () => {
    const state = U.transition({ commitBaseline: sha('a') }, { release: { id: 12, tag_name: 'v1.6.0' }, version: '1.6.0', commit: commit('b') }, '1.5.0', true);
    assert.equal(U.available(state).length, 2);
    assert.equal(U.available(state)[0].version, 'v1.6.0');
    assert.equal(U.available(state)[1].sha, sha('b'));
});
test('manifest update works even when no releases are published', () => {
    const state = U.transition({}, { release: null, version: '1.6' }, '1.5.0', true);
    assert.equal(U.available(state)[0].id, 'version:1.6');
});
test('network failure preserves known updates and acknowledgements', () => {
    const previous = { release: { id: 'release:12', version: 'v1.6.0' }, commitBaseline: sha('a'), dismissedCommit: 'old' };
    assert.deepEqual(U.transition(previous, {}, '1.5.0', true), previous);
});
test('installing a newer version removes stale version update state', () => {
    const state = U.transition({ release: { id: 'old' }, version: { id: 'old-manifest' } }, { release: { id: 12, tag_name: 'v1.6.0' }, version: '1.6.0' }, '1.6.0', true);
    assert.deepEqual(U.available(state), []);
});
test('local upgrade clears cached version alerts even when every source fails', () => {
    const state = U.transition({ release: { id: 'release:12', version: '1.6.0' }, version: { id: 'version:1.6.0', version: '1.6.0' } }, {}, '1.6.0', true);
    assert.deepEqual(U.available(state), []);
});
test('disabled commit tracking still advances baseline without updates', () => {
    const state = U.transition({ commitBaseline: sha('a'), commit: { id: 'old' } }, { commit: commit('b') }, '1.5.0', false);
    assert.equal(state.commitBaseline, sha('b')); assert.equal(state.commit, null); assert.deepEqual(U.available(state), []);
});
test('malformed commit cannot modify a stored baseline', () => {
    assert.equal(U.transition({ commitBaseline: sha('a') }, { commit: { sha: 'fake' } }, '1.5.0', true).commitBaseline, sha('a'));
});
