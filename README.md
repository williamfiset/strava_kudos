# Strava Kudos 👍

The project is a Node.js application designed to interact with the Strava Website to automate the process of giving kudos to activities.

## Config 🔧

### YAML and JSON Configuration Support

Strava Kudos supports configuration via either a YAML or JSON file in the project root. The following config file names are supported (in order of precedence):

- `config.json`
- `config.yaml`
- `config.yml`

**Exclusivity Rule:**
Only one configuration file may be present at a time. If more than one of these files exists, the application will throw an error and refuse to start.
If no config file is found, the application will also throw an error.

**Migration from JSON to YAML:**
To migrate from JSON to YAML:
1. Copy your existing `config.json` contents.
2. Convert the JSON structure to YAML format (see the example in `config.yaml.example`).
3. Save the result as `config.yaml` or `config.yml` in the project root.
4. Remove or rename any existing `config.json` to avoid exclusivity errors.

**Example YAML Config:**
See [`config.yaml.example`](config.yaml.example) for a complete example.

**Usage and Error Handling:**
- If multiple config files are present, you will see an error like:
  `Multiple configuration files found (config.json, config.yaml). Please ensure only one of config.json, config.yaml, or config.yml is present.`
- If no config file is found, you will see:
  `No configuration file found. Please provide one of: config.json, config.yaml, or config.yml in the project root.`
- If the config file is invalid or missing required fields, a descriptive error will be shown.

The config file contains settings and rules that the application uses to determine how and when to give kudos to activities. Here is a summary of its contents in the context of the project:

- _strava4_session: This is the cookie value for login purposes (the cookie value can be found as **_strava4_session** in your browser)

- myAthleteID: This is the ID of the authenticated user. The application uses this ID to identify the user's activities and interactions.

- ignoreAthlete: This is a list of athlete IDs that the application should ignore when giving kudos. Activities from these athletes will not receive kudos from the application.

- kudoRules: This section defines the rules for giving kudos based on activity type, distance, and time.

    - distance: Specifies the minimum distance required for different types of activities to receive kudos. For example, a run must be at least 5 km, while a ride must be at least 20 km.
    - time: Specifies the minimum duration (in minutes) required for an activity to receive kudos.

This configuration allows the application to customize its behavior based on user preferences and specific criteria for different types of activities.

## How to use ⚙️

- edit **config.json.example** and save as **config.json**
- run **docker compose up -d --build**