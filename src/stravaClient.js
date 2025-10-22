import https from 'https';
import { decode } from 'html-entities';

/**
 * Internal helper function to make HTTP requests
 * @param {Object} options - Request options
 * @param {number} timeout - Request timeout in milliseconds
 * @returns {Promise<string>} Response data
 */
function makeRequest(options, timeout) {
    return new Promise((resolve, reject) => {
        const requestOptions = {
            ...options,
            timeout: timeout,
        };

        const req = https.request(requestOptions, (res) => {
            let data = '';

            // Handle non-200 status codes
            if (res.statusCode < 200 || res.statusCode >= 300) {
                const error = new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`);
                error.statusCode = res.statusCode;
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
 * @param {string} cookieValue - Session cookie value
 * @param {number} timeout - Request timeout in milliseconds
 * @returns {Promise<string>} CSRF token
 */
async function getCsrfToken(cookieValue, timeout) {
    const options = {
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
 * @param {Object} activity - Group activity object
 * @returns {Object} Normalized activity object
 */
function transformGroupActivity(activity) {
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
    };
}

/**
 * Parse activities from dashboard HTML response
 * @param {string} htmlData - HTML response from dashboard
 * @returns {Array} Parsed activities
 */
function parseActivitiesFromDashboard(htmlData) {
    const reactPropsMatches = [...htmlData.matchAll(/data-react-props='([^']+)'/g)].map((match) => match[1]);

    let activities = [];

    reactPropsMatches.forEach((match) => {
        try {
            const reactProps = JSON.parse(decode(match));
            const entries = reactProps?.appContext?.feedProps?.preFetchedEntries || [];

            entries.forEach((entry) => {
                if (entry.entity === 'Activity') activities.push(entry.activity);
                else if (entry.entity === 'GroupActivity') activities.push(...entry.rowData.activities.map(transformGroupActivity));
            });
        } catch (parseError) {
            // Skip malformed JSON, continue processing
            console.warn('Failed to parse react props:', parseError.message);
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
    constructor(sessionCookie, options = {}) {
        this.sessionCookie = sessionCookie;
        this.timeout = options.timeout || 30000; // 30 second timeout
        this.cookieValue = `_strava4_session=${sessionCookie}`;
        this.csrfToken = null;
    }

    /**
     * Initialize the client by fetching the CSRF token
     * @returns {Promise<void>}
     */
    async initialize() {
        this.csrfToken = await getCsrfToken(this.cookieValue, this.timeout);
    }

    /**
     * Get activities from Strava dashboard
     * @param {number} myAthleteID - User's athlete ID
     * @param {number} [numEntries=60] - Number of entries to fetch
     * @returns {Promise<Array>} Array of activities
     */
    async getActivitiesViaDashboard(myAthleteID, numEntries = 60) {
        if (!this.csrfToken) throw new Error('Client not initialized. Call initialize() first.');

        const options = {
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
     * @param {string} activityId - Activity ID
     * @returns {Promise<string>} Response data
     */
    async sendKudos(activityId) {
        if (!this.csrfToken) throw new Error('Client not initialized. Call initialize() first.');

        const options = {
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
