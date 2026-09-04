const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeApiKeyForHeader } = require('../utils/security');
const GeminiService = require('./gemini');
const { isGeminiAuthFailure, getGeminiErrorMessage } = GeminiService;

test('sanitizeApiKeyForHeader handles AQ. auth keys and common input quirks', () => {
  // Standard AQ key
  assert.equal(
    sanitizeApiKeyForHeader('AQ.AbCdEf1234567890_-xyz'),
    'AQ.AbCdEf1234567890_-xyz'
  );

  // Key surrounded by double quotes
  assert.equal(
    sanitizeApiKeyForHeader('"AQ.AbCdEf1234567890_-xyz"'),
    'AQ.AbCdEf1234567890_-xyz'
  );

  // Key surrounded by single quotes
  assert.equal(
    sanitizeApiKeyForHeader("'AQ.AbCdEf1234567890_-xyz'"),
    'AQ.AbCdEf1234567890_-xyz'
  );

  // Key with Bearer prefix
  assert.equal(
    sanitizeApiKeyForHeader('Bearer AQ.AbCdEf1234567890_-xyz'),
    'AQ.AbCdEf1234567890_-xyz'
  );

  // Key with Bearer prefix and quotes
  assert.equal(
    sanitizeApiKeyForHeader('Bearer "AQ.AbCdEf1234567890_-xyz"'),
    'AQ.AbCdEf1234567890_-xyz'
  );

  // Legacy AIza key
  assert.equal(
    sanitizeApiKeyForHeader('AIzaSyD-1234567890abcdef_XYZ'),
    'AIzaSyD-1234567890abcdef_XYZ'
  );

  // Empty or invalid inputs
  assert.equal(sanitizeApiKeyForHeader(''), null);
  assert.equal(sanitizeApiKeyForHeader(null), null);
  assert.equal(sanitizeApiKeyForHeader(undefined), null);
});

test('isGeminiAuthFailure detects all Google Gemini authentication failure variants', () => {
  // 401 UNAUTHENTICATED
  assert.equal(isGeminiAuthFailure({ response: { status: 401 } }), true);

  // 403 PERMISSION_DENIED
  assert.equal(isGeminiAuthFailure({ response: { status: 403 } }), true);

  // 400 with API_KEY_INVALID error reason
  assert.equal(
    isGeminiAuthFailure({
      response: {
        status: 400,
        data: {
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
            details: [{ reason: 'API_KEY_INVALID' }]
          }
        }
      }
    }),
    true
  );

  // 400 with API_KEY_SERVICE_BLOCKED
  assert.equal(
    isGeminiAuthFailure({
      response: {
        status: 400,
        data: {
          error: {
            code: 400,
            message: 'API key service blocked.',
            details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }]
          }
        }
      }
    }),
    true
  );

  // 400 with unregistered callers message
  assert.equal(
    isGeminiAuthFailure({
      response: {
        status: 400,
        data: {
          error: {
            message: "Method doesn't allow unregistered callers (callers without established identity)."
          }
        }
      }
    }),
    true
  );

  // Non-auth 400 error (e.g. invalid prompt argument)
  assert.equal(
    isGeminiAuthFailure({
      response: {
        status: 400,
        data: {
          error: {
            message: 'Invalid contents: text part cannot be empty.'
          }
        }
      }
    }),
    false
  );

  // 500 server error is not an auth error
  assert.equal(isGeminiAuthFailure({ response: { status: 500 } }), false);
});

test('getGeminiErrorMessage correctly extracts message from string or object', () => {
  // String error
  assert.equal(
    getGeminiErrorMessage({ response: { data: { error: 'Direct error string' } } }),
    'Direct error string'
  );

  // Object error with message
  assert.equal(
    getGeminiErrorMessage({ response: { data: { error: { message: 'Object error message' } } } }),
    'Object error message'
  );

  // Object error with reason in details
  assert.equal(
    getGeminiErrorMessage({
      response: {
        data: {
          error: {
            status: 'PERMISSION_DENIED',
            details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }]
          }
        }
      }
    }),
    'PERMISSION_DENIED: API_KEY_SERVICE_BLOCKED'
  );
});

test('Gemini models normalization and defaults support all new Gemini 3.x and active models', () => {
  const { normalizeGeminiModelName, getModelSpecificDefaults, DEPRECATED_MODEL_NAMES } = require('../utils/config');

  // Check normalization of preview/legacy names to current active models
  assert.equal(normalizeGeminiModelName('gemini-3.1-flash-lite-preview'), 'gemini-3.1-flash-lite');
  assert.equal(normalizeGeminiModelName('gemini-3-flash-preview'), 'gemini-3.7-flash');
  assert.equal(normalizeGeminiModelName('gemini-3-pro-preview'), 'gemini-3.1-pro-preview');
  assert.equal(normalizeGeminiModelName('gemini-2.5-pro'), 'gemini-3.1-pro-preview');
  assert.equal(normalizeGeminiModelName('gemini-2.5-pro-preview-05-06'), 'gemini-3.1-pro-preview');
  assert.equal(normalizeGeminiModelName('gemini-2.5-flash-preview-09-2025'), 'gemini-2.5-flash');
  assert.equal(normalizeGeminiModelName('gemini-flash-latest'), 'gemini-flash-lite-latest');

  // Check active models retain their names
  assert.equal(normalizeGeminiModelName('gemini-3.8-flash'), 'gemini-3.8-flash');
  assert.equal(normalizeGeminiModelName('gemini-3.8-pro'), 'gemini-3.1-pro-preview');
  assert.equal(normalizeGeminiModelName('gemini-3.7-flash'), 'gemini-3.7-flash');
  assert.equal(normalizeGeminiModelName('gemini-3.6-flash'), 'gemini-3.6-flash');
  assert.equal(normalizeGeminiModelName('gemini-3.5-flash'), 'gemini-3.5-flash');
  assert.equal(normalizeGeminiModelName('gemini-3.5-flash-lite'), 'gemini-3.5-flash-lite');
  assert.equal(normalizeGeminiModelName('gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite');
  assert.equal(normalizeGeminiModelName('gemini-3.1-pro-preview'), 'gemini-3.1-pro-preview');
  assert.equal(normalizeGeminiModelName('gemini-2.5-flash'), 'gemini-2.5-flash');
  assert.equal(normalizeGeminiModelName('gemini-2.5-flash-lite'), 'gemini-2.5-flash-lite');

  // Check model-specific defaults
  const flash38Defaults = getModelSpecificDefaults('gemini-3.8-flash');
  assert.equal(flash38Defaults.thinkingBudget, -1);
  assert.equal(flash38Defaults.temperature, 0.5);

  const flash37Defaults = getModelSpecificDefaults('gemini-3.7-flash');
  assert.equal(flash37Defaults.thinkingBudget, -1);
  assert.equal(flash37Defaults.temperature, 0.5);

  const flash36Defaults = getModelSpecificDefaults('gemini-3.6-flash');
  assert.equal(flash36Defaults.thinkingBudget, -1);
  assert.equal(flash36Defaults.temperature, 0.5);

  const flashLite35Defaults = getModelSpecificDefaults('gemini-3.5-flash-lite');
  assert.equal(flashLite35Defaults.thinkingBudget, 0);
  assert.equal(flashLite35Defaults.temperature, 0.8);

  const flashLite31Defaults = getModelSpecificDefaults('gemini-3.1-flash-lite');
  assert.equal(flashLite31Defaults.thinkingBudget, 0);
  assert.equal(flashLite31Defaults.temperature, 0.8);

  const pro31Defaults = getModelSpecificDefaults('gemini-3.1-pro-preview');
  assert.equal(pro31Defaults.thinkingBudget, -1);
  assert.equal(pro31Defaults.temperature, 0.5);

  // Check deprecated models list includes 1.5, 2.0, and retired preview slugs
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-1.5-flash'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-1.5-pro'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-2.0-flash'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-2.0-flash-exp'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-2.5-pro'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-3-flash-preview'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-3-pro-preview'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-3.8-flash-lite'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-3.8-pro'));
});

test('parseRedisUrl correctly parses rediss:// and redis:// connection strings', () => {
  const { parseRedisUrl } = require('../utils/redisHelper');

  // Standard Upstash TLS URL
  const upstash = parseRedisUrl('rediss://default:mySecretToken123@legal-camel-69494.upstash.io:6379');
  assert.equal(upstash.host, 'legal-camel-69494.upstash.io');
  assert.equal(upstash.port, 6379);
  assert.equal(upstash.password, 'mySecretToken123');
  assert.deepEqual(upstash.tls, {});

  // Standard redis URL with db number
  const standard = parseRedisUrl('redis://:secretPass@127.0.0.1:6380/2');
  assert.equal(standard.host, '127.0.0.1');
  assert.equal(standard.port, 6380);
  assert.equal(standard.password, 'secretPass');
  assert.equal(standard.db, 2);
  assert.equal(standard.tls, undefined);

  // Empty or invalid input
  assert.equal(parseRedisUrl(''), null);
  assert.equal(parseRedisUrl(null), null);
});

test('GeminiService formats generationConfig adhering to official Gemini 3.x parameter recommendations', () => {
  // 1. Gemini 3.5 Flash default: thinkingLevel "medium", sampling parameters omitted
  const gemini35 = new GeminiService('test-key', 'gemini-3.5-flash');
  const config35 = gemini35.buildGenerationConfig(16384);
  assert.equal(config35.maxOutputTokens, 16384);
  assert.deepEqual(config35.thinkingConfig, { thinkingLevel: 'medium' });
  assert.equal(config35.temperature, undefined);
  assert.equal(config35.topK, undefined);
  assert.equal(config35.topP, undefined);

  // 2. Gemini 3.1 Flash-Lite default: thinkingLevel "minimal", sampling parameters omitted
  const gemini31Lite = new GeminiService('test-key', 'gemini-3.1-flash-lite');
  const config31Lite = gemini31Lite.buildGenerationConfig(8192);
  assert.deepEqual(config31Lite.thinkingConfig, { thinkingLevel: 'minimal' });
  assert.equal(config31Lite.temperature, undefined);

  // 3. Gemini 3.1 Pro: thinkingLevel "high"
  const gemini31Pro = new GeminiService('test-key', 'gemini-3.1-pro-preview');
  const config31Pro = gemini31Pro.buildGenerationConfig(32768);
  assert.deepEqual(config31Pro.thinkingConfig, { thinkingLevel: 'high' });

  // 4. Gemini 3.5 Flash with explicit custom sampling settings
  const custom35 = new GeminiService('test-key', 'gemini-3.5-flash', {
    temperature: 0.3,
    topP: 0.85,
    topK: 20,
    thinkingLevel: 'low'
  });
  const customConfig35 = custom35.buildGenerationConfig(16384);
  assert.deepEqual(customConfig35.thinkingConfig, { thinkingLevel: 'low' });
  assert.equal(customConfig35.temperature, 0.3);
  assert.equal(customConfig35.topP, 0.85);
  assert.equal(customConfig35.topK, 20);

  // 5. Legacy Gemini 2.5 Flash: uses thinkingBudget & includes default sampling parameters
  const legacy25 = new GeminiService('test-key', 'gemini-2.5-flash', {
    thinkingBudget: -1
  });
  const legacyConfig25 = legacy25.buildGenerationConfig(16384);
  assert.deepEqual(legacyConfig25.thinkingConfig, { thinkingBudget: null });
  assert.equal(legacyConfig25.temperature, 0.5);
  assert.equal(legacyConfig25.topK, 40);
  assert.equal(legacyConfig25.topP, 0.95);
});

