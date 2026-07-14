import { readFile, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { existsSync } from 'fs';
import { logger } from './logger.js';
import type { Config, Credentials, RawConfig } from './types.js';

const DEFAULT_MAX_ACTIVITY_AGE_HOURS = 24;
const DEFAULT_KUDOS_COOLDOWN_HOURS = 36;
const DEFAULT_HEADLESS = true;

const ENV_FILE = '.env';

/**
 * Loads and validates configuration from config files
 * @returns Validated configuration object
 */
export async function loadAndValidateConfig(): Promise<Config> {
    const credentials = loadCredentials();
    const raw = await loadConfig();
    const validated = validateConfig(raw);
    return normalizeConfig(validated, credentials);
}

/**
 * Loads Strava credentials from the .env file. Values are stored base64-encoded
 * (light obfuscation so they're not in plain text) and decoded here.
 * @returns Decoded Strava email and password
 */
function loadCredentials(): Credentials {
    if (!existsSync(ENV_FILE)) throw new Error(`No ${ENV_FILE} file found. Copy .env.example to ${ENV_FILE} and add your base64-encoded Strava credentials.`);

    // Node's built-in .env parser; populates process.env from the file.
    process.loadEnvFile(ENV_FILE);

    const stravaEmail = decodeCredential('STRAVA_EMAIL', process.env.STRAVA_EMAIL);
    const stravaPassword = decodeCredential('STRAVA_PASSWORD', process.env.STRAVA_PASSWORD);
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD ? decodeCredential('GMAIL_APP_PASSWORD', process.env.GMAIL_APP_PASSWORD) : undefined;

    return { stravaEmail, stravaPassword, gmailAppPassword };
}

/**
 * Base64-decodes a credential value read from the environment.
 * @param name - Environment variable name (for error messages)
 * @param value - Raw base64-encoded value
 * @returns The decoded plain-text credential
 */
function decodeCredential(name: string, value: string | undefined): string {
    if (!value) throw new Error(`'${name}' is missing from ${ENV_FILE}`);

    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (!decoded) throw new Error(`'${name}' in ${ENV_FILE} could not be decoded; expected a base64-encoded value`);

    return decoded;
}

/**
 * Loads configuration from config.json in the project root.
 * @returns Parsed config object
 */
async function loadConfig(): Promise<unknown> {
    const configFile = 'config.json';

    try {
        await access(configFile, fsConstants.F_OK);
    } catch {
        throw new Error('No configuration file found. Please provide config.json in the project root.');
    }

    logger.info(`Using configuration file: ${configFile}`);

    let configRaw: string;
    try {
        configRaw = await readFile(configFile, 'utf8');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read configuration file "${configFile}": ${message}`);
    }

    try {
        return JSON.parse(configRaw);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse configuration file "${configFile}": ${message}`);
    }
}

/**
 * Validates the loaded config object for required fields and correct types
 * @param config - Configuration object to validate
 * @returns The validated config, narrowed to RawConfig
 */
function validateConfig(config: unknown): RawConfig {
    if (!config || typeof config !== 'object') throw new Error('Config is missing or not an object.');

    const c = config as RawConfig;

    if (!c.athleteId) throw new Error("'athleteId' is missing in config");

    // Validate athleteId can be converted to number
    if (isNaN(Number(c.athleteId))) throw new Error("'athleteId' must be a valid number");

    // Validate optional arrays
    if (c.ignoreAthletes && !Array.isArray(c.ignoreAthletes)) throw new Error("'ignoreAthletes' must be an array if provided");

    // Validate maxActivityAgeHours
    if (c.maxActivityAgeHours !== undefined && c.maxActivityAgeHours !== null) {
        const v = Number(c.maxActivityAgeHours);
        if (!Number.isFinite(v) || v < 0) throw new Error("'maxActivityAgeHours' must be a non-negative number if provided");
    }

    // Validate kudosCooldownHours
    if (c.kudosCooldownHours !== undefined && c.kudosCooldownHours !== null) {
        const v = Number(c.kudosCooldownHours);
        if (!Number.isFinite(v) || v < 0) throw new Error("'kudosCooldownHours' must be a non-negative number if provided");
    }

    // Validate headless
    if (c.headless !== undefined && typeof c.headless !== 'boolean') throw new Error("'headless' must be a boolean if provided");

    // Validate kudoRules structure if present
    if (c.kudoRules) {
        const { kudoRules } = c;

        if (kudoRules.minDistance && typeof kudoRules.minDistance !== 'object') throw new Error("'kudoRules.minDistance' must be an object if provided");
        if (kudoRules.minTime && typeof kudoRules.minTime !== 'object') throw new Error("'kudoRules.minTime' must be an object if provided");
        if (kudoRules.activityNames && !Array.isArray(kudoRules.activityNames)) throw new Error("'kudoRules.activityNames' must be an array if provided");
    }

    return c;
}

/**
 * Normalizes configuration values and provides defaults
 * @param config - Raw configuration object
 * @param credentials - Strava credentials loaded from the .env file
 * @returns Normalized configuration
 */
function normalizeConfig(config: RawConfig, credentials: Credentials): Config {
    return {
        stravaEmail: credentials.stravaEmail,
        stravaPassword: credentials.stravaPassword,
        gmailAppPassword: credentials.gmailAppPassword,
        athleteId: Number(config.athleteId),
        ignoreAthletes: config.ignoreAthletes || [],
        maxActivityAgeHours: config.maxActivityAgeHours ?? DEFAULT_MAX_ACTIVITY_AGE_HOURS,
        kudosCooldownHours: config.kudosCooldownHours ?? DEFAULT_KUDOS_COOLDOWN_HOURS,
        headless: config.headless ?? DEFAULT_HEADLESS,
        kudoRules: {
            minDistance: config.kudoRules?.minDistance || {},
            minTime: config.kudoRules?.minTime || {},
            activityNames: config.kudoRules?.activityNames || [],
        },
    };
}
