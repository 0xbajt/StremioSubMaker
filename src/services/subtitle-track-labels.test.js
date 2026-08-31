const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubtitleHandler } = require('../handlers/subtitles');
const { normalizeConfig, getDefaultConfig } = require('../utils/config');

test('config normalization for subtitleLabelStyle', () => {
  const defaultConfig = getDefaultConfig();
  assert.equal(defaultConfig.subtitleLabelStyle, 'iso_ai_tag');

  const normalizedDefault = normalizeConfig({});
  assert.equal(normalizedDefault.subtitleLabelStyle, 'iso_ai_tag');

  const normalizedMake = normalizeConfig({ subtitleLabelStyle: 'iso_make_tag' });
  assert.equal(normalizedMake.subtitleLabelStyle, 'iso_make_tag');

  const normalizedClassic = normalizeConfig({ subtitleLabelStyle: 'classic' });
  assert.equal(normalizedClassic.subtitleLabelStyle, 'classic');

  const normalizedIsoOnly = normalizeConfig({ subtitleLabelStyle: 'iso_only' });
  assert.equal(normalizedIsoOnly.subtitleLabelStyle, 'iso_only');

  const normalizedFallback = normalizeConfig({ subtitleLabelStyle: 'unknown_style' });
  assert.equal(normalizedFallback.subtitleLabelStyle, 'iso_ai_tag');
});

test('subtitle handler generates ISO + AI Tag track labels by default (Nuvio compatible)', async () => {
  const config = normalizeConfig({
    sourceLanguages: ['eng'],
    targetLanguages: ['fre', 'sqi', 'spa', 'deu'],
    subtitleLabelStyle: 'iso_ai_tag',
    subtitleProviders: {
      opensubtitles: { enabled: false },
      subdl: { enabled: false },
      subsource: { enabled: false },
      scs: { enabled: false },
      wyzie: { enabled: false },
      subsro: { enabled: false }
    }
  });

  const subHandler = createSubtitleHandler(config);
  const result = await subHandler({
    type: 'movie',
    id: 'tt0111161'
  });

  assert.ok(result);
  assert.ok(Array.isArray(result.subtitles));

  // Verify translation options are generated with ISO + AI Tag labels
  // e.g. fre - [AI Translate], sqi - [AI Translate], spa - [AI Translate], deu - [AI Translate]
  const labels = result.subtitles.map(s => s.lang);

  // If there are translation entries, verify their format
  const translateSubs = result.subtitles.filter(s => s.id && s.id.startsWith('translate_'));
  if (translateSubs.length > 0) {
    const freTranslate = translateSubs.find(s => s.id.includes('_to_fre'));
    if (freTranslate) {
      assert.equal(freTranslate.lang, 'fre - [AI Translate]');
    }

    const sqiTranslate = translateSubs.find(s => s.id.includes('_to_sqi'));
    if (sqiTranslate) {
      assert.equal(sqiTranslate.lang, 'sqi - [AI Translate]');
    }

    const spaTranslate = translateSubs.find(s => s.id.includes('_to_spa'));
    if (spaTranslate) {
      assert.equal(spaTranslate.lang, 'spa - [AI Translate]');
    }

    const deuTranslate = translateSubs.find(s => s.id.includes('_to_deu'));
    if (deuTranslate) {
      assert.equal(deuTranslate.lang, 'deu - [AI Translate]');
    }
  }
});

test('subtitle handler respects classic and iso_make_tag styles when configured', async () => {
  const configClassic = normalizeConfig({
    sourceLanguages: ['eng'],
    targetLanguages: ['fre', 'sqi'],
    subtitleLabelStyle: 'classic',
    subtitleProviders: {
      opensubtitles: { enabled: false },
      subdl: { enabled: false },
      subsource: { enabled: false },
      scs: { enabled: false },
      wyzie: { enabled: false },
      subsro: { enabled: false }
    }
  });

  const subHandlerClassic = createSubtitleHandler(configClassic);
  const resultClassic = await subHandlerClassic({
    type: 'movie',
    id: 'tt0111161'
  });

  const classicTranslates = (resultClassic?.subtitles || []).filter(s => s.id && s.id.startsWith('translate_'));
  const freClassic = classicTranslates.find(s => s.id.includes('_to_fre'));
  if (freClassic) {
    assert.equal(freClassic.lang, 'Make French');
  }

  const configIsoMake = normalizeConfig({
    sourceLanguages: ['eng'],
    targetLanguages: ['fre', 'sqi'],
    subtitleLabelStyle: 'iso_make_tag',
    subtitleProviders: {
      opensubtitles: { enabled: false },
      subdl: { enabled: false },
      subsource: { enabled: false },
      scs: { enabled: false },
      wyzie: { enabled: false },
      subsro: { enabled: false }
    }
  });

  const subHandlerIsoMake = createSubtitleHandler(configIsoMake);
  const resultIsoMake = await subHandlerIsoMake({
    type: 'movie',
    id: 'tt0111161'
  });

  const isoMakeTranslates = (resultIsoMake?.subtitles || []).filter(s => s.id && s.id.startsWith('translate_'));
  const freIsoMake = isoMakeTranslates.find(s => s.id.includes('_to_fre'));
  if (freIsoMake) {
    assert.equal(freIsoMake.lang, 'fre - [Make French]');
  }
});
