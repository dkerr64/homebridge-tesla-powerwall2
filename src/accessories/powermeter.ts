import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { TeslaPowerwallPlatform } from '../platform.js';
import { DEFAULT_POLLING_INTERVAL, HTTP_CACHE_MS } from '../settings.js';

/**
 * Platform Accessory for Tesla Powerwall Power Meters
 * Shows power flow data as light sensors with lux values representing watts
 */
export class PowerMeterAccessory {
  private service: Service;
  private informationService: Service;

  // Current power reading
  private currentPower: number = 0.0001;
  private meterType: string;
  private pollingIntervalId?: NodeJS.Timeout;
  private pollingInterval: number;

  constructor(
    private readonly platform: TeslaPowerwallPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Determine meter type from device type
    this.meterType = this.getMeterType(accessory.context.device.type);
    this.pollingInterval = (this.platform.config.pollingInterval || DEFAULT_POLLING_INTERVAL) * 1000;

    // Set accessory information
    this.informationService = this.accessory.getService(this.platform.Service.AccessoryInformation)!;
    this.informationService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Tesla')
      .setCharacteristic(this.platform.Characteristic.Model, `Powerwall ${this.meterType} Meter`)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.UUID);

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
      case 'powermeter-home':
        return 'home';
      case 'powermeter-solar':
        return 'solar';
      case 'powermeter-grid':
        return 'grid';
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
    setTimeout(() => this.getData(), 50); // update status asap
    this.platform.log.debug(`Get Characteristic ${this.meterType} power -> ${this.currentPower.toFixed(1)}W (lux)`);
    return this.currentPower;
  }

  private lastHttpTimestamp: number = 0;
  private lastPower: number = 999999; // Invalid value to force log on first update
  private getData = async (): Promise<void> => {
    try {
      const elapsed = Date.now() - this.lastHttpTimestamp;
      if (elapsed < this.pollingInterval) {
        this.platform.log.debug(`Fetching ${this.meterType} watts from Powerwall API... Last update: ${elapsed}ms ago`);
      }
      this.lastHttpTimestamp = Date.now();

      const data = await this.platform.httpClient.getMetersAggregates(HTTP_CACHE_MS);
      let power = 0;
      // Extract power based on meter type
      switch (this.meterType) {
        case 'home':
          power = Math.abs(data.load?.instant_power || 0);
          break;
        case 'solar':
          power = Math.abs(data.solar?.instant_power || 0);
          break;
        case 'grid':
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
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel, this.currentPower);

      if (this.currentPower !== this.lastPower) {
        this.lastPower = this.currentPower;
        // Use debug rather than info because this is a frequent update
        this.platform.log.debug(`Power ${this.meterType} changed to: ${this.currentPower.toFixed(1)}W`);
      }
    } catch (error) {
      this.platform.log.error(`Error during ${this.meterType} power polling update:`, error);
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
