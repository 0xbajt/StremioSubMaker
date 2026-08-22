const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const PASSWORD_BYTES = 32; // 256-bit password
const DEFAULT_PASSWORD_FILE = path.join(process.cwd(), '.redis-password');
let cachedPassword = null;

function resolvePasswordFilePath() {
    return process.env.REDIS_PASSWORD_FILE || DEFAULT_PASSWORD_FILE;
}

function loadPasswordFromFile(passwordFile) {
    try {
        if (fs.existsSync(passwordFile)) {
            const password = fs.readFileSync(passwordFile, 'utf8').trim();
            if (password) {
                log.debug(() => ['[RedisHelper] Using Redis password from file:', passwordFile]);
                return password;
            }
            log.warn(() => ['[RedisHelper] Redis password file is empty, regenerating:', passwordFile]);
        }
    } catch (err) {
        log.error(() => ['[RedisHelper] Failed to read Redis password file:', err.message]);
        throw err;
    }
    return null;
}

function ensurePasswordDirectory(passwordFile) {
    const dir = path.dirname(passwordFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
    fs.accessSync(dir, fs.constants.W_OK);
}

function persistPassword(passwordFile, password) {
    try {
        ensurePasswordDirectory(passwordFile);
        fs.writeFileSync(passwordFile, password, { mode: 0o600 });
        log.warn(() => ['[RedisHelper] Generated new Redis password and saved to:', passwordFile]);
        log.warn(() => '[RedisHelper] Persist this file (volume/bind mount) so Redis stays accessible across restarts.');
    } catch (err) {
        log.error(() => ['[RedisHelper] Failed to persist Redis password to file:', err.message]);
        throw err;
    }
}

function generatePassword() {
    return crypto.randomBytes(PASSWORD_BYTES).toString('hex');
}

function parseRedisUrl(redisUrl) {
    const raw = redisUrl || process.env.REDIS_URL;
    if (!raw || typeof raw !== 'string') {
        return null;
    }
    try {
        const parsed = new URL(raw.trim());
        const isTls = parsed.protocol === 'rediss:';
        const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
        const host = parsed.hostname;
        const port = parsed.port ? parseInt(parsed.port, 10) : 6379;
        const pathname = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
        const db = pathname ? parseInt(pathname, 10) : undefined;
        return {
            host,
            port,
            password,
            db: Number.isFinite(db) ? db : undefined,
            tls: (isTls || process.env.REDIS_TLS === 'true') ? {} : undefined
        };
    } catch (e) {
        log.warn(() => `[RedisHelper] Failed to parse REDIS_URL: ${e.message}`);
        return null;
    }
}

/**
 * Get Redis password from environment or persistent file.
 * Priority:
 * 1. REDIS_PASSWORD (env var)
 * 2. REDIS_URL (parsed password)
 * 3. REDIS_PASSWORD_FILE (auto-generated and persisted)
 * @returns {string|undefined} Redis password or undefined if not configured
 */
function getRedisPassword() {
    if (cachedPassword) {
        return cachedPassword;
    }

    const envPassword = (process.env.REDIS_PASSWORD || '').trim();
    if (envPassword) {
        cachedPassword = envPassword;
        log.debug(() => '[RedisHelper] Using Redis password from environment variable');
        return cachedPassword;
    }

    const fromUrl = parseRedisUrl(process.env.REDIS_URL);
    if (fromUrl && fromUrl.password) {
        cachedPassword = fromUrl.password;
        log.debug(() => '[RedisHelper] Using Redis password from REDIS_URL');
        return cachedPassword;
    }

    const passwordFile = resolvePasswordFilePath();
    const shouldUseFile = Boolean(process.env.REDIS_PASSWORD_FILE) || fs.existsSync(passwordFile);

    if (!shouldUseFile) {
        log.warn(() => '[RedisHelper] No Redis password configured (env or file)');
        return undefined;
    }

    const filePassword = loadPasswordFromFile(passwordFile);
    if (filePassword) {
        cachedPassword = filePassword;
        return cachedPassword;
    }

    cachedPassword = generatePassword();
    persistPassword(passwordFile, cachedPassword);
    return cachedPassword;
}

module.exports = {
    getRedisPassword,
    parseRedisUrl
};
