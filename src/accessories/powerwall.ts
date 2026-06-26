import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { TeslaPowerwallPlatform } from '../platform.js';
import { DEFAULT_POLLING_INTERVAL, HTTP_CACHE_MS } from '../settings.js';

/**
 * Platform Accessory for Tesla Powerwall Battery
 * An instance of this class is created for the main Powerwall battery accessory
 */
export class PowerwallAccessory {
  private service: Service;
  private lightbulbService: Service;
  private informationService: Service;

  // Current states
  private batteryLevel: number = 50;
  private chargingState: CharacteristicValue = 0; // 0 = Not Charging, 1 = Charging, 2 = Not Chargeable
  private lowBatteryStatus: CharacteristicValue = 0; // 0 = Normal, 1 = Low
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
    if (!this.requestQueued) {
      // update status asap but avoid queuing multiple requests
      this.requestQueued = true;
      setTimeout(() => {
        this.getData();
        this.requestQueued = false;
      }, 50);
    }
    this.platform.log.debug(`Get Characteristic battery level -> ${this.batteryLevel}`);
    return this.batteryLevel;
  }

  /**
   * Handle requests to get the current value of the "Charging State" characteristic
   */
  async getChargingState(): Promise<CharacteristicValue> {
    if (!this.requestQueued) {
      // update status asap but avoid queuing multiple requests
      this.requestQueued = true;
      setTimeout(() => {
        this.getData();
        this.requestQueued = false;
      }, 50);
    }
    this.platform.log.debug(`Get Characteristic charging state -> ${this.chargingState ? 'Charging' : 'Not Charging'}`);
    return this.chargingState;
  }

  /**
   * Handle requests to get the current value of the "Status Low Battery" characteristic
   */
  async getStatusLowBattery(): Promise<CharacteristicValue> {
    if (!this.requestQueued) {
      // update status asap but avoid queuing multiple requests
      this.requestQueued = true;
      setTimeout(() => {
        this.getData();
        this.requestQueued = false;
      }, 50);
    }
    this.platform.log.debug(`Get Characteristic low battery state -> ${this.lowBatteryStatus ? 'Low' : 'Normal'}`);
    return this.lowBatteryStatus;
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
    if (!this.requestQueued) {
      // update status asap but avoid queuing multiple requests
      this.requestQueued = true;
      setTimeout(() => {
        this.getData();
        this.requestQueued = false;
      }, 50);
    }
    this.platform.log.debug(`Get Characteristic brightness (battery level) -> ${this.batteryLevel}`);
    return this.batteryLevel;
  }

  /**
   * Handle requests to set the value of the Lightbulb "Brightness" characteristic
   */
  async setLightbulbBrightness(value: CharacteristicValue): Promise<void> {
    // We are ignoring the request and will immediately set the value back to what it was (so user interface is correct)
    // Calling updateCharacteristic within set handler fails, new value is not accepted.  Workaround is to request
    // the update after short delay (say 50ms).
    if (value !== this.batteryLevel) {
      this.platform.log.debug('Ignoring user request to change Powerwall brightness.');
      setTimeout(() => {
        this.lightbulbService.updateCharacteristic(this.platform.Characteristic.Brightness, this.batteryLevel);
        this.lightbulbService.updateCharacteristic(this.platform.Characteristic.On, true);
      }, 50);
    }
  }

  private requestQueued: boolean = false;
  private lastHttpTimestamp: number = 0;
  private lastBatteryLevel: number = 0;
  private lastLowBatteryStatus: CharacteristicValue = -1; // negative (invalid) value to force log on first update
  private lastChargingState: CharacteristicValue = -1; // negative (invalid) value to force log on first update
  private getData = async (): Promise<void> => {
    try {
      const elapsed = Date.now() - this.lastHttpTimestamp;
      if (elapsed < this.pollingInterval) {
        this.platform.log.debug(`Fetching Powerwall status from API... Last update: ${elapsed}ms ago`);
      }
      this.lastHttpTimestamp = Date.now();

      const systemData = await this.platform.httpClient.getSystemStatus(HTTP_CACHE_MS);
      const resolvedPercentage = systemData.percentage ?? this.batteryLevel ?? 50;
      // HomeKit BatteryLevel is an integer 0-100. Round down to match the Tesla
      // and Apple Home apps, which always floor the reported percentage.
      this.batteryLevel = Math.floor(resolvedPercentage);
      this.service.updateCharacteristic(this.platform.Characteristic.BatteryLevel, this.batteryLevel);
      this.lightbulbService.updateCharacteristic(this.platform.Characteristic.Brightness, this.batteryLevel);
      this.lightbulbService.updateCharacteristic(this.platform.Characteristic.On, true);

      if (this.batteryLevel !== this.lastBatteryLevel) {
        this.lastBatteryLevel = this.batteryLevel;
        this.platform.log.info(`Powerwall battery level changed to: ${this.batteryLevel}`);
      }

      const lowBatteryThreshold = this.platform.config.lowBattery ?? 20;
      this.lowBatteryStatus = this.batteryLevel <= lowBatteryThreshold ?
        this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
        this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      this.service.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.lowBatteryStatus);

      if (this.lowBatteryStatus !== this.lastLowBatteryStatus) {
        this.lastLowBatteryStatus = this.lowBatteryStatus;
        this.platform.log.info(`Powerwall low battery status changed to: ${this.lowBatteryStatus ? 'Low' : 'Normal'}`);
      }

      const metersData = await this.platform.httpClient.getMetersAggregates(HTTP_CACHE_MS);
      const batteryPower = metersData.battery?.instant_power || 0;
      // Tesla API convention: battery.instant_power is negative when charging,
      // positive when discharging. 50W threshold filters out idle noise.
      this.chargingState = batteryPower < -50 ?
        this.platform.Characteristic.ChargingState.CHARGING :
        this.platform.Characteristic.ChargingState.NOT_CHARGING;
      this.service.updateCharacteristic(this.platform.Characteristic.ChargingState, this.chargingState);

      if (this.chargingState !== this.lastChargingState) {
        this.lastChargingState = this.chargingState;
        this.platform.log.info(`Powerwall charging state changed to: ${this.chargingState ? 'Charging' : 'Not Charging'}`);
      }
    } catch (error) {
      this.platform.log.error('Error getting Powerwall status:', error);
    }
  };

  /**
   * Start polling for updates and push them to HomeKit
   */
  private startPolling(): void {
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
