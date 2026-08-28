const { LRUCache } = require('lru-cache');
const log = require('../utils/logger');
const { parseStremioId } = require('../utils/subtitle');
const { resolveMediaContext } = require('./mediaContextResolver');

// In-flight next-episode jobs tracking with TTL eviction (prevents duplicate simultaneous jobs and memory leaks)
const inFlightBingeJobs = new LRUCache({
  max: 500,
  ttl: 15 * 60 * 1000 // 15 minutes TTL safety
});

/**
 * Parse a videoId string or object to extract series metadata.
 * @param {string|Object} videoInput
 * @returns {{ seriesId: string, season: number, episode: number, type: string, rawId: string, partsCount: number }|null}
 */
function parseSeriesVideoId(videoInput) {
  if (!videoInput) return null;

  let videoId = typeof videoInput === 'string' ? videoInput : videoInput.videoId || videoInput.id;
  if (!videoId || typeof videoId !== 'string') return null;

  const parts = videoId.split(':');
  const partsCount = parts.length;

  // Stremio series/episode format via parseStremioId
  const parsed = parseStremioId(videoId);
  if (parsed && (parsed.type === 'series' || parsed.type === 'episode' || parsed.type === 'anime-episode')) {
    const season = parsed.season !== undefined ? Number(parsed.season) : 1;
    const episode = Number(parsed.episode);
    if (Number.isFinite(season) && Number.isFinite(episode) && episode > 0) {
      return {
        seriesId: parsed.imdbId || parsed.animeId || (parsed.tmdbId ? `tmdb:${parsed.tmdbId}` : null) || parsed.id || parts[0],
        season,
        episode,
        type: 'series',
        rawId: videoId,
        partsCount
      };
    }
  }

  // Regex fallback: id:season:episode or platform:id:episode
  if (partsCount === 3) {
    const s = parseInt(parts[1], 10);
    const e = parseInt(parts[2], 10);
    if (!isNaN(s) && !isNaN(e) && e > 0) {
      return {
        seriesId: parts[0],
        season: s,
        episode: e,
        type: 'series',
        rawId: videoId,
        partsCount: 3
      };
    }
  } else if (partsCount === 4) {
    const s = parseInt(parts[2], 10);
    const e = parseInt(parts[3], 10);
    if (!isNaN(s) && !isNaN(e) && e > 0) {
      return {
        seriesId: `${parts[0]}:${parts[1]}`,
        season: s,
        episode: e,
        type: 'series',
        rawId: videoId,
        partsCount: 4
      };
    }
  }

  return null;
}

/**
 * Compute the next episode video ID from the current video ID preserving platform ID structure.
 * e.g. tt1234567:1:3 -> tt1234567:1:4
 *      kitsu:1234:5 -> kitsu:1234:6
 *      tmdb:1234:2:5 -> tmdb:1234:2:6
 * @param {string|Object} videoInput
 * @returns {string|null}
 */
function computeNextEpisodeVideoId(videoInput) {
  const series = parseSeriesVideoId(videoInput);
  if (!series) return null;

  const nextEpisode = series.episode + 1;
  const rawId = series.rawId;
  const parts = rawId.split(':');

  if (parts.length === 3) {
    // e.g. tt1234567:1:3 -> tt1234567:1:4 OR kitsu:1234:5 -> kitsu:1234:6
    return `${parts[0]}:${parts[1]}:${nextEpisode}`;
  } else if (parts.length === 4) {
    // e.g. tmdb:1234:1:3 -> tmdb:1234:1:4 OR kitsu:1234:1:5 -> kitsu:1234:1:6
    return `${parts[0]}:${parts[1]}:${parts[2]}:${nextEpisode}`;
  }

  return `${series.seriesId}:${series.season}:${nextEpisode}`;
}

/**
 * Schedule predictive pre-translation of the next series episode in the background.
 * Fire-and-forget: does not block the caller or throw unhandled rejections.
 * 
 * @param {Object} options
 * @param {string} options.currentVideoId - Current videoId (e.g. tt1234567:1:3)
 * @param {string} options.targetLanguage - Target language code or name
 * @param {Object} options.config - User configuration object
 * @returns {Promise<{ scheduled: boolean, nextVideoId?: string, reason?: string }>}
 */
async function scheduleNextEpisodePreTranslation(options = {}) {
  const { currentVideoId, targetLanguage, config } = options;

  if (!config || config.bingeModeEnabled !== true) {
    return { scheduled: false, reason: 'binge_mode_disabled' };
  }

  if (!currentVideoId || !targetLanguage) {
    return { scheduled: false, reason: 'missing_parameters' };
  }

  const series = parseSeriesVideoId(currentVideoId);
  if (!series) {
    return { scheduled: false, reason: 'not_a_series' };
  }

  const nextVideoId = computeNextEpisodeVideoId(currentVideoId);
  if (!nextVideoId) {
    return { scheduled: false, reason: 'cannot_determine_next_episode' };
  }

  const jobKey = `${config.__configHash || 'default'}:${nextVideoId}:${targetLanguage}`;
  if (inFlightBingeJobs.has(jobKey)) {
    log.debug(() => `[BingeMode] Next episode job already in-flight for ${nextVideoId} -> ${targetLanguage}`);
    return { scheduled: false, reason: 'already_in_flight', nextVideoId };
  }

  // Execute asynchronously in background
  inFlightBingeJobs.set(jobKey, Date.now());

  (async () => {
    try {
      log.info(() => `[BingeMode] Predictive pre-translation started for next episode: ${nextVideoId} (${targetLanguage})`);

      // 1. Resolve media context for the next episode
      try {
        await resolveMediaContext(nextVideoId);
      } catch (err) {
        log.debug(() => `[BingeMode] Media context fetch failed for ${nextVideoId}: ${err.message}`);
      }

      // 2. Query subtitle providers for candidate source subtitles for the next episode
      const { createSubtitleHandler } = require('../handlers/subtitles');
      const subHandler = createSubtitleHandler(config);

      const subtitleResults = await subHandler({
        type: 'series',
        id: nextVideoId
      });

      const subtitles = subtitleResults?.subtitles || [];
      if (!Array.isArray(subtitles) || subtitles.length === 0) {
        log.debug(() => `[BingeMode] No candidate source subtitles found for ${nextVideoId}`);
        return;
      }

      // Find the best source subtitle (prefer English or configured source languages, exclude already-translated ones)
      const candidate = subtitles.find(s => {
        const isMakeSub = s.id && (s.id.startsWith('make_') || s.id.startsWith('v3_') || s.id.startsWith('subdl_') || s.id.startsWith('subsource_') || s.id.startsWith('wyzie_') || s.id.startsWith('scs_'));
        return isMakeSub && !s.id.includes('_translated_');
      }) || subtitles[0];

      if (!candidate || !candidate.id) {
        log.debug(() => `[BingeMode] No translatable candidate found for ${nextVideoId}`);
        return;
      }

      // 3. Trigger translation via handleTranslation (which checks cache, downloads, translates, and saves to storage)
      const { handleTranslation } = require('../handlers/subtitles');
      await handleTranslation(
        candidate.id,
        targetLanguage,
        config,
        {
          videoId: nextVideoId,
          isBingePrefetch: true
        }
      );

      log.info(() => `[BingeMode] Successfully pre-translated next episode ${nextVideoId} -> ${targetLanguage}`);
    } catch (err) {
      log.warn(() => `[BingeMode] Pre-translation failed for ${nextVideoId}: ${err.message}`);
    } finally {
      inFlightBingeJobs.delete(jobKey);
    }
  })().catch(err => {
    inFlightBingeJobs.delete(jobKey);
    log.debug(() => `[BingeMode] Uncaught worker error: ${err.message}`);
  });

  return { scheduled: true, nextVideoId };
}

module.exports = {
  parseSeriesVideoId,
  computeNextEpisodeVideoId,
  scheduleNextEpisodePreTranslation,
  inFlightBingeJobs
};
