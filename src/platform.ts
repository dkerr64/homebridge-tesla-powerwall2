import type {
  API,
  Characteristic,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { HttpClient } from './lib/http-client';
import type { TeslaPowerwallPlatformInterface } from './types';

/**
 * Tesla Powerwall Platform
 * This class is the main constructor for the plugin, this is where we should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class TeslaPowerwallPlatform implements TeslaPowerwallPlatformInterface {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  public readonly httpClient!: HttpClient;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);

    // Validate configuration
    if (!this.config.ip) {
      this.log.error('Tesla Powerwall IP address is required in configuration');
      return;
    }

    if (!this.config.password) {
      this.log.error('Tesla Powerwall password is required in configuration');
      return;
    }

    // Initialize HTTP client with Tesla Powerwall credentials
    this.httpClient = new HttpClient(
      config.ip,
      config.port || '443',
      'customer', // Tesla Powerwall only supports 'customer' as username
      config.password,
      this.log,
    );

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices(): Promise<void> {
    try {
      // Test connection first
      const isConnected = await this.httpClient.testConnection();
      if (!isConnected) {
        this.log.error('Unable to connect to Tesla Powerwall. Please check your configuration.');
        return;
      }

      this.log.info('Successfully connected to Tesla Powerwall');

      // Create main Powerwall accessory
      await this.createPowerwallAccessory();

      // Create grid status accessory if enabled
      if (this.config.enableGridStatus !== false) {
        await this.createGridStatusAccessory();
      }

      // Create grid power sensors if enabled (defaults to true for backward compatibility)
      if (this.config.enableGridPowerSensors !== false) {
        await this.createGridPowerSensors();
      }

      // Create power meter accessories if enabled
      if (this.config.enablePowerMeters !== false) {
        await this.createPowerMeterAccessories();
      }

      // Remove any accessories that are no longer present
      this.removeOrphanedAccessories();

    } catch (error) {
      this.log.error('Error during device discovery:', error);
    }
  }

  /**
   * Create the main Powerwall accessory
   */
  private async createPowerwallAccessory(): Promise<void> {
    const { PowerwallAccessory } = await import('./accessories/powerwall.js');
    const uuid = this.api.hap.uuid.generate('powerwall-main');
    const displayName = 'Tesla Powerwall';

    const existingAccessory = this.accessories.get(uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      new PowerwallAccessory(this, existingAccessory);
    } else {
      this.log.info('Adding new accessory:', displayName);
      const accessory = new this.api.platformAccessory(displayName, uuid);
      accessory.context.device = { type: 'powerwall' };
      new PowerwallAccessory(this, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    this.discoveredCacheUUIDs.push(uuid);
  }

  /**
   * Create the grid status accessory
   */
  private async createGridStatusAccessory(): Promise<void> {
    const { GridStatusAccessory } = await import('./accessories/gridstatus.js');
    const uuid = this.api.hap.uuid.generate('powerwall-grid-status');
    const displayName = 'Tesla Powerwall Grid Offline';

    const existingAccessory = this.accessories.get(uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      new GridStatusAccessory(this, existingAccessory);
    } else {
      this.log.info('Adding new accessory:', displayName);
      const accessory = new this.api.platformAccessory(displayName, uuid);
      accessory.context.device = { type: 'gridstatus' };
      new GridStatusAccessory(this, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    this.discoveredCacheUUIDs.push(uuid);
  }

  /**
   * Create grid power sensor accessories
   */
  private async createGridPowerSensors(): Promise<void> {
    const { GridPowerSensorAccessory } = await import('./accessories/gridpowersensor.js');

    // Create feeding to grid sensor
    const feedingUuid = this.api.hap.uuid.generate('powerwall-grid-feeding-sensor');
    const feedingDisplayName = 'Tesla Powerwall Exporting';

    const existingFeedingAccessory = this.accessories.get(feedingUuid);

    if (existingFeedingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingFeedingAccessory.displayName);
      new GridPowerSensorAccessory(this, existingFeedingAccessory);
    } else {
      this.log.info('Adding new accessory:', feedingDisplayName);
      const accessory = new this.api.platformAccessory(feedingDisplayName, feedingUuid);
      accessory.context.device = { type: 'gridpowersensor', sensorType: 'feeding' };
      new GridPowerSensorAccessory(this, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    this.discoveredCacheUUIDs.push(feedingUuid);

    // Create pulling from grid sensor
    const pullingUuid = this.api.hap.uuid.generate('powerwall-grid-pulling-sensor');
    const pullingDisplayName = 'Tesla Powerwall Importing';

    const existingPullingAccessory = this.accessories.get(pullingUuid);

    if (existingPullingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingPullingAccessory.displayName);
      new GridPowerSensorAccessory(this, existingPullingAccessory);
    } else {
      this.log.info('Adding new accessory:', pullingDisplayName);
      const accessory = new this.api.platformAccessory(pullingDisplayName, pullingUuid);
      accessory.context.device = { type: 'gridpowersensor', sensorType: 'pulling' };
      new GridPowerSensorAccessory(this, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    this.discoveredCacheUUIDs.push(pullingUuid);
  }

  /**
   * Create power meter accessories
   */
  private async createPowerMeterAccessories(): Promise<void> {
    const { PowerMeterAccessory } = await import('./accessories/powermeter.js');
    const meterTypes = [
      { type: 'powermeter-solar', name: 'Tesla Powerwall Solar' },
      { type: 'powermeter-grid', name: 'Tesla Powerwall Grid' },
      { type: 'powermeter-load', name: 'Tesla Powerwall Load' },
      { type: 'powermeter-battery', name: 'Tesla Powerwall Battery' },
    ];

    for (const meter of meterTypes) {
      const uuid = this.api.hap.uuid.generate(meter.type);
      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
        new PowerMeterAccessory(this, existingAccessory);
      } else {
        this.log.info('Adding new accessory:', meter.name);
        const accessory = new this.api.platformAccessory(meter.name, uuid);
        accessory.context.device = { type: meter.type };
        new PowerMeterAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      this.discoveredCacheUUIDs.push(uuid);
    }
  }

  /**
   * Remove accessories that are no longer present
   */
  private removeOrphanedAccessories(): void {
    const orphanedAccessories: PlatformAccessory[] = [];

    this.accessories.forEach((accessory) => {
      if (!this.discoveredCacheUUIDs.includes(accessory.UUID)) {
        orphanedAccessories.push(accessory);
      }
    });

    if (orphanedAccessories.length > 0) {
      this.log.info('Removing orphaned accessories:', orphanedAccessories.map(a => a.displayName));
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, orphanedAccessories);
    }
  }

}
