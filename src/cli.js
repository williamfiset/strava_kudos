/**
 * Command-line interface utilities
 */

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments (process.argv)
 * @returns {Object} Parsed options
 */
export function parseArgs(args = process.argv) {
    const options = {
        dryRun: false,
        verbose: false,
        help: false,
    };

    for (let i = 2; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
            case '--dry-run':
            case '-d':
                options.dryRun = true;
                break;
            case '--verbose':
            case '-v':
                options.verbose = true;
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
            default:
                if (arg.startsWith('-')) {
                    throw new Error(`Unknown option: ${arg}`);
                }
                break;
        }
    }

    return options;
}

/**
 * Display help information
 */
export function showHelp() {
    console.log(`
Strava Kudos Automation Tool

Usage: node main.js [options]

Options:
  -d, --dry-run      Show what would be done without actually sending kudos
  -v, --verbose      Enable verbose logging with detailed activity information
  -h, --help         Show this help message

Examples:
  node main.js --dry-run --verbose    # Preview what would happen
  node main.js                        # Send kudos to all qualifying activities

Configuration:
  Place your configuration in config.json, config.yaml, or config.yml
  See config.json.example or config.yaml.example for reference
`);
}

/**
 * Sleep for specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
