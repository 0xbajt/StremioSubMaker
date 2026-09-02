const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubtitleHandler } = require('../handlers/subtitles');
const { normalizeConfig, getDefaultConfig } = require('../utils/config');

test('config normalization for subtitleLabelStyle', () => {
  const defaultConfig = getDefaultConfig();
  assert.equal(defaultConfig.subtitleLabelStyle, 'name_ai_tag');

  const normalizedDefault = normalizeConfig({});
  assert.equal(normalizedDefault.subtitleLabelStyle, 'name_ai_tag');

  const normalizedNameAi = normalizeConfig({ subtitleLabelStyle: 'name_ai_tag' });
  assert.equal(normalizedNameAi.subtitleLabelStyle, 'name_ai_tag');

  const normalizedIsoAi = normalizeConfig({ subtitleLabelStyle: 'iso_ai_tag' });
  assert.equal(normalizedIsoAi.subtitleLabelStyle, 'iso_ai_tag');

  const normalizedIsoName = normalizeConfig({ subtitleLabelStyle: 'iso_name_ai_tag' });
  assert.equal(normalizedIsoName.subtitleLabelStyle, 'iso_name_ai_tag');

  const normalizedMake = normalizeConfig({ subtitleLabelStyle: 'iso_make_tag' });
  assert.equal(normalizedMake.subtitleLabelStyle, 'iso_make_tag');

  const normalizedClassic = normalizeConfig({ subtitleLabelStyle: 'classic' });
  assert.equal(normalizedClassic.subtitleLabelStyle, 'classic');

  const normalizedIsoOnly = normalizeConfig({ subtitleLabelStyle: 'iso_only' });
  assert.equal(normalizedIsoOnly.subtitleLabelStyle, 'iso_only');

  const normalizedFallback = normalizeConfig({ subtitleLabelStyle: 'unknown_style' });
  assert.equal(normalizedFallback.subtitleLabelStyle, 'name_ai_tag');
});

test('subtitle handler generates Language Name + AI Tag track labels by default (e.g. Albanian - AI Translated)', async () => {
  const config = normalizeConfig({
    sourceLanguages: ['eng'],
    targetLanguages: ['fre', 'sqi', 'spa', 'deu'],
    subtitleLabelStyle: 'name_ai_tag',
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

  const translateSubs = result.subtitles.filter(s => s.id && s.id.startsWith('translate_'));
  if (translateSubs.length > 0) {
    const freTranslate = translateSubs.find(s => s.id.includes('_to_fre'));
    if (freTranslate) {
      assert.equal(freTranslate.lang, 'French - AI Translated');
    }

    const sqiTranslate = translateSubs.find(s => s.id.includes('_to_sqi'));
    if (sqiTranslate) {
      assert.equal(sqiTranslate.lang, 'Albanian - AI Translated');
    }

    const spaTranslate = translateSubs.find(s => s.id.includes('_to_spa'));
    if (spaTranslate) {
      assert.equal(spaTranslate.lang, 'Spanish - AI Translated');
    }

    const deuTranslate = translateSubs.find(s => s.id.includes('_to_deu'));
    if (deuTranslate) {
      assert.equal(deuTranslate.lang, 'German - AI Translated');
    }
  }
});

test('subtitle handler respects iso_ai_tag, classic, and iso_make_tag styles when configured', async () => {
  const configIsoAi = normalizeConfig({
    sourceLanguages: ['eng'],
    targetLanguages: ['fre', 'sqi'],
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

  const subHandlerIsoAi = createSubtitleHandler(configIsoAi);
  const resultIsoAi = await subHandlerIsoAi({
    type: 'movie',
    id: 'tt0111161'
  });

  const isoAiTranslates = (resultIsoAi?.subtitles || []).filter(s => s.id && s.id.startsWith('translate_'));
  const freIsoAi = isoAiTranslates.find(s => s.id.includes('_to_fre'));
  if (freIsoAi) {
    assert.equal(freIsoAi.lang, 'fre - [AI Translate]');
  }
  const sqiIsoAi = isoAiTranslates.find(s => s.id.includes('_to_sqi'));
  if (sqiIsoAi) {
    assert.equal(sqiIsoAi.lang, 'sqi - [AI Translate]');
  }

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
