const test = require('node:test');
const assert = require('node:assert/strict');

const { buildGlossaryPromptContext } = require('./mediaContextResolver');
const { cleanSdhText, cleanSdhEntries, extractSpeakerTag, normalizeAllCaps } = require('../utils/sdhCleaner');
const { formatSubtitleText, formatSubtitleEntries, getVisualLength, balanceLine } = require('../utils/subtitleFormatter');
const { getDefaultConfig, normalizeConfig } = require('../utils/config');
const TranslationEngine = require('./translationEngine');

// 1. Media Context & Glossary Resolver Tests
test('buildGlossaryPromptContext correctly formats movie metadata and lore', () => {
  const mediaContext = {
    title: 'Dune: Part Two',
    year: '2024',
    type: 'movie',
    genres: ['Sci-Fi', 'Adventure'],
    cast: ['Timothée Chalamet', 'Zendaya', 'Rebecca Ferguson', 'Javier Bardem'],
    overview: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.'
  };

  const customGlossary = [
    { from: 'Spice', to: 'Especia' },
    { locked: 'Kwisatz Haderach' }
  ];

  const promptContext = buildGlossaryPromptContext(mediaContext, customGlossary);

  assert.ok(promptContext.includes('MEDIA CONTEXT'));
  assert.ok(promptContext.includes('Dune: Part Two (2024)'));
  assert.ok(promptContext.includes('Timothée Chalamet, Zendaya'));
  assert.ok(promptContext.includes('Paul Atreides unites with Chani'));
  assert.ok(promptContext.includes('GLOSSARY & LOCKED TERMS'));
  assert.ok(promptContext.includes('"Spice" -> "Especia"'));
  assert.ok(promptContext.includes('"Kwisatz Haderach" (PRESERVE - DO NOT TRANSLATE)'));
});

test('buildGlossaryPromptContext handles series episodes and object glossary format', () => {
  const mediaContext = {
    title: 'Breaking Bad',
    season: 5,
    episode: 14,
    episodeTitle: 'Ozymandias',
    type: 'series',
    genres: ['Crime', 'Drama'],
    cast: ['Bryan Cranston', 'Aaron Paul', 'Anna Gunn'],
    overview: 'Everyone copes with the cataclysmic fallout of the previous events.'
  };

  const customGlossary = {
    'Heisenberg': 'Heisenberg',
    'Los Pollos Hermanos': 'Los Pollos Hermanos'
  };

  const promptContext = buildGlossaryPromptContext(mediaContext, customGlossary);

  assert.ok(promptContext.includes('Breaking Bad - S05E14 "Ozymandias"'));
  assert.ok(promptContext.includes('"Heisenberg" -> "Heisenberg"'));
  assert.ok(promptContext.includes('"Los Pollos Hermanos" -> "Los Pollos Hermanos"'));
});

test('buildGlossaryPromptContext returns empty string when no context or glossary is provided', () => {
  assert.equal(buildGlossaryPromptContext(null, null), '');
  assert.equal(buildGlossaryPromptContext({}, []), '');
});

// 2. SDH Cleaner Tests
test('cleanSdhText strips sound effects in brackets, parentheses, and music symbols', () => {
  const input = '[dramatic music]\n(screams in distance)\n♪ I want to hold your hand ♪\nHello, world!';
  const cleaned = cleanSdhText(input);
  assert.equal(cleaned, 'Hello, world!');
});

test('cleanSdhText strips speaker labels and prefixes', () => {
  const input = 'JOHN: Look over there!\nWOMAN: Where are you pointing?';
  const cleaned = cleanSdhText(input);
  assert.equal(cleaned, 'Look over there!\nWhere are you pointing?');
});

test('normalizeAllCaps converts uppercase shout text to sentence case while preserving acronyms', () => {
  const input = 'WE NEED TO CONTACT THE FBI AND NASA IMMEDIATELY!';
  const normalized = normalizeAllCaps(input);
  assert.equal(normalized, 'We need to contact the FBI and NASA immediately!');
});

test('normalizeAllCaps preserves HTML tags', () => {
  const input = '<i>WATCH OUT FOR THE CAR!</i>';
  const normalized = normalizeAllCaps(input);
  assert.equal(normalized, '<i>Watch out for the car!</i>');
});

test('cleanSdhEntries processes array of parsed SRT entries', () => {
  const entries = [
    { id: 1, timecode: '00:00:01,000 --> 00:00:03,000', text: '[thunder roaring]\nSARAH: Are you okay?' },
    { id: 2, timecode: '00:00:04,000 --> 00:00:06,000', text: '♫ Theme Song ♫' }
  ];

  const cleaned = cleanSdhEntries(entries);
  assert.equal(cleaned[0].text, 'Are you okay?');
  assert.equal(cleaned[1].text, '');
});

// 3. Subtitle Formatter & Line Wrapping Tests
test('getVisualLength strips HTML tags when calculating length', () => {
  assert.equal(getVisualLength('Hello world'), 11);
  assert.equal(getVisualLength('<i>Hello</i> <b>world</b>'), 11);
  assert.equal(getVisualLength('<font color="#ffff00">Important</font>'), 9);
});

test('balanceLine splits long lines at natural punctuation and conjunctions', () => {
  const longLine = 'We have to evacuate the perimeter immediately, because the reactor core is failing.';
  const balanced = balanceLine(longLine, 45);

  assert.equal(balanced.length, 2);
  assert.ok(getVisualLength(balanced[0]) <= 50);
  assert.ok(getVisualLength(balanced[1]) <= 50);
  assert.ok(balanced[0].endsWith(','));
  assert.ok(balanced[1].startsWith('because'));
});

test('formatSubtitleText keeps short lines intact and balances multi-line cues', () => {
  const shortText = 'Yes, I understand.';
  assert.equal(formatSubtitleText(shortText), shortText);

  const longCue = 'In a distant galaxy far away from here, an ancient civilization was building monuments of stone.';
  const formatted = formatSubtitleText(longCue, { maxCharactersPerLine: 45, maxLines: 2 });
  const lines = formatted.split('\n');

  assert.equal(lines.length, 2);
  assert.ok(getVisualLength(lines[0]) <= 55);
  assert.ok(getVisualLength(lines[1]) <= 55);
});

test('formatSubtitleEntries formats parsed SRT entries', () => {
  const entries = [
    { id: 1, timecode: '00:00:01,000 --> 00:00:05,000', text: 'This is a single very long subtitle sentence that expands during translation and must be formatted properly across multiple lines.' }
  ];

  const formatted = formatSubtitleEntries(entries, { maxCharactersPerLine: 45 });
  assert.ok(formatted[0].text.includes('\n'));
});

// 4. TranslationEngine Integration Tests
test('TranslationEngine injects media context and glossary into prompt templates', () => {
  const mockGemini = {
    apiKey: 'mock-key',
    model: 'gemini-2.5-flash',
    countTokensForTranslation: async () => 100,
    buildUserPrompt: (text, lang, prompt) => ({ userPrompt: prompt })
  };

  const mediaContext = {
    title: 'Cyberpunk: Edgerunners',
    year: '2022',
    cast: ['David Martinez', 'Lucy', 'Maine', 'Rebecca'],
    overview: 'A street kid trying to survive in a technology and body modification-obsessed city of the future.'
  };

  const customGlossary = ['"Sandevistan" (PRESERVE - DO NOT TRANSLATE)'];

  const engine = new TranslationEngine(
    mockGemini,
    'gemini-2.5-flash',
    { translationWorkflow: 'xml' },
    {
      mediaContext,
      customGlossary,
      cleanSdhSubtitles: true,
      smartLineWrap: true,
      maxCharactersPerLine: 40
    }
  );

  const prompt = engine.createXmlBatchPrompt('<s id="1">Hello</s>', 'Spanish', null, 1);

  assert.ok(prompt.includes('MEDIA CONTEXT'));
  assert.ok(prompt.includes('Cyberpunk: Edgerunners (2022)'));
  assert.ok(prompt.includes('David Martinez, Lucy, Maine, Rebecca'));
  assert.ok(prompt.includes('"Sandevistan" (PRESERVE - DO NOT TRANSLATE)'));
  assert.ok(prompt.includes('<s id="1">Hello</s>'));
});

// 5. Config Defaults & Normalization Tests
test('config includes Subtitle Intelligence defaults and normalizes options', () => {
  const defaults = getDefaultConfig();
  assert.equal(defaults.smartGlossaryEnabled, true);
  assert.deepEqual(defaults.customGlossary, []);
  assert.equal(defaults.cleanSdhSubtitles, false);
  assert.equal(defaults.smartLineWrap, true);
  assert.equal(defaults.maxCharactersPerLine, 40);

  const normalized = normalizeConfig({
    smartGlossaryEnabled: false,
    customGlossary: [{ from: 'T-800', to: 'T-800' }],
    cleanSdhSubtitles: true,
    smartLineWrap: true,
    maxCharactersPerLine: 45
  });

  assert.equal(normalized.smartGlossaryEnabled, false);
  assert.equal(normalized.customGlossary.length, 1);
  assert.equal(normalized.cleanSdhSubtitles, true);
  assert.equal(normalized.smartLineWrap, true);
  assert.equal(normalized.maxCharactersPerLine, 45);
});

// 6. handleTranslation scoping regression test
test('handleTranslation initiates translation without ReferenceError for fallbackVideoId', async () => {
  const { handleTranslation } = require('../handlers/subtitles');
  const config = normalizeConfig({
    __configHash: 'test-config-hash-12345',
    userHash: 'test-user-hash-12345',
    geminiApiKey: 'mock-gemini-key',
    smartGlossaryEnabled: true
  });

  // Calling handleTranslation for invalid/mock source should gracefully return an error/loading message, NOT throw ReferenceError
  const result = await handleTranslation('mock_sub_id_123', 'spa', config, { videoId: 'tt1234567' });
  assert.ok(typeof result === 'string');
});

// 7. TranslationEngine SDH and line wrapping execution test
test('TranslationEngine pre-cleans SDH cues and formats output lines', async () => {
  const mockProvider = {
    apiKey: 'mock-key',
    model: 'gemini-2.5-flash',
    countTokensForTranslation: async () => 10,
    translateSubtitle: async (prompt) => {
      // Echo input back with simulated translation
      return '<s id="1">Hola, ¿cómo estás?</s>';
    }
  };

  const rawSrt = `1
00:00:01,000 --> 00:00:04,000
[dramatic music]
SARAH: Hello, how are you?
`;

  const engine = new TranslationEngine(
    mockProvider,
    'gemini-2.5-flash',
    { translationWorkflow: 'xml' },
    {
      cleanSdhSubtitles: true,
      smartLineWrap: true,
      maxCharactersPerLine: 40
    }
  );

  const translated = await engine.translateSubtitle(rawSrt, 'Spanish');
  assert.ok(!translated.includes('[dramatic music]'));
  assert.ok(!translated.includes('SARAH:'));
  assert.ok(translated.includes('Hola, ¿cómo estás?'));
});

// 8. localizeProperNouns prompt injection test
test('TranslationEngine injects proper noun localization rule when enabled', () => {
  const mockGemini = {
    apiKey: 'mock-key',
    model: 'gemini-2.5-flash',
    countTokensForTranslation: async () => 100,
    buildUserPrompt: (text, lang, prompt) => ({ userPrompt: prompt })
  };

  const mediaContext = {
    title: 'Yellowstone',
    year: '2018',
    cast: ['Kayce Dutton', 'John Dutton'],
    overview: 'A ranching family in Montana faces off against others encroaching on their land.'
  };

  const engine = new TranslationEngine(
    mockGemini,
    'gemini-2.5-flash',
    { translationWorkflow: 'xml' },
    {
      mediaContext,
      localizeProperNouns: true
    }
  );

  const xmlPrompt = engine.createXmlBatchPrompt('<s id="1">Kayce went to Washington.</s>', 'Albanian', null, 1);
  assert.ok(xmlPrompt.includes('PROPER NOUNS & NAMES'));
  assert.ok(xmlPrompt.includes('Adapt, transliterate, and phonetically translate character names'));
  assert.ok(xmlPrompt.includes('Proper Noun Localization'));

  const jsonPrompt = engine._buildJsonPrompt('[{"id":1,"text":"Kayce went to Washington."}]', 'Albanian', null, 1);
  assert.ok(jsonPrompt.includes('Adapt, transliterate, and phonetically translate character names'));
});

// 9. Audiovisual Translation (AVT) Cinematic Standards Tests
test('Translation prompts include Audiovisual Translation (AVT) standards', () => {
  const { DEFAULT_TRANSLATION_PROMPT } = require('./gemini');
  assert.ok(DEFAULT_TRANSLATION_PROMPT.includes('IDIOMATIC & NATURAL DIALOGUE'));
  assert.ok(DEFAULT_TRANSLATION_PROMPT.includes('TONE & PROFANITY FIDELITY'));
  assert.ok(DEFAULT_TRANSLATION_PROMPT.includes('SUBTITLE BREVITY & TIMING'));

  const mockGemini = {
    apiKey: 'mock-key',
    model: 'gemini-2.5-flash',
    countTokensForTranslation: async () => 100,
    buildUserPrompt: (text, lang, prompt) => ({ userPrompt: prompt })
  };

  const engine = new TranslationEngine(
    mockGemini,
    'gemini-2.5-flash',
    { translationWorkflow: 'numbered' },
    {}
  );

  const batchPrompt = engine.createBatchPrompt('1. Look at that guy.', 'Albanian', null, 1);
  assert.ok(batchPrompt.includes('IDIOMATIC & NATURAL DIALOGUE'));
  assert.ok(batchPrompt.includes('TONE & PROFANITY FIDELITY'));
  assert.ok(batchPrompt.includes('SUBTITLE BREVITY & CONCISENESS'));

  const xmlPrompt = engine.createXmlBatchPrompt('<s id="1">Look at that guy.</s>', 'Albanian', null, 1);
  assert.ok(xmlPrompt.includes('IDIOMATIC & NATURAL DIALOGUE'));
  assert.ok(xmlPrompt.includes('TONE & PROFANITY FIDELITY'));
  assert.ok(xmlPrompt.includes('SUBTITLE BREVITY & CONCISENESS'));
});

// 10. Speaker & Gender Agreement and Formality Tests
test('extractSpeakerTag correctly detects speaker prefixes across diverse formats', () => {
  assert.equal(extractSpeakerTag('JOHN: Look over there!'), 'John');
  assert.equal(extractSpeakerTag('[SARAH]: Where are you going?'), 'Sarah');
  assert.equal(extractSpeakerTag('- EMILY: Don\'t do it.'), 'Emily');
  assert.equal(extractSpeakerTag('[MARY] What is that?'), 'Mary');
  assert.equal(extractSpeakerTag('DETECTIVE MILLER: Any clues?'), 'Detective Miller');
  assert.equal(extractSpeakerTag('MAN 1: We must go.'), 'Man 1');

  // Negative tests
  assert.equal(extractSpeakerTag('Just normal dialogue without speaker.'), null);
  assert.equal(extractSpeakerTag('https://example.com'), null);
  assert.equal(extractSpeakerTag('00:01:23 --> 00:01:25'), null);
  assert.equal(extractSpeakerTag('[dramatic music] Hello!'), null);
  assert.equal(extractSpeakerTag('(screams) Help me!'), null);
});

test('cleanSdhEntries preserves detected speaker on entry object', () => {
  const entries = [
    { id: 1, timecode: '00:00:01,000 --> 00:00:03,000', text: 'SARAH: I am exhausted.' },
    { id: 2, timecode: '00:00:04,000 --> 00:00:06,000', text: '[JOHN] You should rest.' },
    { id: 3, timecode: '00:00:07,000 --> 00:00:09,000', text: 'I agree with him.' }
  ];

  const cleaned = cleanSdhEntries(entries);
  assert.equal(cleaned[0].speaker, 'Sarah');
  assert.equal(cleaned[0].text, 'I am exhausted.');
  assert.equal(cleaned[1].speaker, 'John');
  assert.equal(cleaned[1].text, 'You should rest.');
  assert.equal(cleaned[2].speaker, undefined);
  assert.equal(cleaned[2].text, 'I agree with him.');
});

test('TranslationEngine injects speaker attributes in XML and prompts with gender and formality rules', () => {
  const mockGemini = {
    apiKey: 'mock-key',
    model: 'gemini-3.8-flash',
    countTokensForTranslation: async () => 100,
    buildUserPrompt: (text, lang, prompt) => ({ userPrompt: prompt })
  };

  const mediaContext = {
    title: 'Yellowstone',
    cast: ['Kevin Costner (John Dutton)', 'Kelly Reilly (Beth Dutton)'],
    overview: 'A ranching family in Montana faces off against others encroaching on their land.'
  };

  // Test 1: Formal tone and gender awareness enabled
  const engineFormal = new TranslationEngine(
    mockGemini,
    'gemini-3.8-flash',
    { translationWorkflow: 'xml' },
    {
      mediaContext,
      speakerGenderAware: true,
      formalityMode: 'formal'
    }
  );

  const batch = [
    { id: 1, text: 'I am ready for the meeting.', speaker: 'Beth Dutton' },
    { id: 2, text: 'Are you sure about this?', speaker: null }
  ];

  const xmlBatchText = engineFormal.prepareBatchXml(batch);
  assert.ok(xmlBatchText.includes('<s id="1" speaker="Beth Dutton">I am ready for the meeting.</s>'));
  assert.ok(xmlBatchText.includes('<s id="2">Are you sure about this?</s>'));

  const formalPrompt = engineFormal.createXmlBatchPrompt(xmlBatchText, 'Albanian', null, 2);
  assert.ok(formalPrompt.includes('SPEAKER & GENDER AGREEMENT'));
  assert.ok(formalPrompt.includes('DIALOGUE FORMALITY: Enforce FORMAL / RESPECTFUL'));
  assert.ok(formalPrompt.includes('Speaker & Character Gender Agreement'));

  // Test 2: Casual tone
  const engineCasual = new TranslationEngine(
    mockGemini,
    'gemini-3.8-flash',
    { translationWorkflow: 'xml' },
    {
      mediaContext,
      speakerGenderAware: true,
      formalityMode: 'casual'
    }
  );

  const casualPrompt = engineCasual.createXmlBatchPrompt(xmlBatchText, 'Spanish', null, 2);
  assert.ok(casualPrompt.includes('DIALOGUE FORMALITY: Enforce CASUAL / INFORMAL'));

  // Test 3: Gender awareness disabled
  const engineDisabled = new TranslationEngine(
    mockGemini,
    'gemini-3.8-flash',
    { translationWorkflow: 'xml' },
    {
      mediaContext,
      speakerGenderAware: false,
      formalityMode: 'auto'
    }
  );

  const disabledBatchText = engineDisabled.prepareBatchXml(batch);
  assert.ok(!disabledBatchText.includes('speaker='));
  const disabledPrompt = engineDisabled.createXmlBatchPrompt(disabledBatchText, 'Albanian', null, 2);
  assert.ok(!disabledPrompt.includes('SPEAKER & GENDER AGREEMENT'));
});

test('config normalization correctly handles formalityMode and speakerGenderAware', () => {
  const defaults = getDefaultConfig();
  assert.equal(defaults.speakerGenderAware, true);
  assert.equal(defaults.formalityMode, 'auto');

  const custom = normalizeConfig({
    speakerGenderAware: false,
    formalityMode: 'formal'
  });
  assert.equal(custom.speakerGenderAware, false);
  assert.equal(custom.formalityMode, 'formal');

  const invalid = normalizeConfig({
    formalityMode: 'invalid_mode'
  });
  assert.equal(invalid.formalityMode, 'auto');
});




