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
  assert.equal(normalizeGeminiModelName('gemini-3.7-flash'), 'gemini-3.7-flash');
  assert.equal(normalizeGeminiModelName('gemini-3.6-flash'), 'gemini-3.6-flash');
  assert.equal(normalizeGeminiModelName('gemini-3.5-flash'), 'gemini-3.5-flash');
  assert.equal(normalizeGeminiModelName('gemini-3.5-flash-lite'), 'gemini-3.5-flash-lite');
  assert.equal(normalizeGeminiModelName('gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite');
  assert.equal(normalizeGeminiModelName('gemini-3.1-pro-preview'), 'gemini-3.1-pro-preview');
  assert.equal(normalizeGeminiModelName('gemini-2.5-flash'), 'gemini-2.5-flash');
  assert.equal(normalizeGeminiModelName('gemini-2.5-flash-lite'), 'gemini-2.5-flash-lite');

  // Check model-specific defaults
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
  assert.equal(pro31Defaults.thinkingBudget, 1000);
  assert.equal(pro31Defaults.temperature, 0.5);

  // Check deprecated models list includes 1.5, 2.0, and retired preview slugs
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-1.5-flash'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-1.5-pro'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-2.0-flash'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-2.0-flash-exp'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-2.5-pro'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-3-flash-preview'));
  assert.ok(DEPRECATED_MODEL_NAMES.includes('gemini-3-pro-preview'));
});
