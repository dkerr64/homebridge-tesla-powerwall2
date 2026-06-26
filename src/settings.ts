/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'TeslaPowerwall';

/**
 * This must match the name of your plugin as defined the package.json `name` property
 */
export const PLUGIN_NAME = 'homebridge-tesla-powerwall2';

/**
 * Default polling interval in seconds for fetching data from the Tesla Powerwall API. This can be overridden in the Homebridge config.json.
 */
export const DEFAULT_POLLING_INTERVAL = 15;

/**
 * Default HTTP cache time in milliseconds.
 */
export const HTTP_CACHE_MS = 1000;