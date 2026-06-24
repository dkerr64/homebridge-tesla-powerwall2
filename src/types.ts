import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import type { HttpClient } from './lib/http-client.js';

export interface TeslaPowerwallPlatformInterface extends DynamicPlatformPlugin {
  readonly Service: typeof Service;
  readonly Characteristic: typeof Characteristic;
  readonly accessories: Map<string, PlatformAccessory>;
  readonly discoveredCacheUUIDs: string[];
  readonly httpClient: HttpClient;
  readonly log: Logging;
  readonly config: PlatformConfig;
  readonly api: API;
}

/**
 * Meter data from the Tesla Powerwall aggregates endpoint.
 *
 * Sign conventions:
 * - Site/Grid: Positive = importing, Negative = exporting
 * - Battery: Positive = discharging, Negative = charging
 * - Solar: Always positive when generating
 * - Load: Always positive when consuming
 */
export interface MeterData {
  last_communication_time: string;
  instant_power: number;
  instant_reactive_power: number;
  instant_apparent_power: number;
  frequency: number;
  energy_exported: number;
  energy_imported: number;
  instant_average_voltage: number;
  instant_total_current: number;
  i_a_current: number;
  i_b_current: number;
  i_c_current: number;
}

export interface MetersAggregatesResponse {
  site: MeterData;
  battery: MeterData;
  load: MeterData;
  solar: MeterData;
  busway?: MeterData;
  frequency?: MeterData;
  generator?: MeterData;
}

export interface SystemStatusResponse {
  percentage: number;
  nominal_energy_remaining?: number;
  nominal_full_pack_energy?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface GridStatusResponse {
  grid_status: string;
  grid_services_active: boolean;
  [key: string]: string | number | boolean | undefined;
}
