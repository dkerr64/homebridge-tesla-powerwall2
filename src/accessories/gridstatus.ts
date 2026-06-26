import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { TeslaPowerwallPlatform } from '../platform.js';

/**
 * Platform Accessory for Tesla Powerwall Grid Status
 * Shows grid connection status as a contact sensor
 */
export class GridStatusAccessory {
  private service: Service;
  private informationService: Service;

  // Current state (0 = grid connected, 1 = grid disconnected)
  private gridStatus = 0;
  private pollingIntervalId?: NodeJS.Timeout;

  constructor(
    private readonly platform: TeslaPowerwallPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
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
    try {
      const data = await this.platform.httpClient.getGridStatus();
      
      // Map grid status to contact sensor state
      // "SystemGridConnected" = grid connected
      // "SystemIslandedActive" = grid disconnected (islanded)
      const isGridConnected = data.grid_status === 'SystemGridConnected';
      
      this.gridStatus = isGridConnected ? 
        this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED :
        this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
      
      this.platform.log.debug('Get Characteristic GridStatus ->', 
        isGridConnected ? 'Connected' : 'Disconnected', 
        '(', this.gridStatus, ')');
      
      return this.gridStatus;
    } catch (error) {
      this.platform.log.error('Error getting grid status:', error);
      return this.gridStatus;
    }
  }

  /**
   * Start polling for updates and push them to HomeKit
   */
  private startPolling(): void {
    const pollingInterval = (this.platform.config.pollingInterval || 15) * 1000;

    this.pollingIntervalId = setInterval(async () => {
      try {
        const gridStatus = await this.getGridStatus();
        this.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, gridStatus);
      } catch (error) {
        this.platform.log.error('Error during grid status polling update:', error);
      }
    }, pollingInterval);
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
