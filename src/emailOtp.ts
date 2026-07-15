import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from './logger.js';

const IMAP_HOST = 'imap.gmail.com';
const IMAP_PORT = 993;
const STRAVA_OTP_SENDER = 'no-reply@strava.com';
const STRAVA_OTP_SUBJECT = 'Your one-time code';
const CODE_PATTERN = /\b\d{6}\b/;
// Bounds the IMAP SEARCH result set for efficiency only; the actual
// correctness guarantee against picking up a stale/already-used code comes
// from the `afterUid` check in findLoginCode, not from this window.
const SEARCH_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface FetchStravaLoginCodeOptions {
    /** Gmail address to check (the same inbox Strava sends the code to). */
    email: string;
    /** Gmail App Password used to authenticate over IMAP. */
    appPassword: string;
    /**
     * Only messages with a UID at or after this are considered, so an older
     * (possibly already-used) code from a previous nearby login attempt is
     * never picked up. Obtain this via `getMailboxUidNext()` immediately
     * before triggering Strava to send the code.
     */
    afterUid: number;
    /** How long to keep polling for the code email before giving up (ms). Defaults to 90000. */
    timeout?: number;
    /** Delay between polling attempts (ms). Defaults to 3000. */
    pollInterval?: number;
}

/**
 * Returns the mailbox's current `uidNext` - the UID that will be assigned to
 * the next message delivered to it. IMAP UIDs are strictly ascending per
 * mailbox, so any message that arrives after this call is guaranteed to get
 * a UID at or above this value, regardless of clock drift between machines.
 *
 * Call this right before triggering Strava to send a login code, then pass
 * the result as `afterUid` to `fetchStravaLoginCode`.
 */
export async function getMailboxUidNext(email: string, appPassword: string): Promise<number> {
    const client = createClient(email, appPassword);
    await client.connect();
    try {
        const lock = await client.getMailboxLock('INBOX');
        try {
            return client.mailbox ? client.mailbox.uidNext : 0;
        } finally {
            lock.release();
        }
    } finally {
        await client.logout().catch(() => client.close());
    }
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
        const code = await findLoginCode(options.email, options.appPassword, options.afterUid);
        if (code) return code;

        if (Date.now() >= deadline) {
            throw new Error(`Timed out after ${Math.round(timeout / 1000)}s waiting for the Strava login code email to arrive.`);
        }

        logger.debug('Strava login code email not found yet - retrying...');
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
}

/**
 * Looks for the most recent matching Strava OTP email with a UID at or after
 * `afterUid` and extracts its code, marking that email as read in the process.
 * Returns null if no matching email has arrived yet.
 */
async function findLoginCode(email: string, appPassword: string, afterUid: number): Promise<string | null> {
    const client = createClient(email, appPassword);

    await client.connect();
    try {
        const lock = await client.getMailboxLock('INBOX');
        try {
            const since = new Date(Date.now() - SEARCH_LOOKBACK_MS);
            const uids = await client.search({ from: STRAVA_OTP_SENDER, subject: STRAVA_OTP_SUBJECT, since }, { uid: true });
            if (!uids || uids.length === 0) return null;

            // Only messages that arrived at/after our baseline UID can possibly
            // be the code for *this* attempt; newest of those first.
            const candidateUids = uids.filter((uid) => uid >= afterUid).sort((a, b) => b - a);

            for (const uid of candidateUids) {
                const message = await client.fetchOne(uid, { source: true }, { uid: true });
                if (!message || !message.source) continue;

                const parsed = await simpleParser(message.source);
                const text = parsed.text || parsed.html || '';
                const match = text.match(CODE_PATTERN);
                if (match) {
                    // IMAP's "\Seen" flag is what read/unread status actually is - setting
                    // it here marks this OTP email as read, so it doesn't sit in the inbox
                    // looking unread once its code has been used.
                    await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch((error) => {
                        logger.debug(`Could not mark the OTP email as read: ${error instanceof Error ? error.message : String(error)}`);
                    });
                    return match[0];
                }
            }

            return null;
        } finally {
            lock.release();
        }
    } finally {
        await client.logout().catch(() => client.close());
    }
}

function createClient(email: string, appPassword: string): ImapFlow {
    return new ImapFlow({
        host: IMAP_HOST,
        port: IMAP_PORT,
        secure: true,
        auth: { user: email, pass: appPassword },
        logger: false,
    });
}
