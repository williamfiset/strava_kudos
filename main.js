import { loadAndValidateConfig } from './src/config.js';
import { StravaClient } from './src/stravaClient.js';
import { filterActivities } from './src/filters.js';
import { logger, LogLevel } from './src/logger.js';
import { parseArgs, showHelp, sleep } from './src/cli.js';
import { loadAthleteState, saveAthleteState, recordAction } from './src/athleteState.js';

await main();

async function main() {
    try {
        const options = parseArgs();

        if (options.help) {
            showHelp();
            return;
        }

        if (options.verbose) logger.setLevel(LogLevel.DEBUG);

        logger.logScriptBoundary(true);

        const config = await loadAndValidateConfig();

        // Initialize Strava client
        const stravaClient = new StravaClient(config.stravaSessionCookie);
        await stravaClient.initialize();
        logger.logSession(config.stravaSessionCookie);
        logger.logCsrfToken(stravaClient.csrfToken);

        // Fetch activities
        const activities = await stravaClient.getActivitiesViaDashboard(config.athleteId);
        logger.info(`Found ${activities.length} activities`);

        // Load per-athlete alternation state
        const athleteState = await loadAthleteState();

        // Filter activities based on rules + alternation
        const { toKudo, alternationSkipped } = filterActivities(activities, config, athleteState, {
            dryRun: options.dryRun,
            verbose: options.verbose,
        });
        logger.logSummary(activities.length, toKudo.length, options.dryRun);

        if (alternationSkipped.length > 0) {
            logger.info(`Alternation: skipping ${alternationSkipped.length} activity/activities (every-other rule)`);
            alternationSkipped.forEach((activity) => {
                logger.info(`Skipping (alternation): ${activity.athlete.athleteName} - ${activity.activityName}`);
                if (!options.dryRun) recordAction(athleteState, activity.athlete, activity.id, 'skipped');
            });
        }

        // Send kudos (or simulate in dry run)
        if (options.dryRun) {
            logger.info('Dry run mode - no kudos will be sent');
            toKudo.forEach((activity) => {
                logger.info(`Would send kudos to: ${activity.athlete.athleteName} - ${activity.activityName}`);
            });
        } else {
            await sendKudos(stravaClient, toKudo, athleteState);
            await saveAthleteState(athleteState);
        }

        logger.logScriptBoundary(false);
    } catch (error) {
        logger.error('Application error:', error.message);
        process.exit(1);
    }
}

/**
 * Send kudos to activities with basic rate limiting.
 * Records a 'kudoed' state entry only after a successful send so that
 * failed sends are retried (and not falsely treated as alternation anchors) on the next run.
 *
 * @param {StravaClient} stravaClient - Strava client instance
 * @param {Array} activities - Activities to send kudos to
 * @param {Object} athleteState - State object mutated on successful sends
 */
async function sendKudos(stravaClient, activities, athleteState) {
    let successCount = 0;
    let errorCount = 0;
    const defaultDelayMs = 1000; // Default 1 second delay

    for (const [index, activity] of activities.entries()) {
        try {
            logger.info(`Sending kudos to activity ${index + 1}/${activities.length}: ${activity.athlete.athleteName} - ${activity.activityName}`);

            const response = await stravaClient.sendKudos(activity.id);
            logger.debug('Kudos response:', response);
            recordAction(athleteState, activity.athlete, activity.id, 'kudoed');
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
