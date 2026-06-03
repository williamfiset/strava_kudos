import https from 'https';
import type { IncomingMessage } from 'http';
import { decode } from 'html-entities';
import type { Activity } from './types.js';

interface StravaClientOptions {
    timeout?: number;
}

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
        path: '/dashboard',
        method: 'GET',
        headers: {
            Cookie: cookieValue,
        },
    };

    const data = await makeRequest(options, timeout);
    const csrfTokenMatch = data.match(/<meta name="csrf-token" content="([^"]+)"/);

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

/**
 * Parse activities from dashboard HTML response
 * @param htmlData - HTML response from dashboard
 * @returns Parsed activities
 */
function parseActivitiesFromDashboard(htmlData: string): Activity[] {
    const reactPropsMatches = [...htmlData.matchAll(/data-react-props='([^']+)'/g)].map((match) => match[1]);

    let activities: Activity[] = [];

    reactPropsMatches.forEach((match) => {
        try {
            const reactProps = JSON.parse(decode(match));
            const entries = reactProps?.appContext?.feedProps?.preFetchedEntries || [];

            entries.forEach((entry: any) => {
                if (entry.entity === 'Activity') activities.push(entry.activity);
                else if (entry.entity === 'GroupActivity') activities.push(...entry.rowData.activities.map(transformGroupActivity));
            });
        } catch (parseError) {
            // Skip malformed JSON, continue processing
            console.warn('Failed to parse react props:', parseError instanceof Error ? parseError.message : String(parseError));
        }
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
     * Get activities from Strava dashboard
     * @param myAthleteID - User's athlete ID
     * @param numEntries - Number of entries to fetch
     * @returns Array of activities
     */
    async getActivitiesViaDashboard(myAthleteID: number, numEntries = 60): Promise<Activity[]> {
        if (!this.csrfToken) throw new Error('Client not initialized. Call initialize() first.');

        const options: https.RequestOptions = {
            hostname: 'www.strava.com',
            path: `/dashboard?num_entries=${numEntries}`,
            method: 'GET',
            headers: {
                'Cookie': this.cookieValue,
                'x-csrf-token': this.csrfToken,
            },
        };

        const data = await makeRequest(options, this.timeout);
        return parseActivitiesFromDashboard(data);
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
