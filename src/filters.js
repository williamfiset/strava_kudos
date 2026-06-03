/**
 * Activity filtering and validation utilities
 */
import { logger } from './logger.js';
import { getLastAction } from './athleteState.js';

/**
 * Filter activities based on configuration rules and per-athlete alternation state.
 * Processes activities oldest-first (by id) so that state reflects the newest decision.
 *
 * @param {Array} activities - Array of activities to filter
 * @param {Object} config - Configuration object with filtering rules
 * @param {Object} state - Per-athlete state used for alternation
 * @param {Object} [options] - Filtering options
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.verbose=false]
 * @returns {{toKudo: Array, alternationSkipped: Array}}
 */
export function filterActivities(activities, config, state, options = {}) {
    const { dryRun = false } = options;
    const toKudo = [];
    const alternationSkipped = [];

    // Sort oldest first so alternation decisions cascade in chronological order.
    const sorted = [...activities].sort((a, b) => Number(a.id) - Number(b.id));

    sorted.forEach((activityItem) => {
        const stats = extractActivityStats(activityItem);
        const reason = shouldSkipActivity(activityItem, config, stats);

        logger.debug(`Athlete: ${activityItem.athlete.athleteName}, Activity: ${activityItem.activityName}, Type: ${activityItem.type}, Has Kudoed: ${activityItem.kudosAndComments.hasKudoed}, Stats:`, stats);

        if (reason) {
            logger.debug(`--- ${reason}`);
            return;
        }

        // Whitelisted names bypass the every-other rule.
        const whitelisted = matchesWhitelist(activityItem.activityName, config.kudoRules);

        if (!whitelisted) {
            const lastAction = getLastAction(state, activityItem.athlete.athleteId);
            if (lastAction === 'kudoed') {
                logger.debug(`--- Alternation: skipping (last action for this athlete was 'kudoed')`);
                alternationSkipped.push(activityItem);
                return;
            }
        }

        const actionText = dryRun ? 'Would give kudos' : 'Will give kudos';
        logger.debug(`+++ ${actionText}${whitelisted ? ' (whitelist override)' : ''}`);
        toKudo.push(activityItem);
    });

    return { toKudo, alternationSkipped };
}

/**
 * Determine if an activity should be skipped for kudos based on the base rules.
 * @param {Object} activity - Activity object
 * @param {Object} config - Configuration object
 * @param {Object} stats - Extracted activity stats
 * @returns {string|null} Reason to skip, or null if should not skip
 */
function shouldSkipActivity(activity, config, stats) {
    if (activity.athlete.athleteId == config.athleteId) return "It's my own activity 😎";
    if (activity.kudosAndComments.hasKudoed) return 'Already kudoed this activity';
    if (config.ignoreAthletes && config.ignoreAthletes.includes(activity.athlete.athleteId)) return 'Athlete is in ignore list';
    if (config.maxActivityAgeHours > 0) {
        const ageHours = getActivityAgeHours(activity);
        if (ageHours !== null && ageHours > config.maxActivityAgeHours) return `Activity is too old (${ageHours.toFixed(1)}h > ${config.maxActivityAgeHours}h)`;
    }
    if (config.kudoRules && shouldSkipForStats(stats, activity.type, activity.activityName, config.kudoRules)) return 'Activity stats do not meet criteria';
    return null;
}

/**
 * Get the age of an activity in hours, or null if no parseable timestamp exists.
 * Uses `startDate` (individual activities) with a `start_date` fallback for GroupActivity shapes.
 * @param {Object} activity
 * @returns {number|null}
 */
function getActivityAgeHours(activity) {
    const raw = activity.startDate || activity.start_date;
    if (!raw) return null;
    const ts = new Date(raw).getTime();
    if (Number.isNaN(ts)) return null;
    return (Date.now() - ts) / (1000 * 60 * 60);
}

/**
 * Check if an activity's title matches any whitelist regex.
 * @param {string} activityName
 * @param {Object} [kudoRules]
 * @returns {boolean}
 */
function matchesWhitelist(activityName, kudoRules) {
    if (!kudoRules?.activityNames?.length) return false;
    for (const namePattern of kudoRules.activityNames) {
        const regex = new RegExp(namePattern, 'i');
        if (regex.test(activityName)) return true;
    }
    return false;
}

/**
 * Check if activity should be skipped based on statistical rules
 * @param {Object} stats - Activity statistics
 * @param {string} activityType - Type of activity
 * @param {string} activityName - Name of activity
 * @param {Object} kudoRules - Rules for giving kudos
 * @returns {boolean} True if should skip, false otherwise
 */
function shouldSkipForStats(stats, activityType, activityName, kudoRules) {
    // Whitelisted names bypass the distance/time gates.
    if (matchesWhitelist(activityName, kudoRules)) return false;

    if (kudoRules.minDistance && kudoRules.minDistance[activityType]) {
        if (!stats.Distance) return true;
        const distance = parseDistance(stats.Distance);
        if (distance < kudoRules.minDistance[activityType]) return true;
    }

    if (kudoRules.minTime && kudoRules.minTime[activityType]) {
        if (!stats.Time) return true;
        const timeInMinutes = parseTimeToMinutes(stats.Time);
        if (timeInMinutes < kudoRules.minTime[activityType]) return true;
    }

    return false;
}

/**
 * Extract activity statistics from activity object
 * @param {Object} activityItem - Activity object containing stats
 * @returns {Object} Extracted statistics mapped by subtitle
 */
function extractActivityStats(activityItem) {
    const stats = {};

    if (!activityItem.stats || !Array.isArray(activityItem.stats)) return stats;

    activityItem.stats.forEach((stat) => {
        const subtitleKey = `${stat.key}_subtitle`;
        let subtitle;

        for (const s of activityItem.stats) {
            if (s.key === subtitleKey) {
                subtitle = s.value;
                break;
            }
        }

        if (subtitle && stat.value) {
            const value = stat.value.replace(/<[^>]*>/g, '').trim();
            stats[subtitle] = value;
        }
    });

    return stats;
}

/**
 * Parse time string to minutes
 * @param {string} timeStr - Time string (e.g., "1h 30m", "45m")
 * @returns {number} Total minutes
 */
function parseTimeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;

    let totalMinutes = 0;
    const hoursMatch = timeStr.match(/(\d+)\s*h/i);
    const minutesMatch = timeStr.match(/(\d+)\s*m/i);

    if (hoursMatch) totalMinutes += parseInt(hoursMatch[1], 10) * 60;
    if (minutesMatch) totalMinutes += parseInt(minutesMatch[1], 10);

    return totalMinutes;
}

/**
 * Parse distance string to numeric value
 * @param {string} distanceStr - Distance string (e.g., "5.2 km", "3.1 mi")
 * @returns {number} Distance as number
 */
function parseDistance(distanceStr) {
    if (!distanceStr || typeof distanceStr !== 'string') return 0;

    const match = distanceStr.match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : 0;
}
