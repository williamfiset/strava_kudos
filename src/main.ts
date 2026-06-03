import { loadAndValidateConfig } from './config.js';
import { StravaClient } from './stravaClient.js';
import { filterActivities } from './filters.js';
import { logger, LogLevel } from './logger.js';
import { StravaBrowser } from './browser.js'
import { parseArgs, showHelp, sleep } from './cli.js';
import { loadAthleteState, saveAthleteState, recordAction } from './athleteState.js';
import type { Activity, AthleteState } from './types.js';

await main();

async function main(): Promise<void> {
    try {
        const options = parseArgs();

        if (options.help) {
            showHelp();
            return;
        }

        if (options.verbose) logger.setLevel(LogLevel.DEBUG);

        logger.logScriptBoundary(true);

        const config = await loadAndValidateConfig();

        // Log in via the browser to obtain a fresh session cookie
        logger.info('Logging in to Strava...');
        logger.debug(`Authenticating as ${config.stravaEmail}`);
        const browser = new StravaBrowser({ headless: config.headless });
        const sessionCookie = await browser.login(config.stravaEmail, config.stravaPassword);
        logger.info('Login successful - obtained session cookie');
        logger.logSession(sessionCookie);

        // Initialize Strava client with the freshly obtained cookie
        const stravaClient = new StravaClient(sessionCookie);
        await stravaClient.initialize();
        logger.logCsrfToken(stravaClient.csrfToken!);

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
        logger.error('Application error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

/**
 * Send kudos to activities with basic rate limiting.
 * Records a 'kudoed' state entry only after a successful send so that
 * failed sends are retried (and not falsely treated as alternation anchors) on the next run.
 *
 * @param stravaClient - Strava client instance
 * @param activities - Activities to send kudos to
 * @param athleteState - State object mutated on successful sends
 */
async function sendKudos(stravaClient: StravaClient, activities: Activity[], athleteState: AthleteState): Promise<void> {
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
            logger.error(`Failed to send kudos to activity ${activity.id}:`, error instanceof Error ? error.message : String(error));
            errorCount++;
            // Continue with other activities even if one fails
        }
    }

    logger.info(`Completed: ${successCount} kudos sent, ${errorCount} errors`);
}
