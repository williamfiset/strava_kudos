/**
 * Winston-based logging utilities with redaction for sensitive data
 */
import winston from 'winston';

export const LogLevel = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
};

// Create Winston logger instance
const winstonLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
            return `${timestamp} [${level}] ${message} ${metaStr}`.trim();
        })
    ),
    transports: [
        new winston.transports.Console({
            handleExceptions: true,
            handleRejections: true,
        }),
    ],
    exitOnError: false,
});

class Logger {
    constructor() {
        this.winston = winstonLogger;
    }

    setLevel(level) {
        this.winston.level = level;
    }

    error(message, ...args) {
        if (args.length > 0) {
            // Format additional arguments naturally like console.log
            const formattedMessage = this.formatMessage(message, args);
            this.winston.error(formattedMessage);
        } else {
            this.winston.error(message);
        }
    }

    warn(message, ...args) {
        if (args.length > 0) {
            const formattedMessage = this.formatMessage(message, args);
            this.winston.warn(formattedMessage);
        } else {
            this.winston.warn(message);
        }
    }

    info(message, ...args) {
        if (args.length > 0) {
            const formattedMessage = this.formatMessage(message, args);
            this.winston.info(formattedMessage);
        } else {
            this.winston.info(message);
        }
    }

    debug(message, ...args) {
        if (args.length > 0) {
            const formattedMessage = this.formatMessage(message, args);
            this.winston.debug(formattedMessage);
        } else {
            this.winston.debug(message);
        }
    }

    /**
     * Format message with additional arguments like console.log
     * @param {string} message - Main message
     * @param {Array} args - Additional arguments
     * @returns {string} Formatted message
     */
    formatMessage(message, args) {
        const formattedArgs = args
            .map((arg) => {
                if (typeof arg === 'object' && arg !== null) {
                    return JSON.stringify(arg);
                }
                return String(arg);
            })
            .join(' ');

        return `${message} ${formattedArgs}`;
    }

    /**
     * Log session information with redacted sensitive data
     * @param {string} sessionCookie - Session cookie to redact
     */
    logSession(sessionCookie) {
        const redacted = this.redactCookie(sessionCookie);
        this.info(`Strava Session: ${redacted}`);
    }

    /**
     * Log CSRF token with partial redaction
     * @param {string} csrfToken - CSRF token to log
     */
    logCsrfToken(csrfToken) {
        const redacted = csrfToken.length > 8 ? `${csrfToken.substring(0, 8)}...` : '***REDACTED***';
        this.debug(`CSRF Token: ${redacted}`);
    }

    /**
     * Redact sensitive cookie information
     * @param {string} cookie - Cookie value to redact
     * @returns {string} Redacted cookie
     */
    redactCookie(cookie) {
        if (!cookie || cookie.length <= 12) {
            return '***REDACTED***';
        }
        return `${cookie.substring(0, 8)}...${cookie.substring(cookie.length - 4)}`;
    }

    /**
     * Log activity processing summary
     * @param {number} total - Total activities found
     * @param {number} filtered - Activities that will receive kudos
     * @param {boolean} dryRun - Whether this is a dry run
     */
    logSummary(total, filtered, dryRun = false) {
        const action = dryRun ? 'Would send' : 'Sending';
        this.info(`${action} kudos to ${filtered} out of ${total} activities`);
    }

    /**
     * Log script start/end with timestamps
     * @param {boolean} isStart - True for start, false for end
     */
    logScriptBoundary(isStart) {
        const message = isStart ? 'SCRIPT START' : 'SCRIPT END';
        this.info(`***** ${message} *****`);
    }
}

// Export singleton logger instance
export const logger = new Logger();
