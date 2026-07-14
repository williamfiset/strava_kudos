import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from './logger.js';

const IMAP_HOST = 'imap.gmail.com';
const IMAP_PORT = 993;
const STRAVA_OTP_SENDER = 'no-reply@strava.com';
const STRAVA_OTP_SUBJECT = 'Your one-time code';
const CODE_PATTERN = /\b\d{6}\b/;

export interface FetchStravaLoginCodeOptions {
    /** Gmail address to check (the same inbox Strava sends the code to). */
    email: string;
    /** Gmail App Password used to authenticate over IMAP. */
    appPassword: string;
    /** Only consider emails received at/after this time, so a stale code isn't picked up. */
    since: Date;
    /** How long to keep polling for the code email before giving up (ms). Defaults to 90000. */
    timeout?: number;
    /** Delay between polling attempts (ms). Defaults to 3000. */
    pollInterval?: number;
}

/**
 * Polls the given Gmail inbox over IMAP for the Strava "Your one-time code" email
 * and returns the 6-digit login code it contains.
 *
 * Email delivery isn't instant, so this polls rather than checking once.
 */
export async function fetchStravaLoginCode(options: FetchStravaLoginCodeOptions): Promise<string> {
    const timeout = options.timeout ?? 90_000;
    const pollInterval = options.pollInterval ?? 3_000;
    const deadline = Date.now() + timeout;

    for (;;) {
        const code = await findLoginCode(options.email, options.appPassword, options.since);
        if (code) return code;

        if (Date.now() >= deadline) {
            throw new Error(`Timed out after ${Math.round(timeout / 1000)}s waiting for the Strava login code email to arrive.`);
        }

        logger.debug('Strava login code email not found yet - retrying...');
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
}

/**
 * Looks for the most recent matching Strava OTP email at/after `since` and extracts its code.
 * Returns null if no matching email has arrived yet.
 */
async function findLoginCode(email: string, appPassword: string, since: Date): Promise<string | null> {
    const client = new ImapFlow({
        host: IMAP_HOST,
        port: IMAP_PORT,
        secure: true,
        auth: { user: email, pass: appPassword },
        logger: false,
    });

    await client.connect();
    try {
        const lock = await client.getMailboxLock('INBOX');
        try {
            const uids = await client.search({ from: STRAVA_OTP_SENDER, subject: STRAVA_OTP_SUBJECT, since }, { uid: true });
            if (!uids || uids.length === 0) return null;

            // Newest first; IMAP SEARCH SINCE only has day granularity, so double-check
            // each candidate's exact timestamp below in case older same-day emails matched too.
            const sortedUids = [...uids].sort((a, b) => b - a);

            for (const uid of sortedUids) {
                const message = await client.fetchOne(uid, { envelope: true, source: true }, { uid: true });
                if (!message || !message.source) continue;
                if (message.envelope?.date && message.envelope.date.getTime() < since.getTime()) continue;

                const parsed = await simpleParser(message.source);
                const text = parsed.text || parsed.html || '';
                const match = text.match(CODE_PATTERN);
                if (match) return match[0];
            }

            return null;
        } finally {
            lock.release();
        }
    } finally {
        await client.logout().catch(() => client.close());
    }
}
