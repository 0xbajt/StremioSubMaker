/**
 * SDH (Subtitles for the Deaf and Hard of Hearing) Cleaner Utility
 * Cleans non-speech audio cues, sound effects, music tags, speaker labels,
 * and normalizes all-caps shout text.
 */

const KNOWN_ACRONYMS = new Set([
  'FBI', 'CIA', 'NASA', 'USA', 'US', 'UK', 'EU', 'UN', 'TV', 'DNA', 'RNA',
  'SWAT', 'SOS', 'AI', 'OK', 'ID', 'VIP', 'UFO', 'HQ', 'CEO', 'CFO', 'CTO',
  'DJ', 'PC', 'CPU', 'GPU', 'RAM', 'ROM', 'DVD', 'CD', 'VCR', 'VHS', 'CCTV',
  'ATM', 'GPS', 'ETA', 'PIN', 'SIM', 'SMS', 'URL', 'HTTP', 'HTTPS', 'HTML',
  'ASAP', 'RIP', 'DIY', 'FAQ', 'IQ', 'EQ', 'PhD', 'MD', 'BA', 'BS', 'MA',
  'MS', 'AM', 'PM', 'BC', 'AD', 'BCE', 'CE', 'EST', 'PST', 'CST', 'MST',
  'UTC', 'GMT', 'COVID', 'SARS', 'HIV', 'AIDS', 'PTSD', 'ADHD', 'OCD',
  'MR', 'MRS', 'MS', 'DR', 'PROF', 'SGT', 'CPT', 'MAJ', 'COL', 'GEN', 'LT'
]);

// Common sound effect descriptor keywords
const SOUND_EFFECT_KEYWORDS = [
  'music', 'singing', 'song', 'applause', 'cheering', 'screaming', 'screams',
  'crying', 'cries', 'sobbing', 'sobs', 'sighs', 'sigh', 'gasps', 'gasp',
  'groans', 'groan', 'grunts', 'grunt', 'laughs', 'laughter', 'chuckles',
  'chuckle', 'giggles', 'giggle', 'whispering', 'whispers', 'whisper',
  'shouting', 'shouts', 'shout', 'yells', 'yelling', 'applause', 'footsteps',
  'door opens', 'door closes', 'door creaks', 'gunshot', 'gunshots', 'explosion',
  'explosions', 'engine revs', 'tires screech', 'phone rings', 'cell phone rings',
  'bell rings', 'knocking', 'knock on door', 'thunder', 'rain falling', 'wind blowing',
  'indistinct', 'inaudible', 'muffled', 'in english', 'in spanish', 'in french',
  'in japanese', 'in german', 'in italian', 'in russian', 'in chinese', 'subtitles by',
  'sync by', 'translated by', 'captioned by'
];

const SOUND_EFFECT_REGEX = new RegExp(
  `\\b(${SOUND_EFFECT_KEYWORDS.join('|')})\\b`,
  'i'
);

/**
 * Normalize an all-caps sentence/line to natural sentence case while preserving acronyms.
 * @param {string} text - The input line
 * @returns {string} - Sentence-cased line
 */
function normalizeAllCaps(text) {
  if (!text || typeof text !== 'string') return text;

  // Check if string contains mostly uppercase letters (at least 4 letters, >75% uppercase)
  const lettersOnly = text.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length < 4) return text;

  const upperCount = (lettersOnly.match(/[A-Z]/g) || []).length;
  if (upperCount / lettersOnly.length < 0.75) {
    return text; // Not predominantly uppercase
  }

  // Preserve HTML/formatting tags like <i>, </i>, <font...>, </font>
  const tagTokens = [];
  const withoutTags = text.replace(/<[^>]+>/g, (match) => {
    tagTokens.push(match);
    return `__TAG_${tagTokens.length - 1}__`;
  });

  // Convert to lowercase first, then capitalize start of sentences
  let normalized = withoutTags.toLowerCase();

  // Capitalize first letter of sentences (after start, '.', '!', '?', newline, or opening tag placeholder)
  normalized = normalized.replace(/(^|[.!?\n]\s*|__tag_\d+__\s*)([a-z])/gi, (match, boundary, char) => {
    return boundary + char.toUpperCase();
  });

  // Capitalize 'I' as pronoun
  normalized = normalized.replace(/\b(i)\b/g, 'I');
  normalized = normalized.replace(/\b(i)('m|'ve|'ll|'d)\b/g, (_, i, rest) => `I${rest}`);

  // Restore known acronyms
  normalized = normalized.replace(/\b[a-zA-Z]+\b/g, (word) => {
    const upper = word.toUpperCase();
    if (KNOWN_ACRONYMS.has(upper)) {
      return upper;
    }
    return word;
  });

  // Re-inject preserved tags
  normalized = normalized.replace(/__tag_(\d+)__/gi, (_, idx) => tagTokens[parseInt(idx, 10)] || '');

  return normalized;
}

/**
 * Clean SDH elements from a single text block/cue.
 * @param {string} text - Subtitle cue text
 * @param {Object} [options={}] - Cleaning options
 * @param {boolean} [options.removeSpeakerTags=true] - Remove speaker prefixes like "JOHN:"
 * @param {boolean} [options.normalizeAllCaps=true] - Convert shout text to sentence case
 * @param {boolean} [options.removeSoundEffects=true] - Remove bracketed/parenthetical sounds
 * @param {boolean} [options.removeMusic=true] - Remove musical notes
 * @returns {string} - Cleaned text
 */
function cleanSdhText(text, options = {}) {
  if (!text || typeof text !== 'string') return '';

  const {
    removeSpeakerTags = true,
    normalizeAllCaps: doNormalizeAllCaps = true,
    removeSoundEffects = true,
    removeMusic = true
  } = options;

  let cleaned = text;

  // 1. Remove music symbols and text enclosed by music notes: ♪ ... ♪ or ♫ ... ♫
  if (removeMusic) {
    cleaned = cleaned
      .replace(/[♪♫♩♬]\s*[^♪♫♩♬\n]*\s*[♪♫♩♬]/g, '')
      .replace(/[♪♫♩♬]+/g, '');
  }

  // 2. Remove bracketed sound effects: [dramatic music], [laughter], [speaks French]
  // Avoid stripping XML tags like <s id="1"> or <font>
  if (removeSoundEffects) {
    cleaned = cleaned.replace(/\[\s*(?:[A-Z0-9\s:,'".!?-]+?)\s*\]/gi, (match) => {
      // Keep if it looks like a subtitle index or XML tag
      if (/^\[\d+\]$/.test(match) || /^\[\^/.test(match)) {
        return match;
      }
      return '';
    });

    // Remove parenthetical sound effects: (screaming), (crying), (in French), (sighs)
    cleaned = cleaned.replace(/\(\s*([A-Z0-9\s:,'".!?-]+?)\s*\)/gi, (match, inner) => {
      // Check if inner content matches sound effect keywords or is all uppercase audio cues
      if (SOUND_EFFECT_REGEX.test(inner) || /^[A-Z\s,.-]+$/.test(inner.trim())) {
        return '';
      }
      return match;
    });
  }

  // 3. Remove speaker tags: "JOHN: Hello", "MAN 1: Yes", "NARRATOR: Long ago"
  if (removeSpeakerTags) {
    // Matches "SPEAKER NAME:" at start of line or after newline
    cleaned = cleaned.replace(/(^|\n)\s*(?:\[?[A-Z0-9\s.'_-]{2,25}\]?)\s*:\s*/gm, (match, prefix) => {
      // Don't strip if it looks like a URL (http: or https:) or timecode
      if (/https?:/i.test(match) || /\d{2}:\d{2}/.test(match)) {
        return match;
      }
      return prefix || '';
    });
  }

  // 4. Clean up multiple empty lines or stray spaces/hyphens left by stripped cues
  const lines = cleaned.split(/\r?\n/).map(line => {
    let l = line.trim();
    // Clean orphan dashes at start of line if speaker tag was removed: "- " -> ""
    if (l === '-' || l === '–' || l === '—') return '';
    return l;
  }).filter(Boolean);

  cleaned = lines.join('\n').trim();

  // 5. Normalize all-caps shouting if enabled
  if (doNormalizeAllCaps && cleaned) {
    const splitLines = cleaned.split('\n');
    const processedLines = splitLines.map(line => normalizeAllCaps(line));
    cleaned = processedLines.join('\n');
  }

  return cleaned;
}

/**
 * Clean an array of parsed SRT entries.
 * @param {Array<Object>} entries - Parsed SRT entries [{ id, timecode, text }]
 * @param {Object} [options={}] - Cleaning options
 * @returns {Array<Object>} - Cleaned entries
 */
function cleanSdhEntries(entries, options = {}) {
  if (!Array.isArray(entries)) return [];

  return entries.map(entry => {
    const cleanedText = cleanSdhText(entry.text, options);
    return {
      ...entry,
      text: cleanedText
    };
  });
}

module.exports = {
  cleanSdhText,
  cleanSdhEntries,
  normalizeAllCaps,
  KNOWN_ACRONYMS
};
