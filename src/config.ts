import { readFile, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { logger } from './logger.js';
import yaml from 'js-yaml';
import type { Config, RawConfig } from './types.js';

const DEFAULT_MAX_ACTIVITY_AGE_HOURS = 24;

/**
 * Loads and validates configuration from config files
 * @returns Validated configuration object
 */
export async function loadAndValidateConfig(): Promise<Config> {
    const raw = await loadConfig();
    const validated = validateConfig(raw);
    return normalizeConfig(validated);
}

/**
 * Loads configuration from config.json, config.yaml, or config.yml in the project root.
 * Enforces exclusivity: throws if more than one config file is present.
 * @returns Parsed config object
 */
async function loadConfig(): Promise<unknown> {
    const configFiles = ['config.json', 'config.yaml', 'config.yml'];
    const found: string[] = [];

    for (const file of configFiles) {
        try {
            await access(file, fsConstants.F_OK);
            found.push(file);
        } catch {} // File doesn't exist, continue to next
    }

    if (found.length === 0) throw new Error('No configuration file found. Please provide one of: config.json, config.yaml, or config.yml in the project root.');

    const configFile = found[0];
    logger.info(`Using configuration file: ${configFile}`);

    let configRaw: string;
    try {
        configRaw = await readFile(configFile, 'utf8');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read configuration file "${configFile}": ${message}`);
    }

    try {
        if (configFile.endsWith('.json')) return JSON.parse(configRaw);
        else if (configFile.endsWith('.yaml') || configFile.endsWith('.yml')) return yaml.load(configRaw);
        else throw new Error(`Unsupported config file extension: ${configFile}`);
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

    if (!c.stravaSessionCookie || typeof c.stravaSessionCookie !== 'string') throw new Error("'stravaSessionCookie' is missing or not a string in config");
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
 * @returns Normalized configuration
 */
function normalizeConfig(config: RawConfig): Config {
    return {
        stravaSessionCookie: config.stravaSessionCookie,
        athleteId: Number(config.athleteId),
        ignoreAthletes: config.ignoreAthletes || [],
        maxActivityAgeHours: config.maxActivityAgeHours ?? DEFAULT_MAX_ACTIVITY_AGE_HOURS,
        kudoRules: {
            minDistance: config.kudoRules?.minDistance || {},
            minTime: config.kudoRules?.minTime || {},
            activityNames: config.kudoRules?.activityNames || [],
        },
    };
}
