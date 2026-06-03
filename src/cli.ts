/**
 * Command-line interface utilities
 */
import type { CliOptions } from './types.js';

/**
 * Parse command line arguments
 * @param args - Command line arguments (process.argv)
 * @returns Parsed options
 */
export function parseArgs(args: string[] = process.argv): CliOptions {
    const options: CliOptions = {
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
export function showHelp(): void {
    console.log(`
Strava Kudos Automation Tool

Usage: node dist/main.js [options]

Options:
  -d, --dry-run      Show what would be done without actually sending kudos
  -v, --verbose      Enable verbose logging with detailed activity information
  -h, --help         Show this help message

Examples:
  node dist/main.js --dry-run --verbose    # Preview what would happen
  node dist/main.js                        # Send kudos to all qualifying activities

Configuration:
  Place your configuration in config.json, config.yaml, or config.yml
  See config.json.example or config.yaml.example for reference
`);
}

/**
 * Sleep for specified duration
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
