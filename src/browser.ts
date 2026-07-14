import { firefox } from 'playwright';
import type { Page } from 'playwright';
import { logger } from './logger.js';
import { fetchStravaLoginCode } from './emailOtp.js';

const LOGIN_URL = 'https://www.strava.com/login';
const SESSION_COOKIE_NAME = '_strava4_session';
// Clock drift buffer: how far back to backdate the "since" cutoff when
// searching for the OTP email, so a slightly-ahead local clock doesn't
// filter out the email Strava just sent.
const EMAIL_CLOCK_DRIFT_BUFFER_MS = 60_000;

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
 *   const sessionCookie = await browser.login(email, password, emailAppPassword);
 *   const client = new StravaClient(sessionCookie);
 *
 * Note: if Strava serves an interactive reCAPTCHA challenge, an automated
 * headless run may be blocked. Constructing with `{ headless: false }` lets you
 * solve the challenge manually in the visible window before login completes.
 *
 * Strava also sometimes challenges the login with a 6-digit one-time code
 * emailed to the account address, instead of (or in addition to) a password
 * prompt. When that screen appears, `emailAppPassword` (a Gmail App Password)
 * is used to read the code from the inbox over IMAP and submit it automatically.
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
     * @param emailAppPassword - Gmail App Password for the account at `email`, used to read
     *   an emailed one-time code if Strava challenges the login with one. Required only when
     *   that challenge actually appears.
     * @returns The `_strava4_session` cookie value
     * @throws If credentials are missing or login does not complete successfully.
     */
    async login(email: string, password: string, emailAppPassword?: string): Promise<string> {
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
            const emailSubmittedAt = new Date();
            await page.locator('[data-cy="login-button"]:visible').click();

            // Strava responds to the email submission with either a "use password
            // instead" prompt (classic flow) or, increasingly, straight to an emailed
            // one-time code screen - no password step at all.
            const postEmailState = await this.waitForPostEmailState(page);

            if (postEmailState === 'otp') {
                await this.submitEmailCode(page, email, emailAppPassword, emailSubmittedAt);
            } else {
                logger.debug('Choosing "use password instead"');
                await page.getByRole('button', { name: /use password instead/i })
                        .filter({ visible: true })
                        .click();

                logger.debug('Filling password field');
                await page.locator('input[data-cy="password"]:visible').fill(password);

                logger.debug('Submitting password');
                const passwordSubmittedAt = new Date();
                await page.getByRole('button', { name: 'Log in', exact: true })
                    .filter({ visible: true })
                    .click();

                // Strava may still follow the password with an emailed code (2FA).
                const otpAppeared = await page.locator('input[type="number"]:visible').first()
                    .isVisible({ timeout: 5000 })
                    .catch(() => false);
                if (otpAppeared) {
                    await this.submitEmailCode(page, email, emailAppPassword, passwordSubmittedAt);
                }
            }

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
     * After submitting the email, Strava shows either a 6-digit code input
     * (`otp`) or a "use password instead" button (`password-prompt`). Waits for
     * whichever appears first.
     */
    private async waitForPostEmailState(page: Page): Promise<'otp' | 'password-prompt'> {
        const otpPromise = page.locator('input[type="number"]:visible').first()
            .waitFor({ state: 'visible', timeout: this.timeout })
            .then(() => 'otp' as const);
        const passwordPromptPromise = page.getByRole('button', { name: /use password instead/i })
            .filter({ visible: true })
            .waitFor({ state: 'visible', timeout: this.timeout })
            .then(() => 'password-prompt' as const);

        // Avoid unhandled rejection warnings from whichever promise loses the race.
        otpPromise.catch(() => {});
        passwordPromptPromise.catch(() => {});

        try {
            return await Promise.race([otpPromise, passwordPromptPromise]);
        } catch {
            throw new Error('Neither an emailed code prompt nor a "use password instead" prompt appeared after submitting the email.');
        }
    }

    /**
     * Reads the one-time code Strava emailed to `email` and submits it on the
     * currently-displayed code screen.
     *
     * @param since - Only emails received at/after this time are considered, so a
     *   stale code from an earlier login attempt isn't picked up.
     */
    private async submitEmailCode(page: Page, email: string, emailAppPassword: string | undefined, since: Date): Promise<void> {
        if (!emailAppPassword) {
            throw new Error('Strava is asking for an emailed one-time code, but no Gmail App Password is configured (GMAIL_APP_PASSWORD in .env) to read it automatically.');
        }

        logger.debug('Strava requested an emailed one-time code - fetching it from email');
        const code = await fetchStravaLoginCode({
            email,
            appPassword: emailAppPassword,
            since: new Date(since.getTime() - EMAIL_CLOCK_DRIFT_BUFFER_MS),
        });
        logger.debug('Retrieved one-time code from email');

        await page.locator('input[type="number"]:visible').first().fill(code);
        await page.getByRole('button', { name: 'Next', exact: true }).filter({ visible: true }).click();
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
