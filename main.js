import { loadAndValidateConfig, logConfigError } from './src/config.js';
import { StravaClient } from './src/stravaClient.js';
import { filterActivities } from './src/filters.js';
import { logger, LogLevel } from './src/logger.js';
import { parseArgs, showHelp, sleep } from './src/cli.js';

await main();

async function main() {
    try {
        // Parse command line arguments
        const options = parseArgs();

        if (options.help) {
            showHelp();
            return;
        }

        // Set log level based on verbose flag
        if (options.verbose) {
            logger.setLevel(LogLevel.DEBUG);
        }

        logger.logScriptBoundary(true);

        // Load and validate configuration
        const config = await loadAndValidateConfig();

        // Initialize Strava client
        const stravaClient = new StravaClient(config.stravaSessionCookie);
        logger.logSession(config.stravaSessionCookie);

        // Get CSRF token
        const csrfToken = await stravaClient.getCsrfToken();
        logger.logCsrfToken(csrfToken);

        // Fetch activities
        const activities = await stravaClient.getActivitiesViaDashboard(csrfToken, config.athleteId);
        logger.info(`Found ${activities.length} activities`);

        // Filter activities based on rules
        const filteredActivities = filterActivities(activities, config, {
            dryRun: options.dryRun,
            verbose: options.verbose,
        });

        logger.logSummary(activities.length, filteredActivities.length, options.dryRun);

        // Send kudos (or simulate in dry run)
        if (options.dryRun) {
            logger.info('Dry run mode - no kudos will be sent');
            filteredActivities.forEach((activity) => {
                logger.info(`Would send kudos to: ${activity.athlete.athleteName} - ${activity.activityName}`);
            });
        } else {
            await sendKudos(stravaClient, csrfToken, filteredActivities);
        }

        logger.logScriptBoundary(false);
    } catch (error) {
        logger.error('Application error:', error.message);
        if (error.message.includes('config') || error.message.includes('Config')) {
            logConfigError(error);
        }
        process.exit(1);
    }
}

/**
 * Send kudos to activities with basic rate limiting
 * @param {StravaClient} stravaClient - Strava client instance
 * @param {string} csrfToken - CSRF token
 * @param {Array} activities - Activities to send kudos to
 */
async function sendKudos(stravaClient, csrfToken, activities) {
    let successCount = 0;
    let errorCount = 0;
    const defaultDelayMs = 1000; // Default 1 second delay

    for (const [index, activity] of activities.entries()) {
        try {
            logger.info(`Sending kudos to activity ${index + 1}/${activities.length}: ${activity.athlete.athleteName} - ${activity.activityName}`);

            const response = await stravaClient.sendKudos(csrfToken, activity.id);
            logger.debug('Kudos response:', response);
            successCount++;

            // Rate limiting delay (except for last request)
            if (index < activities.length - 1) {
                logger.debug(`Waiting ${defaultDelayMs}ms before next request...`);
                await sleep(defaultDelayMs);
            }
        } catch (error) {
            logger.error(`Failed to send kudos to activity ${activity.id}:`, error.message);
            errorCount++;

            // Continue with other activities even if one fails
        }
    }

    logger.info(`Completed: ${successCount} kudos sent, ${errorCount} errors`);
}
