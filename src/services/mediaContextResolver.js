const axios = require('axios');
const { LRUCache } = require('lru-cache');
const log = require('../utils/logger');
const { parseStremioId } = require('../utils/subtitle');
const animeIdResolver = require('./animeIdResolver');

// In-memory cache for media context (1000 items, 1 hour TTL)
const mediaContextCache = new LRUCache({
  max: 1000,
  ttl: 60 * 60 * 1000
});

const CINEMETA_BASE_URL = 'https://v3-cinemeta.strem.io';

/**
 * Resolve media context (title, cast, synopsis, genres) from videoId or videoInfo.
 * @param {string|Object} videoInput - Video ID string or videoInfo object
 * @param {Object} [options={}] - Options (timeoutMs, etc.)
 * @returns {Promise<Object|null>} - Media context object or null
 */
async function resolveMediaContext(videoInput, options = {}) {
  if (!videoInput) return null;

  let videoId = typeof videoInput === 'string' ? videoInput : videoInput.videoId || videoInput.id;
  let parsed = typeof videoInput === 'object' && videoInput.type ? videoInput : null;

  if (!parsed && typeof videoId === 'string') {
    parsed = parseStremioId(videoId);
  }

  if (!parsed) {
    // If raw title is provided in object
    if (typeof videoInput === 'object' && videoInput.title) {
      return {
        title: String(videoInput.title).trim(),
        type: videoInput.type || 'movie',
        cast: Array.isArray(videoInput.cast) ? videoInput.cast : [],
        overview: videoInput.overview || videoInput.synopsis || '',
        genres: Array.isArray(videoInput.genres) ? videoInput.genres : []
      };
    }
    return null;
  }

  const cacheKey = videoId || `${parsed.imdbId || parsed.animeId || 'meta'}:${parsed.type || 'unknown'}:${parsed.season || 0}:${parsed.episode || 0}`;
  const cached = mediaContextCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const timeoutMs = Number(options.timeoutMs) || 5000;

  try {
    let imdbId = parsed.imdbId;
    let stremioType = parsed.type === 'movie' ? 'movie' : 'series';

    // Handle Anime IDs
    if (parsed.isAnime || parsed.animeId) {
      try {
        const offlineInfo = animeIdResolver.resolveByStremioId(videoId || parsed.animeId);
        if (offlineInfo?.imdbId) {
          imdbId = offlineInfo.imdbId;
        } else if (offlineInfo?.tmdbId) {
          imdbId = `tmdb:${offlineInfo.tmdbId}`;
        }
      } catch (_) { }
    }

    if (!imdbId && parsed.tmdbId) {
      imdbId = `tmdb:${parsed.tmdbId}`;
    }

    if (!imdbId) {
      return null;
    }

    const metaUrl = `${CINEMETA_BASE_URL}/meta/${stremioType}/${encodeURIComponent(imdbId)}.json`;
    const response = await axios.get(metaUrl, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'SubMaker/1.0' }
    });

    const meta = response?.data?.meta;
    if (!meta) {
      return null;
    }

    const title = meta.name || '';
    const year = meta.year || meta.releaseInfo || '';
    const genres = Array.isArray(meta.genres) ? meta.genres : (meta.genre ? [meta.genre] : []);
    const rawCast = Array.isArray(meta.cast) ? meta.cast : (typeof meta.cast === 'string' ? meta.cast.split(',').map(s => s.trim()) : []);
    // Keep top 8 cast members for concise prompt injection
    const cast = rawCast.slice(0, 8);

    let overview = meta.description || meta.overview || '';
    let episodeTitle = '';

    // If it's a series episode, try to find specific episode overview
    if (stremioType === 'series' && Array.isArray(meta.videos) && parsed.season && parsed.episode) {
      const ep = meta.videos.find(v => {
        const s = v.season !== undefined ? v.season : v.seasonNum;
        const e = v.episode !== undefined ? v.episode : v.episodeNum || v.number;
        return Number(s) === Number(parsed.season) && Number(e) === Number(parsed.episode);
      });
      if (ep) {
        if (ep.title || ep.name) episodeTitle = ep.title || ep.name;
        if (ep.overview || ep.description) overview = ep.overview || ep.description;
      }
    }

    // Limit overview to 250 chars to keep prompt concise
    if (overview && overview.length > 250) {
      overview = overview.slice(0, 247) + '...';
    }

    const result = {
      title,
      year: String(year),
      type: stremioType,
      season: parsed.season || null,
      episode: parsed.episode || null,
      episodeTitle,
      cast,
      genres,
      overview
    };

    mediaContextCache.set(cacheKey, result);
    return result;
  } catch (error) {
    log.debug(() => `[MediaContext] Failed to fetch metadata for ${cacheKey}: ${error.message}`);
    return null;
  }
}

// Cross-episode glossary cache for TV series (seriesId:targetLang -> Map/Array of terms)
const seriesGlossaryCache = new LRUCache({
  max: 500,
  ttl: 24 * 60 * 60 * 1000 // 24 hours
});

/**
 * Record a localized proper noun or character term learned during an episode translation for a series.
 */
function recordSeriesGlossaryTerms(seriesId, targetLang, terms = []) {
  if (!seriesId || !targetLang || !Array.isArray(terms) || terms.length === 0) return;
  const key = `${seriesId}:${targetLang.toLowerCase()}`;
  const existing = seriesGlossaryCache.get(key) || [];
  const map = new Map();
  for (const item of existing) {
    if (item.from) map.set(item.from, item.to);
  }
  for (const item of terms) {
    if (item && item.from && item.to) {
      map.set(item.from, item.to);
    }
  }
  const merged = Array.from(map.entries()).map(([from, to]) => ({ from, to }));
  seriesGlossaryCache.set(key, merged);
}

/**
 * Get established cross-episode glossary terms for a series and target language.
 */
function getSeriesGlossary(seriesId, targetLang) {
  if (!seriesId || !targetLang) return [];
  const key = `${seriesId}:${targetLang.toLowerCase()}`;
  return seriesGlossaryCache.get(key) || [];
}

/**
 * Format media context and custom glossary into prompt-ready instructions.
 * @param {Object|null} mediaContext - Resolved media context
 * @param {Array|Object|null} customGlossary - User-defined glossary/locked terms
 * @param {Object} [options={}] - Additional glossary options (e.g. localizeProperNouns, seriesId, targetLanguage)
 * @returns {string} - Formatted prompt string or empty string
 */
function buildGlossaryPromptContext(mediaContext, customGlossary, options = {}) {
  const parts = [];

  if (mediaContext && mediaContext.title) {
    const metaLines = [];
    let titleStr = mediaContext.title;
    if (mediaContext.year) titleStr += ` (${mediaContext.year})`;
    if (mediaContext.season && mediaContext.episode) {
      titleStr += ` - S${String(mediaContext.season).padStart(2, '0')}E${String(mediaContext.episode).padStart(2, '0')}`;
      if (mediaContext.episodeTitle) titleStr += ` "${mediaContext.episodeTitle}"`;
    }
    metaLines.push(`- Media Title: ${titleStr}`);

    if (mediaContext.genres && mediaContext.genres.length > 0) {
      metaLines.push(`- Genre: ${mediaContext.genres.join(', ')}`);
    }

    if (mediaContext.cast && mediaContext.cast.length > 0) {
      metaLines.push(`- Key Characters / Cast: ${mediaContext.cast.join(', ')}`);
      if (options.speakerGenderAware !== false) {
        metaLines.push(`- Speaker & Character Gender Agreement: Use the cast/characters above to deduce speaker and addressee genders. Ensure adjectives, participles, and verb conjugations in the target language strictly agree with the character's grammatical gender.`);
      }
    }

    if (mediaContext.overview) {
      metaLines.push(`- Story Synopsis: ${mediaContext.overview}`);
    }

    if (options.formalityMode === 'formal') {
      metaLines.push(`- Dialogue Formality: Use FORMAL / RESPECTFUL address (e.g. V-form: usted, vous, Sie, ju) for 'you' and polite grammatical forms.`);
    } else if (options.formalityMode === 'casual') {
      metaLines.push(`- Dialogue Formality: Use CASUAL / INFORMAL address (e.g. T-form: tú, tu, du, ti) for 'you' and conversational dialogue forms.`);
    }

    if (options.localizeProperNouns === true) {
      metaLines.push(`- Proper Noun Localization: Character names, places, and terms should be phonetically transliterated or translated into standard target language spelling (e.g. Kayce -> Kejsi, Washington -> Uashington).`);
    }

    parts.push(`MEDIA CONTEXT (Use for accurate naming, pronouns, and lore tone):\n${metaLines.join('\n')}`);
  }

  // Combine custom glossary rules with cross-episode series glossary
  const glossaryRules = [];
  const combinedGlossary = [];

  if (Array.isArray(customGlossary)) {
    combinedGlossary.push(...customGlossary);
  } else if (customGlossary && typeof customGlossary === 'object') {
    for (const [from, to] of Object.entries(customGlossary)) {
      if (from && to) combinedGlossary.push({ from, to });
    }
  }

  // Inject learned series continuity glossary if available
  const seriesId = options.seriesId || mediaContext?.seriesId;
  const targetLanguage = options.targetLanguage;
  if (seriesId && targetLanguage) {
    const seriesTerms = getSeriesGlossary(seriesId, targetLanguage);
    for (const st of seriesTerms) {
      if (!combinedGlossary.some(cg => cg && cg.from === st.from)) {
        combinedGlossary.push(st);
      }
    }
  }

  for (const item of combinedGlossary) {
    if (!item) continue;
    if (typeof item === 'string' && item.trim()) {
      glossaryRules.push(`- ${item.trim()}`);
    } else if (typeof item === 'object') {
      if (item.from && item.to) {
        glossaryRules.push(`- "${item.from}" -> "${item.to}"`);
      } else if (item.term || item.locked) {
        glossaryRules.push(`- "${item.term || item.locked}" (PRESERVE - DO NOT TRANSLATE)`);
      }
    }
  }

  if (glossaryRules.length > 0) {
    parts.push(`GLOSSARY & LOCKED TERMS (Strictly follow these rules):\n${glossaryRules.join('\n')}`);
  }

  if (parts.length === 0) return '';
  return `\n${parts.join('\n\n')}\n`;
}

module.exports = {
  resolveMediaContext,
  buildGlossaryPromptContext,
  mediaContextCache,
  recordSeriesGlossaryTerms,
  getSeriesGlossary,
  seriesGlossaryCache
};
