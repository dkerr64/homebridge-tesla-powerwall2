import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { TeslaPowerwallPlatform } from '../platform.js';

/**
 * Platform Accessory for Tesla Powerwall Power Meters
 * Shows power flow data as light sensors with lux values representing watts
 */
export class PowerMeterAccessory {
  private service: Service;
  private informationService: Service;

  // Current power reading
  private currentPower = 0;
  private meterType: string;
  private pollingIntervalId?: NodeJS.Timeout;

  constructor(
    private readonly platform: TeslaPowerwallPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Determine meter type from device type
    this.meterType = this.getMeterType(accessory.context.device.type);

    // Set accessory information
    this.informationService = this.accessory.getService(this.platform.Service.AccessoryInformation)!;
    this.informationService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Tesla')
      .setCharacteristic(this.platform.Characteristic.Model, `Powerwall ${this.meterType} Meter`)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, `TeslaPowerwall-${this.meterType}-` + accessory.UUID);

    // Get the LightSensor service if it exists, otherwise create a new one
    // We use LightSensor because it has a numeric value (lux) that we can use for watts
    this.service = this.accessory.getService(this.platform.Service.LightSensor) ||
      this.accessory.addService(this.platform.Service.LightSensor);

    // Set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    // Register handlers for the characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
      .onGet(this.getCurrentPower.bind(this));

    // Start polling for updates
    this.startPolling();
  }

  /**
   * Get meter type from device type
   */
  private getMeterType(deviceType: string): string {
    switch (deviceType) {
    case 'powermeter-load':
      return 'load';
    case 'powermeter-solar':
      return 'solar';
    case 'powermeter-grid':
      return 'site';
    case 'powermeter-battery':
      return 'battery';
    default:
      return 'unknown';
    }
  }

  /**
   * Handle requests to get the current power reading
   * Returns power in watts mapped to lux (0.0001 to 100000 lux range)
   */
  async getCurrentPower(): Promise<CharacteristicValue> {
    try {
      const data = await this.platform.httpClient.getMetersAggregates();
      let power = 0;

      // Extract power based on meter type
      switch (this.meterType) {
      case 'load':
        power = Math.abs(data.load?.instant_power || 0);
        break;
      case 'solar':
        power = Math.abs(data.solar?.instant_power || 0);
        break;
      case 'site':
        power = Math.abs(data.site?.instant_power || 0);
        break;
      case 'battery':
        power = Math.abs(data.battery?.instant_power || 0);
        break;
      }

      // Report power directly in watts. HomeKit's ambient light level (lux)
      // characteristic accepts 0.0001 to 100000, which comfortably covers the
      // power range of any residential Powerwall installation.
      this.currentPower = Math.max(0.0001, Math.min(100000, power));

      this.platform.log.debug(`Get Characteristic ${this.meterType} Power ->`,
        `${power}W (${this.currentPower} lux)`);

      return this.currentPower;
    } catch (error) {
      this.platform.log.error(`Error getting ${this.meterType} power:`, error);
      return this.currentPower;
    }
  }

  /**
   * Start polling for updates and push them to HomeKit
   */
  private startPolling(): void {
    const pollingInterval = (this.platform.config.pollingInterval || 15) * 1000;

    this.pollingIntervalId = setInterval(async () => {
      try {
        const power = await this.getCurrentPower();
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel, power);
      } catch (error) {
        this.platform.log.error(`Error during ${this.meterType} power polling update:`, error);
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
