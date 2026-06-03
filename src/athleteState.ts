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
 * Get the last action recorded for an athlete.
 */
export function getLastAction(state: AthleteState, athleteId: string | number): ActionType | null {
    return state[String(athleteId)]?.lastAction || null;
}

/**
 * Record an action against an athlete in the state object (mutates).
 */
export function recordAction(state: AthleteState, athlete: Athlete, activityId: string | number, action: ActionType): void {
    state[String(athlete.athleteId)] = {
        athleteName: athlete.athleteName,
        lastActivityId: String(activityId),
        lastAction: action,
        lastSeenAt: new Date().toISOString(),
    };
}
