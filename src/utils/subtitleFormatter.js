/**
 * Subtitle Formatter & Line Wrapping Utility
 * Enforces broadcast-standard Characters Per Line (CPL) and balances multi-line cues.
 */

const DEFAULT_MAX_CPL = 40;
const DEFAULT_MAX_LINES = 2;

// Natural breaking punctuation (highest preference)
const PUNCTUATION_BREAKS = /[,.!?;:—–-]\s+/;

// Common clause/conjunction words across major languages
const CONJUNCTION_WORDS = new Set([
  // English
  'and', 'or', 'but', 'nor', 'so', 'for', 'yet', 'that', 'with', 'because', 'although', 'while', 'where', 'when', 'which', 'who', 'whom', 'whose', 'if', 'then', 'than', 'into', 'about', 'from',
  // Spanish
  'y', 'e', 'o', 'u', 'pero', 'mas', 'sino', 'porque', 'pues', 'que', 'con', 'para', 'por', 'como', 'donde', 'cuando', 'si',
  // Portuguese
  'e', 'ou', 'mas', 'porém', 'porque', 'pois', 'que', 'com', 'para', 'por', 'como', 'onde', 'quando', 'se',
  // French
  'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'que', 'avec', 'pour', 'par', 'comme', 'où', 'quand', 'si',
  // German
  'und', 'oder', 'aber', 'denn', 'doch', 'weil', 'dass', 'daß', 'mit', 'für', 'von', 'wie', 'wo', 'wenn',
  // Italian
  'e', 'ed', 'o', 'od', 'ma', 'però', 'perché', 'che', 'con', 'per', 'come', 'dove', 'quando', 'se'
]);

/**
 * Strip HTML tags to compute visual character length.
 * @param {string} str - Text with potential HTML tags
 * @returns {number} - Visual character count
 */
function getVisualLength(str) {
  if (!str) return 0;
  return str.replace(/<[^>]+>/g, '').length;
}

/**
 * Split a single long line into balanced lines respecting max CPL.
 * @param {string} line - Single line of subtitle text
 * @param {number} maxCpl - Maximum visual characters per line
 * @returns {Array<string>} - Array of balanced lines
 */
function balanceLine(line, maxCpl = DEFAULT_MAX_CPL) {
  const visualLen = getVisualLength(line);
  if (visualLen <= maxCpl) {
    return [line.trim()];
  }

  // Tokenize into words while preserving spacing and HTML tags
  const tokens = line.trim().split(/(\s+)/);
  if (tokens.length <= 1) {
    return [line.trim()];
  }

  // Target midpoint for balanced 2-line split
  const targetMidpoint = visualLen / 2;

  let bestSplitIndex = -1;
  let bestScore = Infinity;

  let currentVisualLen = 0;

  for (let i = 0; i < tokens.length; i += 2) {
    const word = tokens[i];
    const space = tokens[i + 1] || '';
    const wordVisualLen = getVisualLength(word);
    currentVisualLen += wordVisualLen;

    const leftLen = currentVisualLen;
    const rightLen = visualLen - leftLen;

    // Check if both sides meet CPL limits (or are at least closer to midpoint)
    const distanceToMid = Math.abs(leftLen - targetMidpoint);
    let penalty = distanceToMid;

    // Favor splitting after punctuation
    const cleanWord = word.replace(/<[^>]+>/g, '');
    if (/[.!?;:—–,]$/.test(cleanWord)) {
      penalty -= 8; // Strong bonus for punctuation
    }

    // Favor splitting before a conjunction
    const nextWord = (tokens[i + 2] || '').replace(/<[^>]+>/g, '').toLowerCase();
    if (CONJUNCTION_WORDS.has(nextWord)) {
      penalty -= 5; // Bonus for conjunction
    }

    // Heavy penalty if either line exceeds maxCpl
    if (leftLen > maxCpl) penalty += (leftLen - maxCpl) * 5;
    if (rightLen > maxCpl) penalty += (rightLen - maxCpl) * 5;

    if (penalty < bestScore) {
      bestScore = penalty;
      bestSplitIndex = i;
    }

    currentVisualLen += getVisualLength(space);
  }

  if (bestSplitIndex !== -1 && bestSplitIndex < tokens.length - 1) {
    const left = tokens.slice(0, bestSplitIndex + 1).join('').trim();
    const right = tokens.slice(bestSplitIndex + 2).join('').trim();

    // Check if right side still needs splitting (recursively if very long)
    if (getVisualLength(right) > maxCpl * 1.4) {
      return [left, ...balanceLine(right, maxCpl)];
    }
    return [left, right];
  }

  return [line.trim()];
}

/**
 * Format a subtitle text cue to optimize line breaks and CPL.
 * @param {string} text - Subtitle cue text
 * @param {Object} [options={}] - Formatting options
 * @param {number} [options.maxCharactersPerLine=40] - Max characters per line
 * @param {number} [options.maxLines=2] - Target max lines per cue
 * @returns {string} - Formatted subtitle text
 */
function formatSubtitleText(text, options = {}) {
  if (!text || typeof text !== 'string') return '';

  const maxCpl = Number(options.maxCharactersPerLine) || DEFAULT_MAX_CPL;
  const maxLines = Number(options.maxLines) || DEFAULT_MAX_LINES;

  // Split on existing line breaks
  const existingLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (existingLines.length === 0) return '';

  // If already multi-line and each line is within CPL, preserve
  const allWithinCpl = existingLines.every(l => getVisualLength(l) <= maxCpl);
  if (allWithinCpl && existingLines.length <= maxLines) {
    return existingLines.join('\n');
  }

  // If already has multiple lines that exceed CPL or are awkwardly split (e.g. 50 + 5 chars),
  // join them and rebalance
  const joinedText = existingLines.join(' ');
  const balanced = balanceLine(joinedText, maxCpl);

  // If resulting lines exceed maxLines, condense adjacent shortest lines
  if (balanced.length > maxLines) {
    while (balanced.length > maxLines) {
      // Find two adjacent lines whose combined visual length is minimal
      let minCombined = Infinity;
      let mergeIdx = 0;
      for (let i = 0; i < balanced.length - 1; i++) {
        const combined = getVisualLength(balanced[i]) + getVisualLength(balanced[i + 1]) + 1;
        if (combined < minCombined) {
          minCombined = combined;
          mergeIdx = i;
        }
      }
      balanced[mergeIdx] = `${balanced[mergeIdx]} ${balanced[mergeIdx + 1]}`;
      balanced.splice(mergeIdx + 1, 1);
    }
  }

  return balanced.join('\n');
}

/**
 * Format an array of parsed SRT entries.
 * @param {Array<Object>} entries - Parsed SRT entries [{ id, timecode, text }]
 * @param {Object} [options={}] - Formatting options
 * @returns {Array<Object>} - Formatted entries
 */
function formatSubtitleEntries(entries, options = {}) {
  if (!Array.isArray(entries)) return [];

  return entries.map(entry => ({
    ...entry,
    text: formatSubtitleText(entry.text, options)
  }));
}

module.exports = {
  formatSubtitleText,
  formatSubtitleEntries,
  getVisualLength,
  balanceLine,
  DEFAULT_MAX_CPL,
  DEFAULT_MAX_LINES
};
