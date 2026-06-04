import { readFile, writeFile } from 'fs/promises';
import { logger } from './logger.js';
import type { ActionType, Athlete, AthleteState } from './types.js';

const STATE_FILE = 'athleteState.json';

/**
 * Load athlete state from disk. Returns an empty object if the file doesn't exist.
 */
export async function loadAthleteState(): Promise<AthleteState> {
    try {
        const data = await readFile(STATE_FILE, 'utf8');
        return JSON.parse(data) as AthleteState;
    } catch (err) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            logger.debug(`No existing ${STATE_FILE} found, starting with empty state`);
            return {};
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load athlete state from ${STATE_FILE}: ${message}`);
    }
}

/**
 * Persist athlete state to disk.
 */
export async function saveAthleteState(state: AthleteState): Promise<void> {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    logger.debug(`Saved athlete state to ${STATE_FILE} (${Object.keys(state).length} athletes tracked)`);
}

/**
 * Get the number of hours since the last kudos was given to an athlete.
 * Returns null if the athlete has never been kudoed or the timestamp is unparseable.
 */
export function getHoursSinceLastKudos(state: AthleteState, athleteId: string | number): number | null {
    const entry = state[String(athleteId)];
    if (!entry || entry.lastAction !== 'kudoed') return null;
    const ts = new Date(entry.lastSeenAt).getTime();
    if (Number.isNaN(ts)) return null;
    return (Date.now() - ts) / (1000 * 60 * 60);
}

/**
 * Record an action against an athlete in the state object (mutates).
 */
export function recordAction(state: AthleteState, athlete: Athlete, activityId: string | number, action: ActionType): void {
    state[String(athlete.athleteId)] = {
        athleteName: athlete.athleteName,
        lastActivityId: String(activityId),
        lastAction: action,
        lastSeenAt: toPacificISOString(new Date()),
    };
}

/**
 * Format a date as an ISO-8601 string in US Pacific time, including the
 * UTC offset (e.g. "2026-06-04T10:30:00-07:00"). DST is handled automatically.
 *
 * Keeping the offset makes the value both human-readable in Pacific time and
 * parseable by `new Date(...)`, so cooldown math stays correct.
 */
function toPacificISOString(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'longOffset',
    }).formatToParts(date);

    const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';

    // `longOffset` yields e.g. "GMT-07:00"; strip the prefix to get "-07:00".
    const offset = get('timeZoneName').replace('GMT', '') || '+00:00';

    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}
