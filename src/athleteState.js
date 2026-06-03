import { readFile, writeFile } from 'fs/promises';
import { logger } from './logger.js';

const STATE_FILE = 'athleteState.json';

/**
 * @typedef {Object} AthleteEntry
 * @property {string} [athleteName] - Display name of the athlete (for human readability)
 * @property {string} lastActivityId - ID of the most recently processed activity
 * @property {'kudoed'|'skipped'} lastAction - What we did with that activity
 * @property {string} lastSeenAt - ISO timestamp of the decision
 */

/**
 * Load athlete state from disk. Returns an empty object if the file doesn't exist.
 * @returns {Promise<Object<string, AthleteEntry>>}
 */
export async function loadAthleteState() {
    try {
        const data = await readFile(STATE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            logger.debug(`No existing ${STATE_FILE} found, starting with empty state`);
            return {};
        }
        throw new Error(`Failed to load athlete state from ${STATE_FILE}: ${err.message}`);
    }
}

/**
 * Persist athlete state to disk.
 * @param {Object<string, AthleteEntry>} state
 */
export async function saveAthleteState(state) {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    logger.debug(`Saved athlete state to ${STATE_FILE} (${Object.keys(state).length} athletes tracked)`);
}

/**
 * Get the last action recorded for an athlete.
 * @param {Object<string, AthleteEntry>} state
 * @param {string|number} athleteId
 * @returns {'kudoed'|'skipped'|null}
 */
export function getLastAction(state, athleteId) {
    return state[String(athleteId)]?.lastAction || null;
}

/**
 * Record an action against an athlete in the state object (mutates).
 * @param {Object<string, AthleteEntry>} state
 * @param {Object} athlete - { athleteId, athleteName }
 * @param {string|number} activityId
 * @param {'kudoed'|'skipped'} action
 */
export function recordAction(state, athlete, activityId, action) {
    state[String(athlete.athleteId)] = {
        athleteName: athlete.athleteName,
        lastActivityId: String(activityId),
        lastAction: action,
        lastSeenAt: new Date().toISOString(),
    };
}
