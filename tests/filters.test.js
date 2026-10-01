const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../shared.js');
const facts = overrides => ({ video: true, title: 'An ordinary video', channel: {}, mix: false, shorts: false, playlist: false, live: false, upcoming: false, age: null, progress: null, duration: null, ...overrides });
const settings = overrides => F.normalizeSettings(overrides);

test('age parser only accepts isolated publication labels', () => {
    for (const [text, age] of [['2 days ago', 2], ['a week ago', 7], ['an hour ago', 1/24], ['3 дня назад', 3], ['2 недели назад', 14], ['1 неделю назад', 7], ['Премьера 2 года назад', 730], ['Streamed 2 months ago', 56], ['1 minute ago', 1/1440]]) assert.equal(F.parseAge(text), age, text);
    for (const text of ['I quit 10 years ago', '100 views 2 days ago', 'Mix', '5 лет назад — моя история', '23 просмотра', 'a long time ago', 'yesterday', '1.5 years ago', '', null]) assert.equal(F.parseAge(text), null, text);
});
test('Russian year and nine-month publication dates are older than a sixty-day cutoff', () => {
    const s = settings({ oldVideoThreshold: 60 });
    for (const [text, age] of [['1 год назад', 365], ['9 месяцев назад', 252], ['61 день назад', 61]]) {
        assert.equal(F.parsePublicationAge(text), age, text);
        assert.deepEqual(F.classify(facts({ age: F.parsePublicationAge(text) }), s, 'home'), ['age'], text);
    }
    for (const text of ['60 дней назад', '2 дня назад']) assert.deepEqual(F.classify(facts({ age: F.parsePublicationAge(text) }), s, 'home'), [], text);
});
test('compact Russian publication dates used by live YouTube parse to days', () => {
    for (const [text, age] of [['9 мес. назад', 252], ['1 г. назад', 365], ['8 ч назад', 8/24], ['61 дн. назад', 61], ['2 нед. назад', 14], ['1 мин. назад', 1/1440], ['1 сек. назад', 1/86400], ['9\u00a0мес. назад', 252]]) assert.equal(F.parseAge(text), age, text);
});
test('publication metadata accepts bullet-separated views but not arbitrary title sentences or ambiguous dates', () => {
    for (const text of ['125 тыс. просмотров • 9 месяцев назад', '100 views · 9 months ago', '1 год назад • 1 млн просмотров']) assert.ok(F.parsePublicationAge(text) > 60, text);
    for (const text of ['Моя история 1 год назад', '100 views 9 months ago', '1 год назад • 9 месяцев назад', '9 месяцев назад — моя история']) assert.equal(F.parsePublicationAge(text), null, text);
});
test('duration and progress never confuse arbitrary numbers or pixel widths', () => {
    assert.equal(F.parseDuration(' 12:34 '), 754);
    assert.equal(F.parseDuration('1:02:03'), 3723);
    for (const text of ['12:99', '123', 'LIVE', '1:2', '15 minutes', '12:34 100 views']) assert.equal(F.parseDuration(text), null);
    assert.equal(F.parseProgress('70%'), 70);
    assert.equal(F.parseProgress('70.5%'), 70.5);
    for (const width of ['70px', '101%', '-1%', '70', 'calc(70%)', '']) assert.equal(F.parseProgress(width), null);
});
test('unknown facts remain visible even with numeric filters enabled', () => {
    assert.deepEqual(F.classify(facts(), settings({ hideWatched: true, oldVideoThreshold: 7, minDuration: 10, maxDuration: 60 }), 'home'), []);
});
test('filter bounds are precise and age uses strict older-than', () => {
    const s = settings({ hideWatched: true, watchThreshold: 70, oldVideoThreshold: 7, minDuration: 5, maxDuration: 10 });
    assert.deepEqual(F.classify(facts({ progress: 69.9, age: 7, duration: 300 }), s, 'home'), []);
    assert.deepEqual(F.classify(facts({ progress: 70, age: 8, duration: 601 }), s, 'home'), ['watched', 'age', 'long-duration']);
    assert.deepEqual(F.classify(facts({ duration: 299 }), s, 'home'), ['short-duration']);
});
test('scope defaults preserve home-only watched/date behaviour', () => {
    const s = settings({ hideWatched: true, oldVideoThreshold: 7 });
    for (const page of ['search', 'watch', 'subscriptions', 'other']) assert.deepEqual(F.classify(facts({ age: 100, progress: 100 }), s, page), []);
    assert.deepEqual(F.classify(facts({ age: 100 }), settings({ filterSearch: true, oldVideoThreshold: 7 }), 'search'), ['age']);
});
test('channel rules are exact and whitelist overrides every filter', () => {
    const s = settings({ blockedChannels: 'Music', allowedChannels: '@safe', titleKeywords: 'Mix' });
    assert.deepEqual(F.classify(facts({ title: 'Mix', mix: true, channel: { handle: '@Safe' } }), s, 'home'), []);
    assert.deepEqual(F.classify(facts({ channel: { name: 'Music videos' } }), s, 'home'), []);
    assert.deepEqual(F.classify(facts({ channel: { name: 'MUSIC' } }), s, 'home'), ['channel']);
    assert.equal(F.channelMatches('https://www.youtube.com/@Safe/', { handle: '@safe', path: '/@safe' }), true);
    assert.equal(F.channelMatches('https://evil.test/@safe', { handle: '@safe' }), false);
});
test('channel IDs preserve case and handle rules never match a mere display name', () => {
    assert.equal(F.channelMatches('https://youtube.com/channel/UCabc', { path: '/channel/UCAbc' }), false);
    assert.equal(F.channelMatches('https://youtube.com/channel/UCabc', { path: '/channel/UCabc' }), true);
    assert.equal(F.channelMatches('@safe', { name: '@safe' }), false);
    assert.equal(F.channelMatches('@safe', { handle: '@SAFE' }), true);
    assert.equal(F.channelMatches('https://youtube.com/watch?v=x', { name: '/watch' }), false);
});
test('title rules use literal case-insensitive phrases, not regex', () => {
    const s = settings({ titleKeywords: '  HELLO world\n[a-z]' });
    assert.deepEqual(F.classify(facts({ title: 'HELLO   WORLD today' }), s, 'home'), ['keyword']);
    assert.deepEqual(F.classify(facts({ title: 'normal letters' }), s, 'home'), []);
});
test('live/upcoming duration is not interpreted as recorded-video duration', () => {
    assert.deepEqual(F.classify(facts({ live: true, duration: 10 }), settings({ minDuration: 5 }), 'home'), []);
    assert.deepEqual(F.classify(facts({ upcoming: true, duration: 10 }), settings({ hideUpcoming: true, minDuration: 5 }), 'home'), ['upcoming']);
});
test('settings migrate old numeric strings and reject corrupt booleans', () => {
    const s = settings({ oldVideoThreshold: '365', watchThreshold: 'bad', hideJams: 'false', enabled: false });
    assert.equal(s.oldVideoThreshold, 365); assert.equal(s.watchThreshold, 70); assert.equal(s.hideJams, true);
    assert.deepEqual(F.classify(facts({ mix: true }), s, 'home'), []);
});
