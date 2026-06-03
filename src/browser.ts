import https from 'https';
import type { IncomingHttpHeaders } from 'http';
import { URL } from 'url';
import { logger } from './logger.js';

const LOGIN_URL = 'https://www.strava.com/login';
const SESSION_URL = 'https://www.strava.com/session';

interface RequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
}

interface RequestResult {
    statusCode: number;
    headers: IncomingHttpHeaders;
    body: string;
}

interface StravaBrowserOptions {
    timeout?: number;
    userAgent?: string;
}

/**
 * Internal helper to make an HTTP(S) request.
 *
 * Unlike the helper in stravaClient.ts this one does NOT throw on non-2xx
 * responses and does NOT auto-follow redirects, because the login flow relies
 * on inspecting 302 responses and their Set-Cookie headers explicitly.
 *
 * @param url - Absolute URL to request
 * @param options - Request options
 */
function makeRequest(url: string, { method = 'GET', headers = {}, body, timeout = 30000 }: RequestOptions = {}): Promise<RequestResult> {
    return new Promise((resolve, reject) => {
        const { hostname, pathname, search } = new URL(url);

        const requestOptions: https.RequestOptions = {
            hostname,
            path: `${pathname}${search}`,
            method,
            headers: { ...headers },
            timeout,
        };

        if (body) (requestOptions.headers as Record<string, string | number>)['Content-Length'] = Buffer.byteLength(body);

        const req = https.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: data });
            });
        });

        req.on('error', (e) => reject(new Error(`Request failed: ${e.message}`)));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Request timeout after ${timeout}ms`));
        });

        req.setTimeout(timeout);
        if (body) req.write(body);
        req.end();
    });
}

/**
 * A minimal cookie jar that accumulates cookies from Set-Cookie response
 * headers and serializes them back into a Cookie request header. Only the
 * name=value pair of each cookie is retained (attributes such as Path, Expires
 * and HttpOnly are ignored), which is sufficient for Strava's login flow.
 */
class CookieJar {
    private cookies = new Map<string, string>();

    /**
     * Merge the Set-Cookie headers from a response into the jar.
     * @param setCookieHeaders - Raw Set-Cookie header(s)
     */
    update(setCookieHeaders: string[] | string | undefined): void {
        if (!setCookieHeaders) return;
        const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
        for (const header of headers) {
            const [pair] = header.split(';'); // "name=value" is always the first segment
            const eq = pair.indexOf('=');
            if (eq === -1) continue;
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            if (name) this.cookies.set(name, value);
        }
    }

    /**
     * Serialize the jar into a Cookie request header value.
     * @returns e.g. "_strava4_session=abc; strava_remember_id=123"
     */
    header(): string {
        return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    }

    /**
     * Look up a single cookie value by name.
     */
    get(name: string): string | undefined {
        return this.cookies.get(name);
    }

    /**
     * List the names of the cookies currently held (values are intentionally
     * omitted so they can be logged without leaking sensitive data).
     */
    names(): string[] {
        return [...this.cookies.keys()];
    }
}

/**
 * Automates logging in to Strava with an email and password to obtain a
 * `_strava4_session` cookie, mirroring solitone/stravacookies' browser.py but
 * implemented against Node's built-in https module (no external browser or
 * mechanize dependency).
 *
 * The flow is:
 *   1. GET /login                -> sets an initial session cookie and exposes
 *                                   a hidden `authenticity_token` (CSRF) field.
 *   2. POST /session             -> authenticates and, on success, sets the
 *                                   `_strava4_session`, `strava_remember_id`
 *                                   and `strava_remember_token` cookies.
 *
 * Example:
 *   const browser = new StravaBrowser();
 *   const sessionCookie = await browser.login(email, password);
 *   const client = new StravaClient(sessionCookie);
 */
export class StravaBrowser {
    private timeout: number;
    private cookieJar: CookieJar;
    private userAgent: string;

    constructor(options: StravaBrowserOptions = {}) {
        this.timeout = options.timeout || 30000;
        this.cookieJar = new CookieJar();
        // A realistic User-Agent reduces the chance of being served a bot page.
        this.userAgent =
            options.userAgent ||
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }

    /**
     * Log in to Strava and return the authenticated session cookie value.
     *
     * @param email - Strava account email
     * @param password - Strava account password
     * @returns The `_strava4_session` cookie value
     * @throws If credentials are missing, the CSRF token cannot be found, or
     *   authentication fails.
     */
    async login(email: string, password: string): Promise<string> {
        if (!email || !password) throw new Error('Both email and password are required to log in.');

        // ##### 1 ##### GET the login page to obtain the CSRF token and initial cookies.
        logger.debug(`GET ${LOGIN_URL}`);
        const loginPage = await makeRequest(LOGIN_URL, {
            headers: { 'User-Agent': this.userAgent },
            timeout: this.timeout,
        });
        logger.debug(`Login page responded with status ${loginPage.statusCode} (${loginPage.body.length} bytes)`);
        this.cookieJar.update(loginPage.headers['set-cookie']);
        logger.debug(`Cookies after GET /login: [${this.cookieJar.names().join(', ') || 'none'}]`);
        
        const authenticityToken = this.extractAuthenticityToken(loginPage.body);
        if (!authenticityToken) throw new Error('Could not find authenticity_token on the login page - Strava may have changed its login form.');
        logger.debug(`Extracted authenticity_token (length ${authenticityToken.length})`);

        // ##### 2 ##### POST credentials to /session. On success Strava responds
        // with a 302 redirect to the dashboard and refreshes the session cookies.
        const form = new URLSearchParams({
            utf8: '✓',
            authenticity_token: authenticityToken,
            email,
            password,
            remember_me: 'on',
        }).toString();

        logger.debug(`POST ${SESSION_URL} (email=${email}, remember_me=on)`);
        const sessionRes = await makeRequest(SESSION_URL, {
            method: 'POST',
            headers: {
                'User-Agent': this.userAgent,
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: this.cookieJar.header(),
            },
            body: form,
            timeout: this.timeout,
        });
        logger.debug(`/session responded with status ${sessionRes.statusCode}${sessionRes.headers.location ? ` -> ${sessionRes.headers.location}` : ''}`);
        this.cookieJar.update(sessionRes.headers['set-cookie']);
        logger.debug(`Cookies after POST /session: [${this.cookieJar.names().join(', ') || 'none'}]`);

        // A successful login redirects (302/303) to the dashboard. A 200 means
        // Strava re-rendered the login form, i.e. the credentials were rejected.
        if (sessionRes.statusCode === 200) {
            throw new Error('Login failed - Strava rejected the credentials (check email/password).');
        }
        if (sessionRes.statusCode !== 302 && sessionRes.statusCode !== 303) {
            throw new Error(`Login failed - unexpected status ${sessionRes.statusCode} from ${SESSION_URL}.`);
        }

        const sessionCookie = this.cookieJar.get('_strava4_session');
        if (!sessionCookie) throw new Error('Login appeared to succeed but no _strava4_session cookie was returned.');

        logger.debug('Successfully obtained _strava4_session cookie');
        return sessionCookie;
    }

    /**
     * Extract the hidden `authenticity_token` value from the login form HTML.
     * @param html - The login page HTML
     * @returns The token, or null if not found
     */
    private extractAuthenticityToken(html: string): string | null {
        // Prefer the hidden form input; fall back to the <meta> csrf-token tag.
        const inputMatch = html.match(/name="authenticity_token"\s+value="([^"]+)"/) || html.match(/value="([^"]+)"\s+name="authenticity_token"/);
        if (inputMatch) return inputMatch[1];

        const metaMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
        return metaMatch ? metaMatch[1] : null;
    }
}
