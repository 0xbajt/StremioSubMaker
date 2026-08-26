const log = require('../utils/logger');
const { parseStremioId } = require('../utils/subtitle');
const { resolveMediaContext } = require('./mediaContextResolver');

// In-flight next-episode jobs tracking (prevents duplicate simultaneous background jobs)
const inFlightBingeJobs = new Set();

/**
 * Parse a videoId string or object to extract series metadata.
 * @param {string|Object} videoInput
 * @returns {{ seriesId: string, season: number, episode: number, type: string, rawId: string }|null}
 */
function parseSeriesVideoId(videoInput) {
  if (!videoInput) return null;

  let videoId = typeof videoInput === 'string' ? videoInput : videoInput.videoId || videoInput.id;
  if (!videoId || typeof videoId !== 'string') return null;

  // Stremio series format: tt1234567:1:3 or kitsu:1234:3
  const parsed = parseStremioId(videoId);
  if (parsed && parsed.type === 'series' && parsed.season !== undefined && parsed.episode !== undefined) {
    const season = Number(parsed.season);
    const episode = Number(parsed.episode);
    if (Number.isFinite(season) && Number.isFinite(episode) && episode > 0) {
      return {
        seriesId: parsed.imdbId || parsed.animeId || parsed.id || videoId.split(':')[0],
        season,
        episode,
        type: 'series',
        rawId: videoId
      };
    }
  }

  // Regex fallback: id:season:episode
  const parts = videoId.split(':');
  if (parts.length === 3) {
    const s = parseInt(parts[1], 10);
    const e = parseInt(parts[2], 10);
    if (!isNaN(s) && !isNaN(e) && e > 0) {
      return {
        seriesId: parts[0],
        season: s,
        episode: e,
        type: 'series',
        rawId: videoId
      };
    }
  }

  return null;
}

/**
 * Compute the next episode video ID from the current video ID.
 * e.g. tt1234567:1:3 -> tt1234567:1:4
 * @param {string|Object} videoInput
 * @returns {string|null}
 */
function computeNextEpisodeVideoId(videoInput) {
  const series = parseSeriesVideoId(videoInput);
  if (!series) return null;

  const nextEpisode = series.episode + 1;
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
  inFlightBingeJobs.add(jobKey);

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
