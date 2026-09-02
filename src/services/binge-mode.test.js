const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSeriesVideoId,
  computeNextEpisodeVideoId,
  scheduleNextEpisodePreTranslation
} = require('./bingePredictiveWorker');
const {
  recordSeriesGlossaryTerms,
  getSeriesGlossary,
  buildGlossaryPromptContext
} = require('./mediaContextResolver');
const { normalizeConfig, getDefaultConfig } = require('../utils/config');

// 1. Series Video ID Parsing Tests
test('parseSeriesVideoId correctly parses standard, anime, TMDB, and custom series IDs', () => {
  const imdbSeries = parseSeriesVideoId('tt1234567:1:3');
  assert.ok(imdbSeries);
  assert.equal(imdbSeries.seriesId, 'tt1234567');
  assert.equal(imdbSeries.season, 1);
  assert.equal(imdbSeries.episode, 3);
  assert.equal(imdbSeries.type, 'series');

  const kitsuAnime = parseSeriesVideoId('kitsu:1234:5');
  assert.ok(kitsuAnime);
  assert.equal(kitsuAnime.seriesId, 'kitsu:1234');
  assert.equal(kitsuAnime.episode, 5);

  const tmdbSeries = parseSeriesVideoId('tmdb:12345:2:8');
  assert.ok(tmdbSeries);
  assert.equal(tmdbSeries.season, 2);
  assert.equal(tmdbSeries.episode, 8);

  const customSeries = parseSeriesVideoId('custom_show:2:15');
  assert.ok(customSeries);
  assert.equal(customSeries.seriesId, 'custom_show');
  assert.equal(customSeries.season, 2);
  assert.equal(customSeries.episode, 15);

  const movie = parseSeriesVideoId('tt1234567');
  assert.equal(movie, null);

  const invalid = parseSeriesVideoId('');
  assert.equal(invalid, null);
});

// 2. Next Episode Calculation Tests
test('computeNextEpisodeVideoId accurately increments episode count across formats', () => {
  assert.equal(computeNextEpisodeVideoId('tt1234567:1:1'), 'tt1234567:1:2');
  assert.equal(computeNextEpisodeVideoId('tt1234567:3:24'), 'tt1234567:3:25');
  assert.equal(computeNextEpisodeVideoId('kitsu:1234:5'), 'kitsu:1234:6');
  assert.equal(computeNextEpisodeVideoId('tmdb:12345:2:8'), 'tmdb:12345:2:9');
  assert.equal(computeNextEpisodeVideoId('tt9999999'), null);
});

// 3. Binge Mode Scheduling Guards
test('scheduleNextEpisodePreTranslation obeys config toggle and video types', async () => {
  // Disabled by default
  const disabledRes = await scheduleNextEpisodePreTranslation({
    currentVideoId: 'tt1234567:1:1',
    targetLanguage: 'spa',
    config: { bingeModeEnabled: false }
  });
  assert.equal(disabledRes.scheduled, false);
  assert.equal(disabledRes.reason, 'binge_mode_disabled');

  // Rejects movies even when enabled
  const movieRes = await scheduleNextEpisodePreTranslation({
    currentVideoId: 'tt1234567',
    targetLanguage: 'spa',
    config: { bingeModeEnabled: true }
  });
  assert.equal(movieRes.scheduled, false);
  assert.equal(movieRes.reason, 'not_a_series');

  // Schedules next episode for valid series
  const validRes = await scheduleNextEpisodePreTranslation({
    currentVideoId: 'tt1234567:1:1',
    targetLanguage: 'spa',
    config: { bingeModeEnabled: true, __configHash: 'test-hash-binge' }
  });
  assert.equal(validRes.scheduled, true);
  assert.equal(validRes.nextVideoId, 'tt1234567:1:2');
});

// 4. Series Lore & Glossary Memory Tests
test('cross-episode series glossary records terms and injects into prompt context', () => {
  const seriesId = 'tt7654321';
  const targetLang = 'Spanish';

  recordSeriesGlossaryTerms(seriesId, targetLang, [
    { from: 'Rip Wheeler', to: 'Rip Wheeler' },
    { from: 'Yellowstone Ranch', to: 'Rancho Yellowstone' }
  ]);

  const terms = getSeriesGlossary(seriesId, targetLang);
  assert.equal(terms.length, 2);
  assert.equal(terms[0].from, 'Rip Wheeler');

  const mediaContext = {
    title: 'Yellowstone',
    season: 1,
    episode: 2
  };

  const prompt = buildGlossaryPromptContext(mediaContext, [], {
    seriesId,
    targetLanguage: targetLang
  });

  assert.ok(prompt.includes('Rancho Yellowstone'));
  assert.ok(prompt.includes('Rip Wheeler'));
});

// 5. Config Normalization for Binge Mode
test('config includes bingeModeEnabled default and normalizes correctly', () => {
  const defaults = getDefaultConfig();
  assert.equal(defaults.bingeModeEnabled, false);

  const normalizedTrue = normalizeConfig({ bingeModeEnabled: true });
  assert.equal(normalizedTrue.bingeModeEnabled, true);

  const normalizedFalse = normalizeConfig({ bingeModeEnabled: false });
  assert.equal(normalizedFalse.bingeModeEnabled, false);
});

// 6. Binge Mode translation execution & scoping regression test
test('handleTranslation with bingeModeEnabled initiates translation without ReferenceError for candidateVideoId', async () => {
  const { handleTranslation } = require('../handlers/subtitles');
  const config = normalizeConfig({
    __configHash: 'test-config-hash-binge-123',
    userHash: 'test-user-hash-binge-123',
    geminiApiKey: 'mock-gemini-key',
    bingeModeEnabled: true,
    smartGlossaryEnabled: true
  });

  const result = await handleTranslation('mock_sub_id_binge', 'spa', config, {
    videoId: 'tt1234567:1:1',
    filename: 'Show.S01E01.mkv'
  });
  assert.ok(typeof result === 'string');
});
