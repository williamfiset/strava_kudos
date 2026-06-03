import { firefox } from 'playwright';
import type { Page } from 'playwright';
import { logger } from './logger.js';

const LOGIN_URL = 'https://www.strava.com/login';
const SESSION_COOKIE_NAME = '_strava4_session';

export interface StravaBrowserOptions {
    /** Run the browser without a visible window. Defaults to `true`. */
    headless?: boolean;
    /** Default timeout (ms) for navigation and element actions. Defaults to 60000. */
    timeout?: number;
    /** User-Agent override. If omitted, Firefox's own native User-Agent is used. */
    userAgent?: string;
}

/**
 * Logs in to Strava with an email and password using a real Firefox browser
 * driven by Playwright, then returns the `_strava4_session` cookie value.
 *
 * Strava's login page (https://www.strava.com/login) is a JavaScript-rendered
 * Next.js app guarded by reCAPTCHA, so a raw HTTP form POST no longer works.
 * Playwright runs the actual page JS, which is the realistic way to obtain a
 * session cookie programmatically.
 *
 * The returned value is the same cookie the rest of the app expects:
 *   const browser = new StravaBrowser();
 *   const sessionCookie = await browser.login(email, password);
 *   const client = new StravaClient(sessionCookie);
 *
 * Note: if Strava serves an interactive reCAPTCHA challenge, an automated
 * headless run may be blocked. Constructing with `{ headless: false }` lets you
 * solve the challenge manually in the visible window before login completes.
 */
export class StravaBrowser {
    private headless: boolean;
    private timeout: number;
    private userAgent: string | undefined;

    constructor(options: StravaBrowserOptions = {}) {
        this.headless = options.headless ?? true;
        this.timeout = options.timeout ?? 60000;
        // Leave undefined by default so the real Firefox User-Agent is used;
        // spoofing a mismatched UA on Firefox would only aid bot detection.
        this.userAgent = options.userAgent;
    }

    /**
     * Drive the login flow and return the authenticated session cookie value.
     *
     * @param email - Strava account email
     * @param password - Strava account password
     * @returns The `_strava4_session` cookie value
     * @throws If credentials are missing or login does not complete successfully.
     */
    async login(email: string, password: string): Promise<string> {
        if (!email || !password) throw new Error('Both email and password are required to log in.');

        logger.debug(`Launching Firefox (headless=${this.headless})`);
        const browser = await firefox.launch({
            headless: this.headless,
            slowMo: 750, // milliseconds
         });

        try {
            const context = await browser.newContext(this.userAgent ? { userAgent: this.userAgent } : {});
            const page = await context.newPage();
            page.setDefaultTimeout(this.timeout);

            logger.debug(`Navigating to ${LOGIN_URL}`);
            await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

            logger.debug('Filling email field');
            await page.locator('input[name="email"]:visible').fill(email);

            logger.debug('Submitting email');
            await page.locator('[data-cy="login-button"]:visible').click();

            logger.debug('Choosing "use password instead"');
            await page.getByRole('button', { name: /use password instead/i })
                    .filter({ visible: true })
                    .click();

            logger.debug('Filling password field');
            await page.locator('input[data-cy="password"]:visible').fill(password);

            logger.debug('Submitting password');
            await page.getByRole('button', { name: 'Log in', exact: true })
                .filter({ visible: true })
                .click();

            // ##### 3 ##### Wait for login to complete (navigation away from /login).
            try {
                await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: this.timeout });
            } catch {
                const errorText = await this.readLoginError(page);
                throw new Error(`Login did not complete${errorText ? ` - ${errorText}` : ' - still on the login page (bad credentials or a reCAPTCHA challenge).'}`);
            }
            logger.debug(`Login navigation settled at ${page.url()}`);

            // ##### 4 ##### Read the session cookie from the browser context.
            const cookies = await context.cookies('https://www.strava.com');
            logger.debug(`Cookies after login: [${cookies.map((c) => c.name).join(', ') || 'none'}]`);
            const session = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
            if (!session || !session.value) throw new Error(`Login appeared to succeed but no ${SESSION_COOKIE_NAME} cookie was found.`);

            logger.debug(`Successfully obtained ${SESSION_COOKIE_NAME} cookie`);
            return session.value;
        } finally {
            await browser.close();
            logger.debug('Closed Firefox');
        }
    }

    /**
     * Try to read a visible inline error message from the login form, for a
     * clearer failure reason. Returns null if none is found.
     */
    private async readLoginError(page: Page): Promise<string | null> {
        const errorSelectors = ['[role="alert"]', '.alert-message', '[class*="error" i]'];
        for (const selector of errorSelectors) {
            try {
                const el = page.locator(selector).first();
                if (await el.isVisible({ timeout: 1000 })) {
                    const text = (await el.innerText()).trim();
                    if (text) return text;
                }
            } catch {
                // No matching/visible element - try the next selector.
            }
        }
        return null;
    }
}
