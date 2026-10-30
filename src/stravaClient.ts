import https from 'https';
import type { IncomingMessage } from 'http';
import { decode } from 'html-entities';
import type { Activity } from './types.js';

interface StravaClientOptions {
    timeout?: number;
}

/**
 * As of late 2026, Strava redirects `/dashboard` requests to a Next.js-based
 * dashboard behind this query param (`GET /dashboard` 302s to
 * `/dashboard?dashboard_next=1` even with a valid session). Requesting it
 * directly avoids that redirect, which this app's HTTP client doesn't follow.
 */
const DASHBOARD_NEXT_PARAM = 'dashboard_next=1';

/**
 * Internal helper function to make HTTP requests
 * @param options - Request options
 * @param timeout - Request timeout in milliseconds
 * @returns Response data
 */
function makeRequest(options: https.RequestOptions, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const requestOptions: https.RequestOptions = {
            ...options,
            timeout: timeout,
        };

        const req = https.request(requestOptions, (res: IncomingMessage) => {
            let data = '';

            // Handle non-200 status codes
            const statusCode = res.statusCode ?? 0;
            if (statusCode < 200 || statusCode >= 300) {
                const error: Error & { statusCode?: number } = new Error(`HTTP ${statusCode}: ${res.statusMessage}`);
                error.statusCode = statusCode;
                reject(error);
                return;
            }

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve(data);
            });
        });

        req.on('error', (e) => {
            reject(new Error(`Request failed: ${e.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Request timeout after ${timeout}ms`));
        });

        req.setTimeout(timeout);
        req.end();
    });
}

/**
 * Get CSRF token from Strava dashboard
 * @param cookieValue - Session cookie value
 * @param timeout - Request timeout in milliseconds
 * @returns CSRF token
 */
async function getCsrfToken(cookieValue: string, timeout: number): Promise<string> {
    const options: https.RequestOptions = {
        hostname: 'www.strava.com',
        path: `/dashboard?${DASHBOARD_NEXT_PARAM}`,
        method: 'GET',
        headers: {
            Cookie: cookieValue,
        },
    };

    const data = await makeRequest(options, timeout);
    // The pre-"dashboard_next" page used name="csrf-token"; the current Next.js
    // dashboard renamed the meta tag to name="csrf". Accept either.
    const csrfTokenMatch = data.match(/<meta name="csrf(?:-token)?" content="([^"]+)"/);

    if (csrfTokenMatch) {
        const csrfToken = csrfTokenMatch[1];
        return csrfToken;
    } else {
        throw new Error('CSRF Token not found in response - possibly invalid session cookie');
    }
}

/**
 * Transform group activity to standard activity format
 * @param activity - Group activity object
 * @returns Normalized activity object
 */
function transformGroupActivity(activity: Record<string, any>): Activity {
    return {
        ...activity,
        activityName: activity.name,
        id: activity.activity_id,
        athlete: {
            athleteId: activity.athlete_id,
            athleteName: activity.athlete_name,
        },
        kudosAndComments: {
            hasKudoed: activity.has_kudoed,
        },
    } as Activity;
}

/** One page of raw feed entries plus whether Strava has more pages available. */
interface FeedPage {
    entries: any[];
    hasMore: boolean;
}

/** Cursor identifying a feed entry, used to request the next page after it. */
interface FeedCursor {
    /** `cursorData.updated_at` of the entry - becomes the `before` query param. */
    before: number;
    /** `cursorData.rank` of the entry - becomes the `cursor` query param. */
    cursor: number;
}

/**
 * Extracts one page of raw feed entries from the current Next.js dashboard's
 * embedded `__NEXT_DATA__` script tag. Each entry has an `entity` type
 * ('Activity', 'GroupActivity', 'Post', 'Challenge', ...) and either an
 * `activity` object or a group `rowData.activities` array.
 * @returns The page, or null if `__NEXT_DATA__` isn't present/parseable
 *   (e.g. Strava reverts to or A/B-tests the older dashboard).
 */
function extractFeedPageFromNextData(htmlData: string): FeedPage | null {
    const match = htmlData.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;

    try {
        const nextData = JSON.parse(match[1]);
        const feed = nextData?.props?.pageProps?.dashboardData?.feed;
        const entries = feed?.entries;
        if (!Array.isArray(entries)) return null;
        return { entries, hasMore: Boolean(feed?.pagination?.hasMore) };
    } catch (parseError) {
        console.warn('Failed to parse __NEXT_DATA__:', parseError instanceof Error ? parseError.message : String(parseError));
        return null;
    }
}

/**
 * Extracts one page of raw feed entries from the pre-"dashboard_next" dashboard's
 * `data-react-props` attributes (legacy format, kept as a fallback). That format
 * doesn't expose a pagination cursor, so `hasMore` is always false.
 * @returns The page (possibly with no entries, if none are found/parseable)
 */
function extractFeedPageFromReactProps(htmlData: string): FeedPage {
    const reactPropsMatches = [...htmlData.matchAll(/data-react-props='([^']+)'/g)].map((match) => match[1]);
    const entries: any[] = [];

    reactPropsMatches.forEach((match) => {
        try {
            const reactProps = JSON.parse(decode(match));
            entries.push(...(reactProps?.appContext?.feedProps?.preFetchedEntries || []));
        } catch (parseError) {
            // Skip malformed JSON, continue processing
            console.warn('Failed to parse react props:', parseError instanceof Error ? parseError.message : String(parseError));
        }
    });

    return { entries, hasMore: false };
}

/**
 * Finds the pagination cursor for the page *after* the given entries, taken
 * from the last entry's `cursorData` (every entity type carries one).
 * @returns The cursor, or null if no entry has usable cursor data
 */
function getNextCursor(entries: any[]): FeedCursor | null {
    for (let i = entries.length - 1; i >= 0; i--) {
        const cursorData = entries[i]?.cursorData;
        if (cursorData && typeof cursorData.updated_at === 'number' && typeof cursorData.rank === 'number') {
            return { before: cursorData.updated_at, cursor: cursorData.rank };
        }
    }
    return null;
}

/**
 * Converts raw feed entries (as returned by the dashboard page or the
 * `/dashboard/feed` pagination endpoint) into normalized activities.
 * @param entries - Raw feed entries
 * @returns Normalized, deduplicated activities
 */
function entriesToActivities(entries: any[]): Activity[] {
    let activities: Activity[] = [];

    entries.forEach((entry: any) => {
        if (entry.entity === 'Activity') activities.push(entry.activity);
        else if (entry.entity === 'GroupActivity') activities.push(...entry.rowData.activities.map(transformGroupActivity));
    });

    if (activities.length === 0) throw new Error('No activities found - check session cookie validity');

    // Remove newlines from activity names
    activities = activities.map((activity) => ({
        ...activity,
        activityName: activity.activityName?.replace(/\n/g, ' ') || activity.activityName,
    }));

    return activities;
}

/**
 * Strava API client for authentication and data fetching
 */
export class StravaClient {
    private sessionCookie: string;
    private timeout: number;
    private cookieValue: string;
    csrfToken: string | null;

    constructor(sessionCookie: string, options: StravaClientOptions = {}) {
        this.sessionCookie = sessionCookie;
        this.timeout = options.timeout || 30000; // 30 second timeout
        this.cookieValue = `_strava4_session=${sessionCookie}`;
        this.csrfToken = null;
    }

    /**
     * Initialize the client by fetching the CSRF token
     */
    async initialize(): Promise<void> {
        this.csrfToken = await getCsrfToken(this.cookieValue, this.timeout);
    }

    /**
     * Get activities from Strava dashboard. The initial dashboard page only
     * embeds its first ~10 feed entries server-side (Strava's current Next.js
     * dashboard ignores the old `num_entries` param entirely); to reach
     * `numEntries`, this pages through Strava's `/dashboard/feed` endpoint -
     * the same one the dashboard's own infinite scroll calls - using the
     * cursor on the last entry of each page.
     * @param myAthleteID - User's athlete ID
     * @param numEntries - Minimum number of raw feed entries to fetch before stopping.
     *   Defaults high enough that a normal run walks the feed to Strava's own
     *   natural end (`hasMore: false`, observed around ~150 entries) rather than
     *   an arbitrary cutoff; the page-count safety cap is the real backstop.
     * @returns Array of activities
     */
    async getActivitiesViaDashboard(myAthleteID: number, numEntries = 200): Promise<Activity[]> {
        if (!this.csrfToken) throw new Error('Client not initialized. Call initialize() first.');

        const options: https.RequestOptions = {
            hostname: 'www.strava.com',
            path: `/dashboard?${DASHBOARD_NEXT_PARAM}`,
            method: 'GET',
            headers: {
                'Cookie': this.cookieValue,
                'x-csrf-token': this.csrfToken,
            },
        };

        const html = await makeRequest(options, this.timeout);
        const firstPage = extractFeedPageFromNextData(html) ?? extractFeedPageFromReactProps(html);

        const entries: any[] = [...firstPage.entries];
        let hasMore = firstPage.hasMore;
        let cursor = getNextCursor(firstPage.entries);

        // Safety cap so a pagination quirk (e.g. hasMore staying true with no
        // new entries) can't turn into an unbounded request loop.
        const MAX_FEED_PAGES = 10;
        for (let page = 0; page < MAX_FEED_PAGES && entries.length < numEntries && hasMore && cursor; page++) {
            const nextPage = await this.fetchFeedPage(myAthleteID, cursor);
            if (nextPage.entries.length === 0) break;

            entries.push(...nextPage.entries);
            hasMore = nextPage.hasMore;
            cursor = getNextCursor(nextPage.entries) ?? cursor;
        }

        return entriesToActivities(entries);
    }

    /**
     * Fetch one page of the "following" feed from Strava's pagination endpoint
     * (the one the dashboard's own infinite scroll uses), starting after `cursor`.
     * @param myAthleteID - User's athlete ID
     * @param cursor - Cursor identifying the last entry already fetched
     * @returns The next page of raw feed entries
     */
    private async fetchFeedPage(myAthleteID: number, cursor: FeedCursor): Promise<FeedPage> {
        if (!this.csrfToken) throw new Error('Client not initialized. Call initialize() first.');

        const options: https.RequestOptions = {
            hostname: 'www.strava.com',
            path: `/dashboard/feed?feed_type=following&athlete_id=${myAthleteID}&before=${cursor.before}&cursor=${cursor.cursor}`,
            method: 'GET',
            headers: {
                'Cookie': this.cookieValue,
                'x-csrf-token': this.csrfToken,
            },
        };

        const data = await makeRequest(options, this.timeout);

        let parsed: any;
        try {
            parsed = JSON.parse(data);
        } catch (parseError) {
            throw new Error(`Failed to parse /dashboard/feed response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        }

        const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
        return { entries, hasMore: Boolean(parsed?.pagination?.hasMore) };
    }

    /**
     * Send kudos to an activity
     * @param activityId - Activity ID
     * @returns Response data
     */
    async sendKudos(activityId: string | number): Promise<string> {
        if (!this.csrfToken) throw new Error('Client not initialized. Call initialize() first.');

        const options: https.RequestOptions = {
            hostname: 'www.strava.com',
            path: `/feed/activity/${activityId}/kudo`,
            method: 'POST',
            headers: {
                'Cookie': this.cookieValue,
                'x-csrf-token': this.csrfToken,
            },
        };

        return await makeRequest(options, this.timeout);
    }
}
