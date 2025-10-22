import https from 'https';
import { decode } from 'html-entities';

/**
 * Strava API client for authentication and data fetching
 */
export class StravaClient {
    constructor(sessionCookie, options = {}) {
        this.sessionCookie = sessionCookie;
        this.timeout = options.timeout || 30000; // 30 second timeout
        this.cookieValue = `_strava4_session=${sessionCookie}`;
    }

    /**
     * Make an authenticated HTTP request to Strava
     * @param {Object} options - Request options
     * @returns {Promise<string>} Response data
     */
    async makeRequest(options) {
        return new Promise((resolve, reject) => {
            const requestOptions = {
                ...options,
                headers: {
                    ...options.headers,
                },
                timeout: this.timeout,
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
                reject(new Error(`Request timeout after ${this.timeout}ms`));
            });

            req.setTimeout(this.timeout);
            req.end();
        });
    }

    /**
     * Get CSRF token from Strava dashboard
     * @returns {Promise<string>} CSRF token
     */
    async getCsrfToken() {
        const options = {
            hostname: 'www.strava.com',
            path: '/dashboard',
            method: 'GET',
            headers: {
                Cookie: this.cookieValue,
            },
        };

        const data = await this.makeRequest(options);
        const csrfTokenMatch = data.match(/<meta name="csrf-token" content="([^"]+)"/);

        if (csrfTokenMatch) {
            const csrfToken = csrfTokenMatch[1];
            return csrfToken;
        } else {
            throw new Error('CSRF Token not found in response - possibly invalid session cookie');
        }
    }

    /**
     * Get activities from Strava dashboard
     * @param {string} csrfToken - CSRF token for authentication
     * @param {number} myAthleteID - User's athlete ID
     * @param {number} [numEntries=60] - Number of entries to fetch
     * @returns {Promise<Array>} Array of activities
     */
    async getActivitiesViaDashboard(csrfToken, myAthleteID, numEntries = 60) {
        const options = {
            hostname: 'www.strava.com',
            path: `/dashboard?num_entries=${numEntries}`,
            method: 'GET',
            headers: {
                'Cookie': this.cookieValue,
                'x-csrf-token': csrfToken,
            },
        };

        const data = await this.makeRequest(options);
        return this.parseActivitiesFromDashboard(data);
    }

    /**
     * Get activities via feed URL (alternative method)
     * @param {string} csrfToken - CSRF token
     * @param {number} myAthleteID - User's athlete ID
     * @param {number} [numEntries=40] - Number of entries to fetch
     * @returns {Promise<Array>} Array of activities
     */
    async getActivitiesViaFeedURL(csrfToken, myAthleteID, numEntries = 40) {
        const options = {
            hostname: 'www.strava.com',
            path: `/dashboard/feed?feed_type=following&athlete_id=${myAthleteID}&num_entries=${numEntries}`,
            method: 'GET',
            headers: {
                'Cookie': this.cookieValue,
                'x-csrf-token': csrfToken,
            },
        };

        const data = await this.makeRequest(options);
        const feed = JSON.parse(data);
        const activities = feed.entries.filter((entry) => entry.entity === 'Activity');

        return activities.map((entry) => entry.activity);
    }

    /**
     * Send kudos to an activity
     * @param {string} csrfToken - CSRF token
     * @param {string} activityId - Activity ID
     * @returns {Promise<string>} Response data
     */
    async sendKudos(csrfToken, activityId) {
        const options = {
            hostname: 'www.strava.com',
            path: `/feed/activity/${activityId}/kudo`,
            method: 'POST',
            headers: {
                'Cookie': this.cookieValue,
                'x-csrf-token': csrfToken,
            },
        };

        return await this.makeRequest(options);
    }

    /**
     * Parse activities from dashboard HTML response
     * @param {string} htmlData - HTML response from dashboard
     * @returns {Array} Parsed activities
     */
    parseActivitiesFromDashboard(htmlData) {
        const reactPropsMatches = [...htmlData.matchAll(/data-react-props='([^']+)'/g)].map((match) => match[1]);

        let activities = [];

        reactPropsMatches.forEach((match) => {
            try {
                const reactProps = JSON.parse(decode(match));
                const entries = reactProps?.appContext?.feedProps?.preFetchedEntries || [];

                entries.forEach((entry) => {
                    if (entry.entity === 'Activity') {
                        activities.push(entry.activity);
                    } else if (entry.entity === 'GroupActivity') {
                        activities.push(...entry.rowData.activities.map(this.transformGroupActivity));
                    }
                });
            } catch (parseError) {
                // Skip malformed JSON, continue processing
                console.warn('Failed to parse react props:', parseError.message);
            }
        });

        if (activities.length === 0) {
            throw new Error('No activities found - check session cookie validity');
        }

        // Remove newlines from activity names
        activities = activities.map((activity) => ({
            ...activity,
            activityName: activity.activityName?.replace(/\n/g, ' ') || activity.activityName,
        }));

        return activities;
    }

    /**
     * Transform group activity to standard activity format
     * @param {Object} activity - Group activity object
     * @returns {Object} Normalized activity object
     */
    transformGroupActivity(activity) {
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
}
