/**
 * Activity filtering and validation utilities
 */
import { logger } from './logger.js';
import { getHoursSinceLastKudos } from './athleteState.js';
import type { Activity, ActivityStats, AthleteState, Config, KudoRules } from './types.js';

interface FilterOptions {
    dryRun?: boolean;
    verbose?: boolean;
}

interface FilterResult {
    toKudo: Activity[];
    cooldownSkipped: Activity[];
}

/**
 * Filter activities based on configuration rules and a per-athlete kudos cooldown.
 * Processes activities oldest-first (by id) so that, within a single run, an
 * athlete with multiple recent activities only receives one kudos.
 *
 * @param activities - Array of activities to filter
 * @param config - Configuration object with filtering rules
 * @param state - Per-athlete state holding the last kudos timestamp
 * @param options - Filtering options
 */
export function filterActivities(activities: Activity[], config: Config, state: AthleteState, options: FilterOptions = {}): FilterResult {
    const { dryRun = false } = options;
    const toKudo: Activity[] = [];
    const cooldownSkipped: Activity[] = [];

    // Athletes we've already decided to kudos in this run, so we don't kudos
    // multiple of their activities at once (state isn't persisted until later).
    const kudoedThisRun = new Set<string>();

    // Sort oldest first so the earliest activity wins the single per-run kudos.
    const sorted = [...activities].sort((a, b) => Number(a.id) - Number(b.id));

    sorted.forEach((activityItem) => {
        const stats = extractActivityStats(activityItem);
        const reason = shouldSkipActivity(activityItem, config, stats);

        logger.debug(`Athlete: ${activityItem.athlete.athleteName}, Activity: ${activityItem.activityName}, Type: ${activityItem.type}, Has Kudoed: ${activityItem.kudosAndComments.hasKudoed}, Stats:`, stats);

        if (reason) {
            logger.debug(`--- ${reason}`);
            return;
        }

        // Whitelisted names bypass the cooldown. A cooldown of 0 disables it entirely.
        const whitelisted = matchesWhitelist(activityItem.activityName, config.kudoRules);
        const cooldownEnabled = !whitelisted && config.kudosCooldownHours > 0;
        const athleteKey = String(activityItem.athlete.athleteId);

        if (cooldownEnabled) {
            if (kudoedThisRun.has(athleteKey)) {
                logger.debug(`--- Cooldown: skipping (already kudoed this athlete in this run)`);
                cooldownSkipped.push(activityItem);
                return;
            }
            const hoursSinceKudos = getHoursSinceLastKudos(state, activityItem.athlete.athleteId);
            if (hoursSinceKudos !== null && hoursSinceKudos < config.kudosCooldownHours) {
                logger.debug(`--- Cooldown: skipping (last kudos ${hoursSinceKudos.toFixed(1)}h ago < ${config.kudosCooldownHours}h)`);
                cooldownSkipped.push(activityItem);
                return;
            }
        }

        const actionText = dryRun ? 'Would give kudos' : 'Will give kudos';
        logger.debug(`+++ ${actionText}${whitelisted ? ' (whitelist override)' : ''}`);
        toKudo.push(activityItem);
        if (cooldownEnabled) kudoedThisRun.add(athleteKey);
    });

    return { toKudo, cooldownSkipped };
}

/**
 * Determine if an activity should be skipped for kudos based on the base rules.
 * @returns Reason to skip, or null if should not skip
 */
function shouldSkipActivity(activity: Activity, config: Config, stats: ActivityStats): string | null {
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
 */
function getActivityAgeHours(activity: Activity): number | null {
    const raw = activity.startDate || activity.start_date;
    if (!raw) return null;
    const ts = new Date(raw).getTime();
    if (Number.isNaN(ts)) return null;
    return (Date.now() - ts) / (1000 * 60 * 60);
}

/**
 * Check if an activity's title matches any whitelist regex.
 */
function matchesWhitelist(activityName: string, kudoRules?: KudoRules): boolean {
    if (!kudoRules?.activityNames?.length) return false;
    for (const namePattern of kudoRules.activityNames) {
        const regex = new RegExp(namePattern, 'i');
        if (regex.test(activityName)) return true;
    }
    return false;
}

/**
 * Check if activity should be skipped based on statistical rules
 * @returns True if should skip, false otherwise
 */
function shouldSkipForStats(stats: ActivityStats, activityType: string | undefined, activityName: string, kudoRules: KudoRules): boolean {
    // Whitelisted names bypass the distance/time gates.
    if (matchesWhitelist(activityName, kudoRules)) return false;

    if (activityType && kudoRules.minDistance && kudoRules.minDistance[activityType]) {
        if (!stats.Distance) return true;
        const distance = parseDistance(stats.Distance);
        if (distance < kudoRules.minDistance[activityType]) return true;
    }

    if (activityType && kudoRules.minTime && kudoRules.minTime[activityType]) {
        if (!stats.Time) return true;
        const timeInMinutes = parseTimeToMinutes(stats.Time);
        if (timeInMinutes < kudoRules.minTime[activityType]) return true;
    }

    return false;
}

/**
 * Extract activity statistics from activity object
 * @returns Extracted statistics mapped by subtitle
 */
function extractActivityStats(activityItem: Activity): ActivityStats {
    const stats: ActivityStats = {};

    if (!activityItem.stats || !Array.isArray(activityItem.stats)) return stats;

    activityItem.stats.forEach((stat) => {
        const subtitleKey = `${stat.key}_subtitle`;
        let subtitle: string | undefined;

        for (const s of activityItem.stats!) {
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
 * @param timeStr - Time string (e.g., "1h 30m", "45m")
 * @returns Total minutes
 */
function parseTimeToMinutes(timeStr: string): number {
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
 * @param distanceStr - Distance string (e.g., "5.2 km", "3.1 mi")
 * @returns Distance as number
 */
function parseDistance(distanceStr: string): number {
    if (!distanceStr || typeof distanceStr !== 'string') return 0;

    const match = distanceStr.match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : 0;
}
