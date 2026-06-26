import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { TeslaPowerwallPlatform } from '../platform.js';

/**
 * Platform Accessory for Tesla Powerwall Battery
 * An instance of this class is created for the main Powerwall battery accessory
 */
export class PowerwallAccessory {
  private service: Service;
  private lightbulbService: Service;
  private informationService: Service;

  // Current states
  private batteryLevel = 50;
  private chargingState = 0; // 0 = Not Charging, 1 = Charging, 2 = Not Chargeable
  private lowBatteryStatus = 0; // 0 = Normal, 1 = Low
  private pollingIntervalId?: NodeJS.Timeout;

  constructor(
    private readonly platform: TeslaPowerwallPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Set accessory information
    this.informationService = this.accessory.getService(this.platform.Service.AccessoryInformation)!;
    this.informationService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Tesla')
      .setCharacteristic(this.platform.Characteristic.Model, 'Powerwall')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.UUID);

    // Get the BatteryService service if it exists, otherwise create a new one
    this.service = this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery);

    // Set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    // Register handlers for the characteristics
    this.service.getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.ChargingState)
      .onGet(this.getChargingState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(this.getStatusLowBattery.bind(this));

    // Get or create the Lightbulb service (primary service for HomeKit display)
    // This allows the battery to show properly in the Home app instead of "Not Supported"
    this.lightbulbService = this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);

    // Set the lightbulb service name
    this.lightbulbService.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    // Register handlers for the Lightbulb characteristics
    this.lightbulbService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getLightbulbOn.bind(this))
      .onSet(this.setLightbulbOn.bind(this));

    this.lightbulbService.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getLightbulbBrightness.bind(this))
      .onSet(this.setLightbulbBrightness.bind(this));

    // Start polling for updates
    this.startPolling();
  }

  /**
   * Handle requests to get the current value of the "Battery Level" characteristic
   */
  async getBatteryLevel(): Promise<CharacteristicValue> {
    try {
      const data = await this.platform.httpClient.getSystemStatus();
      const reportedPercentage = data.percentage;
      const resolvedPercentage = reportedPercentage ?? this.batteryLevel ?? 50;
      // HomeKit BatteryLevel is an integer 0-100. Round down to match the Tesla
      // and Apple Home apps, which always floor the reported percentage.
      this.batteryLevel = Math.floor(resolvedPercentage);
      this.service.updateCharacteristic(this.platform.Characteristic.BatteryLevel, this.batteryLevel);

      this.platform.log.debug('Get Characteristic BatteryLevel ->', this.batteryLevel);
      return this.batteryLevel;
    } catch (error) {
      this.platform.log.error('Error getting battery level:', error);
      return this.batteryLevel;
    }
  }

  /**
   * Handle requests to get the current value of the "Charging State" characteristic
   */
  async getChargingState(): Promise<CharacteristicValue> {
    try {
      const data = await this.platform.httpClient.getMetersAggregates();
      const batteryPower = data.battery?.instant_power || 0;

      // Tesla API convention: battery.instant_power is negative when charging,
      // positive when discharging. 50W threshold filters out idle noise.
      if (batteryPower < -50) {
        this.chargingState = this.platform.Characteristic.ChargingState.CHARGING;
      } else {
        this.chargingState = this.platform.Characteristic.ChargingState.NOT_CHARGING;
      }

      this.platform.log.debug('Get Characteristic ChargingState ->', this.chargingState);
      return this.chargingState;
    } catch (error) {
      this.platform.log.error('Error getting charging state:', error);
      return this.chargingState;
    }
  }

  /**
   * Handle requests to get the current value of the "Status Low Battery" characteristic
   */
  async getStatusLowBattery(): Promise<CharacteristicValue> {
    try {
      const data = await this.platform.httpClient.getSystemStatus();
      const reportedPercentage = data.percentage;
      const resolvedPercentage = reportedPercentage ?? this.batteryLevel ?? 50;
      this.batteryLevel = Math.floor(resolvedPercentage);
      this.service.updateCharacteristic(this.platform.Characteristic.BatteryLevel, this.batteryLevel);

      const lowBatteryThreshold = this.platform.config.lowBattery ?? 20;

      this.lowBatteryStatus = this.batteryLevel <= lowBatteryThreshold ?
        this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
        this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

      this.service.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.lowBatteryStatus);

      this.platform.log.debug('Get Characteristic StatusLowBattery ->', this.lowBatteryStatus);
      return this.lowBatteryStatus;
    } catch (error) {
      this.platform.log.error('Error getting low battery status:', error);
      return this.lowBatteryStatus;
    }
  }

  /**
   * Handle requests to get the current value of the Lightbulb "On" characteristic
   * Always returns true to indicate the Powerwall is present/active
   */
  async getLightbulbOn(): Promise<CharacteristicValue> {
    // Always return true - the lightbulb is "on" to visualize the battery
    return true;
  }

  async setLightbulbOn(value: CharacteristicValue): Promise<void> {
    // We are ignoring the request and will immediately set the value back to what it was (so user interface is correct)
    // Calling updateCharacteristic within set handler fails, new value is not accepted.  Workaround is to request
    // the update after short delay (say 50ms).
    if (value === false) {
      this.platform.log.debug('Ignoring user request to turn Powerwall off.');
      setTimeout(() => {
        this.lightbulbService.updateCharacteristic(this.platform.Characteristic.On, true);
      }, 50);
    }
  }

  /**
   * Handle requests to get the current value of the Lightbulb "Brightness" characteristic
   * Returns the battery percentage (0-100%)
   */
  async getLightbulbBrightness(): Promise<CharacteristicValue> {
    try {
      const data = await this.platform.httpClient.getSystemStatus();
      const reportedPercentage = data.percentage;
      const resolvedPercentage = reportedPercentage ?? this.batteryLevel ?? 50;
      // HomeKit Brightness is an integer 0-100. Round down to match the Apple
      // Home app, which always floors the displayed value.
      const brightness = Math.floor(resolvedPercentage);
      this.platform.log.debug('Get Characteristic Brightness (Battery Level) ->', brightness);
      return brightness;
    } catch (error) {
      this.platform.log.error('Error getting battery level for brightness:', error);
      return this.batteryLevel;
    }
  }

  /**
   * Handle requests to set the value of the Lightbulb "Brightness" characteristic
   */
  async setLightbulbBrightness(value: CharacteristicValue): Promise<void> {
    // We are ignoring the request and will immediately set the value back to what it was (so user interface is correct)
    // Calling updateCharacteristic within set handler fails, new value is not accepted.  Workaround is to request
    // the update after short delay (say 50ms).
    if (value !== this.batteryLevel) {
      this.platform.log.debug('Ignoring user request to change Powerwall "brightness".');
      setTimeout(() => {
        this.lightbulbService.updateCharacteristic(this.platform.Characteristic.Brightness, this.batteryLevel);
        this.lightbulbService.updateCharacteristic(this.platform.Characteristic.On, true);
      }, 50);
    }
  }

  /**
   * Start polling for updates and push them to HomeKit
   */
  private startPolling(): void {
    const pollingInterval = (this.platform.config.pollingInterval || 15) * 1000;

    this.pollingIntervalId = setInterval(async () => {
      try {
        // Update battery level
        const batteryLevel = await this.getBatteryLevel();
        this.service.updateCharacteristic(this.platform.Characteristic.BatteryLevel, batteryLevel);

        // Update charging state
        const chargingState = await this.getChargingState();
        this.service.updateCharacteristic(this.platform.Characteristic.ChargingState, chargingState);

        // Update low battery status
        const lowBatteryStatus = await this.getStatusLowBattery();
        this.service.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, lowBatteryStatus);

        // Update lightbulb brightness to match battery level
        this.lightbulbService.updateCharacteristic(this.platform.Characteristic.Brightness, batteryLevel);
        // Lightbulb is always on
        this.lightbulbService.updateCharacteristic(this.platform.Characteristic.On, true);

      } catch (error) {
        this.platform.log.error('Error during polling update:', error);
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
