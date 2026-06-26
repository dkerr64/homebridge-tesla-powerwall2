import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { TeslaPowerwallPlatform } from '../platform.js';
import { DEFAULT_POLLING_INTERVAL, HTTP_CACHE_MS } from '../settings.js';

/**
 * Platform Accessory for Tesla Powerwall Grid Power Flow Sensors
 * 
 * Triggers notifications when the system is exporting to or importing power from the grid.
 * Uses the /api/meters/aggregates endpoint to monitor real-time power flow.
 * 
 * This accessory creates two sensor types:
 * 1. Exporting to Grid - triggers when power flows to the grid (negative site power)
 * 2. Importing from Grid - triggers when power flows from the grid (positive site power)
 * 
 * Both sensors use configurable thresholds to avoid false triggers from minor fluctuations.
 * 
 * @class GridPowerSensorAccessory
 */
export class GridPowerSensorAccessory {
  private service: Service;
  private informationService: Service;

  // Current sensor state (0 = normal, 1 = detected)
  private sensorState: CharacteristicValue = 0;
  private sensorType: 'exporting' | 'importing';
  private pollingIntervalId?: NodeJS.Timeout;
  private pollingInterval: number;

  /**
   * Constructor for GridPowerSensorAccessory
   * 
   * @param platform - Reference to the main platform
   * @param accessory - PlatformAccessory instance from Homebridge
   */
  constructor(
    private readonly platform: TeslaPowerwallPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Determine sensor type from device context
    this.sensorType = accessory.context.device.sensorType;
    this.pollingInterval = (this.platform.config.pollingInterval || DEFAULT_POLLING_INTERVAL) * 1000;

    // Validate sensor type
    if (!this.sensorType || (this.sensorType !== 'exporting' && this.sensorType !== 'importing')) {
      this.platform.log.error(`Invalid or missing sensor type for ${accessory.displayName}. Expected 'exporting' or 'importing', got: ${this.sensorType}`);
      this.sensorType = 'exporting'; // Fallback to prevent crash
    }

    // Set accessory information
    this.informationService = this.accessory.getService(this.platform.Service.AccessoryInformation)!;
    this.informationService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Tesla')
      .setCharacteristic(this.platform.Characteristic.Model, `Powerwall ${this.sensorType} sensor`)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.UUID);

    // Get or create the ContactSensor service
    // We use ContactSensor because it can trigger automations in HomeKit
    this.service = this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);

    // Set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    // Register handlers for the characteristics
    this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(this.getSensorState.bind(this));

    // Start polling for updates
    this.startPolling();
  }

  /**
   * Handle requests to get the current sensor state.
   *
   * For the exporting sensor: Returns CONTACT_NOT_DETECTED (Open) when site
   * power < -threshold; CONTACT_DETECTED (Closed) otherwise.
   * For the importing sensor: Returns CONTACT_NOT_DETECTED (Open) when site
   * power > threshold; CONTACT_DETECTED (Closed) otherwise.
   *
   * The threshold helps avoid false triggers from minor power fluctuations.
   * Default threshold is 50W, configurable via gridSensorThreshold config option.
   *
   * @returns {Promise<CharacteristicValue>} The current sensor state
   */
  async getSensorState(): Promise<CharacteristicValue> {
    setTimeout(() => this.getData(), 50); // update status asap
    this.platform.log.debug(`Get Characteristic ${this.sensorType} sensor state -> ${this.sensorState ? 'Active' : 'Idle'}`);
    return this.sensorState;
  }

  private lastHttpTimestamp: number = 0;
  private lastStatus: CharacteristicValue = -1; // negative (invalid) value to force log on first update
  private getData = async (): Promise<void> => {
    try {
      const elapsed = Date.now() - this.lastHttpTimestamp;
      if (elapsed < this.pollingInterval) {
        this.platform.log.debug(`Fetching ${this.sensorType} status from Powerwall API... Last update: ${elapsed}ms ago`);
      }
      this.lastHttpTimestamp = Date.now();

      const data = await this.platform.httpClient.getMetersAggregates(HTTP_CACHE_MS);
      const gridPower = data.site?.instant_power || 0;
      // Get threshold from config, default to 50W to avoid noise
      // Use nullish coalescing to allow 0 as a valid threshold value
      const threshold = this.platform.config.gridSensorThreshold ?? 50;
      const isConditionMet = (this.sensorType === 'exporting') ? gridPower < -threshold : gridPower > threshold;
      // Idle (no flow) is the quiescent state and maps to Closed, matching
      // HomeKit door-sensor convention where Open is the noteworthy event.
      // Active export/import triggers Open so it reads naturally in
      // automations ("when Exporting opens, ...").
      this.sensorState = isConditionMet ?
        this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED :
        this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
      this.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, this.sensorState);

      if (this.sensorState !== this.lastStatus) {
        this.lastStatus = this.sensorState;
        this.platform.log.info(`Grid ${this.sensorType} sensor status changed to: ${this.sensorState ? 'Active' : 'Idle'} (${gridPower.toFixed(1)}W)`);
      }

    } catch (error) {
      this.platform.log.error(`Error during grid ${this.sensorType} sensor polling update:`, error);
    }
  };

  /**
   * Start polling for updates and push them to HomeKit
   * 
   * Polls the Powerwall API at the configured interval
   * and updates the HomeKit characteristic when the sensor state changes.
   * 
   * Stores the interval ID to allow proper cleanup when accessory is removed.
   */
  private async startPolling(): Promise<void> {
    this.getData();
    this.pollingIntervalId = setInterval(this.getData, this.pollingInterval);
  }

  /**
   * Cleanup resources when accessory is removed
   * 
   * Stops the polling interval to prevent memory leaks.
   * Should be called when the accessory is being destroyed or removed.
   */
  destroy(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = undefined;
    }
  }
}
