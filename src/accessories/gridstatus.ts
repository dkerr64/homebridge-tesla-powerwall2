import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { TeslaPowerwallPlatform } from '../platform.js';
import { DEFAULT_POLLING_INTERVAL, HTTP_CACHE_MS } from '../settings.js';

/**
 * Platform Accessory for Tesla Powerwall Grid Status
 * Shows grid connection status as a contact sensor
 */
export class GridStatusAccessory {
  private service: Service;
  private informationService: Service;

  // Current state (0 = grid connected, 1 = grid disconnected)
  private gridStatus: CharacteristicValue = 0;
  private pollingIntervalId?: NodeJS.Timeout;
  private pollingInterval: number;

  constructor(
    private readonly platform: TeslaPowerwallPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.pollingInterval = (this.platform.config.pollingInterval || DEFAULT_POLLING_INTERVAL) * 1000;

    // Set accessory information
    this.informationService = this.accessory.getService(this.platform.Service.AccessoryInformation)!;
    this.informationService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Tesla')
      .setCharacteristic(this.platform.Characteristic.Model, 'Powerwall Grid Offline')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.UUID);

    // Get the ContactSensor service if it exists, otherwise create a new one
    this.service = this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);

    // Set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    // Register handlers for the characteristics
    this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(this.getGridStatus.bind(this));

    // Start polling for updates
    this.startPolling();
  }

  /**
   * Handle requests to get the current grid status
   * Returns CONTACT_DETECTED (0) when grid is connected
   * Returns CONTACT_NOT_DETECTED (1) when grid is disconnected
   */
  async getGridStatus(): Promise<CharacteristicValue> {
    setTimeout(() => this.getData(), 50); // update status asap
    this.platform.log.debug(`Get Characteristic grid status -> ${this.gridStatus ? 'Disconnected' : 'Connected'}`);
    return this.gridStatus;
  }

  private lastHttpTimestamp: number = 0;
  private lastGridStatus: CharacteristicValue = -1; // negative (invalid) value to force log on first update
  private getData = async (): Promise<void> => {
    try {
      const elapsed = Date.now() - this.lastHttpTimestamp;
      if (elapsed < this.pollingInterval) {
        this.platform.log.debug(`Fetching grid status from Powerwall API... Last update: ${elapsed}ms ago`);
      }
      this.lastHttpTimestamp = Date.now();

      const data = await this.platform.httpClient.getGridStatus(HTTP_CACHE_MS);
      // Map grid status to contact sensor state
      // "SystemGridConnected" = grid connected
      // "SystemIslandedActive" = grid disconnected (islanded)
      this.gridStatus = (data.grid_status === 'SystemGridConnected') ?
        this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED :
        this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
      this.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, this.gridStatus);

      if (this.gridStatus !== this.lastGridStatus) {
        this.lastGridStatus = this.gridStatus;
        this.platform.log.info(`Grid status changed to: ${this.gridStatus ? 'Disconnected' : 'Connected'}`);
      }
    } catch (error) {
      this.platform.log.error('Error getting grid status:', error);
    }
  };

  /**
   * Start polling for updates and push them to HomeKit
   */
  private async startPolling(): Promise<void> {
    this.getData();
    this.pollingIntervalId = setInterval(this.getData, this.pollingInterval);
  }

  /**
   * Cleanup resources when accessory is removed
   */
  destroy(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = undefined;
    }
  }
}
