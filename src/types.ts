/**
 * Shared type definitions for the Strava kudos tool.
 */

/** Rules that determine which activities qualify for kudos. */
export interface KudoRules {
    /** Minimum distance (km/mi as displayed) keyed by activity type. */
    minDistance: Record<string, number>;
    /** Minimum elapsed time (minutes) keyed by activity type. */
    minTime: Record<string, number>;
    /** Regex patterns; a matching activity name always receives kudos. */
    activityNames: string[];
}

/** Fully normalized configuration consumed by the application. */
export interface Config {
    /** Strava account email; used to log in via the browser and obtain a session cookie. */
    stravaEmail: string;
    /** Strava account password; used to log in via the browser and obtain a session cookie. */
    stravaPassword: string;
    athleteId: number;
    ignoreAthletes: (string | number)[];
    maxActivityAgeHours: number;
    /** Run the Playwright login browser without a visible window. Defaults to true. */
    headless: boolean;
    kudoRules: KudoRules;
}

/** Configuration as read from disk, before normalization/defaults. */
export interface RawConfig {
    stravaEmail: string;
    stravaPassword: string;
    athleteId: string | number;
    ignoreAthletes?: (string | number)[];
    maxActivityAgeHours?: number | null;
    headless?: boolean;
    kudoRules?: {
        minDistance?: Record<string, number>;
        minTime?: Record<string, number>;
        activityNames?: string[];
    };
}

/** Athlete reference attached to an activity. */
export interface Athlete {
    athleteId: string | number;
    athleteName: string;
}

/** A single raw stat entry from the dashboard feed. */
export interface ActivityStat {
    key: string;
    value: string;
}

/**
 * An activity from the Strava dashboard feed. Strava returns loosely-typed
 * JSON, so only the fields this tool relies on are declared; the index
 * signature keeps the rest accessible without `any` casts.
 */
export interface Activity {
    id: string | number;
    activityName: string;
    type?: string;
    athlete: Athlete;
    kudosAndComments: { hasKudoed?: boolean };
    stats?: ActivityStat[];
    startDate?: string;
    start_date?: string;
    [key: string]: unknown;
}

/** Extracted, human-readable stats keyed by subtitle (e.g. "Distance"). */
export type ActivityStats = Record<string, string>;

/** Action recorded for an athlete on a given run. */
export type ActionType = 'kudoed' | 'skipped';

/** Persisted per-athlete alternation state entry. */
export interface AthleteEntry {
    /** Display name of the athlete (for human readability). */
    athleteName?: string;
    /** ID of the most recently processed activity. */
    lastActivityId: string;
    /** What we did with that activity. */
    lastAction: ActionType;
    /** ISO timestamp of the decision. */
    lastSeenAt: string;
}

/** Athlete state map keyed by stringified athlete id. */
export type AthleteState = Record<string, AthleteEntry>;

/** Parsed command-line options. */
export interface CliOptions {
    dryRun: boolean;
    verbose: boolean;
    help: boolean;
}
