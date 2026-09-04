const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('waitForFinalCachedTranslation uses responsive sub-second polling instead of 5000ms', () => {
  const subtitlesSource = fs.readFileSync(path.join(__dirname, 'subtitles.js'), 'utf8');

  // Verify that the 5000ms delay in waitForFinalCachedTranslation was removed
  assert.equal(
    subtitlesSource.includes('waitForFinalCachedTranslation') && subtitlesSource.includes('setTimeout(res, 5000)'),
    false,
    'waitForFinalCachedTranslation must not sleep for 5000ms between cache checks'
  );

  // Verify responsive polling exists (350ms)
  assert.equal(
    subtitlesSource.includes('setTimeout(res, 350)'),
    true,
    'waitForFinalCachedTranslation should poll responsively (e.g. 350ms)'
  );
});

test('index.js does not reject mobile mode duplicate in-flight requests with raw text', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');

  // Verify that mobile mode duplicate requests are not short-circuited with translationInProgress error text
  assert.equal(
    indexSource.includes('if (isAlreadyInFlight && waitForFullTranslation)'),
    false,
    'Mobile mode duplicate requests must not be rejected with raw translationInProgress text'
  );

  // Verify mobile mode duplicate requests are routed through deduplicate()
  assert.equal(
    indexSource.includes('if (isAlreadyInFlight && !waitForFullTranslation)'),
    true,
    'Duplicate requests should only return partials when not in mobile mode'
  );
});
