/**
 * Winston-based logging utilities with redaction for sensitive data
 */
import winston from 'winston';

export const LogLevel = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
} as const;

export type LogLevelValue = (typeof LogLevel)[keyof typeof LogLevel];

// Create Winston logger instance
const winstonLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf((info: winston.Logform.TransformableInfo) => {
            const { timestamp, level, message, ...meta } = info;
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
    private winston: winston.Logger;

    constructor() {
        this.winston = winstonLogger;
    }

    setLevel(level: LogLevelValue): void {
        this.winston.level = level;
    }

    error(message: string, ...args: unknown[]): void {
        if (args.length > 0) {
            // Format additional arguments naturally like console.log
            const formattedMessage = this.formatMessage(message, args);
            this.winston.error(formattedMessage);
        } else {
            this.winston.error(message);
        }
    }

    warn(message: string, ...args: unknown[]): void {
        if (args.length > 0) {
            const formattedMessage = this.formatMessage(message, args);
            this.winston.warn(formattedMessage);
        } else {
            this.winston.warn(message);
        }
    }

    info(message: string, ...args: unknown[]): void {
        if (args.length > 0) {
            const formattedMessage = this.formatMessage(message, args);
            this.winston.info(formattedMessage);
        } else {
            this.winston.info(message);
        }
    }

    debug(message: string, ...args: unknown[]): void {
        if (args.length > 0) {
            const formattedMessage = this.formatMessage(message, args);
            this.winston.debug(formattedMessage);
        } else {
            this.winston.debug(message);
        }
    }

    /**
     * Format message with additional arguments like console.log
     * @param message - Main message
     * @param args - Additional arguments
     * @returns Formatted message
     */
    formatMessage(message: string, args: unknown[]): string {
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
     * @param sessionCookie - Session cookie to redact
     */
    logSession(sessionCookie: string): void {
        const redacted = sessionCookie.length > 8 ? `${sessionCookie.substring(0, 8)}...` : '***REDACTED***';
        this.debug(`Strava Session: ${redacted}`);
    }

    /**
     * Log CSRF token with partial redaction
     * @param csrfToken - CSRF token to log
     */
    logCsrfToken(csrfToken: string): void {
        const redacted = csrfToken.length > 8 ? `${csrfToken.substring(0, 8)}...` : '***REDACTED***';
        this.debug(`CSRF Token: ${redacted}`);
    }

    /**
     * Log activity processing summary
     * @param total - Total activities found
     * @param filtered - Activities that will receive kudos
     * @param dryRun - Whether this is a dry run
     */
    logSummary(total: number, filtered: number, dryRun = false): void {
        const action = dryRun ? 'Would send' : 'Sending';
        this.info(`${action} kudos to ${filtered} out of ${total} activities`);
    }

    /**
     * Log script start/end with timestamps
     * @param isStart - True for start, false for end
     */
    logScriptBoundary(isStart: boolean): void {
        const message = isStart ? 'SCRIPT START' : 'SCRIPT END';
        this.info(`***** ${message} *****`);
    }
}

// Export singleton logger instance
export const logger = new Logger();
