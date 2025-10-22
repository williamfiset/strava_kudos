/**
 * Activity filtering and validation utilities
 */
import { logger } from './logger.js';

/**
 * Filter activities based on configuration rules
 * @param {Array} activities - Array of activities to filter
 * @param {Object} config - Configuration object with filtering rules
 * @param {Object} [options] - Filtering options
 * @param {boolean} [options.dryRun=false] - Whether this is a dry run
 * @param {boolean} [options.verbose=false] - Whether to log detailed information
 * @returns {Array} Filtered activities that should receive kudos
 */
export function filterActivities(activities, config, options = {}) {
    const { dryRun = false, verbose = false } = options;
    const filteredActivities = [];

    activities.forEach((activityItem) => {
        const stats = extractActivityStats(activityItem);
        const reason = shouldSkipActivity(activityItem, config, stats);

        logger.debug(`Athlete: ${activityItem.athlete.athleteName}, Activity: ${activityItem.activityName}, Type: ${activityItem.type}, Has Kudoed: ${activityItem.kudosAndComments.hasKudoed}, Stats:`, stats);

        if (reason) {
            logger.debug(`--- ${reason}`);
            return;
        }

        const actionText = dryRun ? 'Would give kudos' : 'Will give kudos';
        logger.debug(`+++ ${actionText}`);

        filteredActivities.push(activityItem);
    });

    return filteredActivities;
}

/**
 * Determine if an activity should be skipped for kudos
 * @param {Object} activity - Activity object
 * @param {Object} config - Configuration object
 * @param {Object} stats - Extracted activity stats
 * @returns {string|null} Reason to skip, or null if should not skip
 */
function shouldSkipActivity(activity, config, stats) {
    // Skip own activities
    if (activity.athlete.athleteId == config.athleteId) return "It's my own activity 😎";

    // Skip already kudoed activities
    if (activity.kudosAndComments.hasKudoed) return 'Already kudoed this activity';

    // Skip ignored athletes
    if (config.ignoreAthletes && config.ignoreAthletes.includes(activity.athlete.athleteId)) return 'Athlete is in ignore list';

    // Check if activity meets kudo rules
    if (config.kudoRules && shouldSkipForStats(stats, activity.type, activity.activityName, config.kudoRules)) return 'Activity stats do not meet criteria';

    return null; // Don't skip
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
    // Check activity name patterns (if matches, don't skip)
    if (kudoRules.activityNames && kudoRules.activityNames.length > 0) {
        for (const namePattern of kudoRules.activityNames) {
            const regex = new RegExp(namePattern, 'i');
            if (regex.test(activityName)) return false; // Name matches, give kudos
        }
    }

    // Check minimum distance requirements
    if (kudoRules.minDistance && kudoRules.minDistance[activityType]) {
        if (!stats.Distance) return true;

        const distance = parseDistance(stats.Distance);
        if (distance < kudoRules.minDistance[activityType]) return true;
    }

    // Check minimum time requirements
    if (kudoRules.minTime && kudoRules.minTime[activityType]) {
        if (!stats.Time) return true;

        const timeInMinutes = parseTimeToMinutes(stats.Time);
        if (timeInMinutes < kudoRules.minTime[activityType]) return true;
    }

    return false; // Meets all criteria, don't skip
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

        // Find corresponding subtitle
        for (const s of activityItem.stats) {
            if (s.key === subtitleKey) {
                subtitle = s.value;
                break;
            }
        }

        if (subtitle && stat.value) {
            // Clean HTML tags and whitespace from value
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

    // Extract numeric value from string
    const match = distanceStr.match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : 0;
}
