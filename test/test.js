/* eslint-env mocha */
'use strict';

const assert = require('assert');
const { MockAgent } = require('undici');

const PLUGIN_NAME = 'homebridge-tesla-powerwall2';
const PLATFORM_NAME = 'TeslaPowerwall';

function createApiMock() {
  const registered = [];
  const listeners = {};
  return {
    registered,
    listeners,
    hap: {
      Service: {
        AccessoryInformation: class {},
        Battery: class {},
        ContactSensor: class {},
        LightSensor: class {},
        Lightbulb: class {},
      },
      Characteristic: {
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
        Name: 'Name',
        BatteryLevel: 'BatteryLevel',
        ChargingState: { CHARGING: 1, NOT_CHARGING: 0 },
        StatusLowBattery: { BATTERY_LEVEL_LOW: 1, BATTERY_LEVEL_NORMAL: 0 },
        ContactSensorState: { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
        CurrentAmbientLightLevel: 'CurrentAmbientLightLevel',
        On: 'On',
        Brightness: 'Brightness',
      },
      uuid: { generate: (seed) => `uuid-${seed}` },
    },
    platformAccessory: class PlatformAccessory {
      constructor(displayName, uuid) {
        this.displayName = displayName;
        this.UUID = uuid;
        this.context = {};
      }
    },
    registerPlatform(name, platformCtor) {
      registered.push({ name, platformCtor });
    },
    registerPlatformAccessories() {},
    unregisterPlatformAccessories() {},
    on(event, cb) {
      listeners[event] = cb;
    },
  };
}

function createLogger() {
  const calls = { debug: [], info: [], warn: [], error: [] };
  const make = (level) => (...args) => calls[level].push(args);
  return Object.assign(make('info'), {
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    log: () => {},
    success: () => {},
    calls,
  });
}

describe('Plugin registration', function () {
  it('registers the platform under the expected name', function () {
    const api = createApiMock();
    const indexModule = require('../dist/index.js');
    const register = indexModule.default || indexModule;
    register(api);

    assert.strictEqual(api.registered.length, 1);
    assert.strictEqual(api.registered[0].name, PLATFORM_NAME);
    assert.strictEqual(typeof api.registered[0].platformCtor, 'function');
  });

  it('exports the canonical plugin name from settings', function () {
    const settings = require('../dist/settings.js');
    assert.strictEqual(settings.PLATFORM_NAME, PLATFORM_NAME);
    assert.strictEqual(settings.PLUGIN_NAME, PLUGIN_NAME);
  });
});

describe('Platform construction', function () {
  let Platform;
  before(function () {
    const api = createApiMock();
    const indexModule = require('../dist/index.js');
    const register = indexModule.default || indexModule;
    register(api);
    Platform = api.registered[0].platformCtor;
  });

  it('logs an error and bails when ip is missing', function () {
    const api = createApiMock();
    const log = createLogger();
    new Platform(log, { name: 'tp', password: 'pw' }, api);
    const errors = log.calls.error.flat().join(' ');
    assert.ok(errors.includes('IP address'), `expected IP-address error, got: ${errors}`);
  });

  it('logs an error and bails when password is missing', function () {
    const api = createApiMock();
    const log = createLogger();
    new Platform(log, { name: 'tp', ip: '127.0.0.1' }, api);
    const errors = log.calls.error.flat().join(' ');
    assert.ok(errors.includes('password'), `expected password error, got: ${errors}`);
  });

  it('subscribes to didFinishLaunching when config is valid', function () {
    const api = createApiMock();
    const log = createLogger();
    new Platform(log, { name: 'tp', ip: '127.0.0.1', password: 'pw' }, api);
    assert.strictEqual(typeof api.listeners.didFinishLaunching, 'function');
  });
});

describe('HttpClient', function () {
  const { HttpClient } = require('../dist/lib/http-client.js');
  let mockAgent;

  beforeEach(function () {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async function () {
    await mockAgent.close();
  });

  function buildClient() {
    const log = createLogger();
    const client = new HttpClient('host.invalid', '443', 'customer', 'pw', log, {
      dispatcher: mockAgent,
      autoStartLogin: false,
    });
    return { client, log };
  }

  it('authenticates and fetches system status', async function () {
    const pool = mockAgent.get('https://host.invalid');
    pool.intercept({ path: '/api/login/Basic', method: 'POST' })
      .reply(200, '{}', { headers: { 'set-cookie': 'AuthCookie=abc; Path=/' } })
      .persist();
    pool.intercept({ path: '/api/system_status/soe', method: 'GET' })
      .reply(200, { percentage: 73.2 }, { headers: { 'content-type': 'application/json' } });

    const { client } = buildClient();
    const status = await client.getSystemStatus(0);
    assert.strictEqual(status.percentage, 73.2);
    assert.ok(client.sessionCookies.includes('AuthCookie=abc'));
  });

  it('retries once on 401 by re-authenticating', async function () {
    // Re-auth waits out the 5s rate-limit window.
    this.timeout(10000);
    const pool = mockAgent.get('https://host.invalid');
    pool.intercept({ path: '/api/login/Basic', method: 'POST' })
      .reply(200, '{}', { headers: { 'set-cookie': 'AuthCookie=fresh' } })
      .persist();

    let calls = 0;
    pool.intercept({ path: '/api/system_status/soe', method: 'GET' })
      .reply(() => {
        calls += 1;
        if (calls === 1) {
          return { statusCode: 401, data: '' };
        }
        return {
          statusCode: 200,
          data: { percentage: 50 },
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      })
      .persist();

    const { client } = buildClient();
    const status = await client.getSystemStatus(0);
    assert.strictEqual(status.percentage, 50);
    assert.ok(calls >= 2, `expected at least 2 calls, got ${calls}`);
  });

  it('caches GET responses within the cache window', async function () {
    const pool = mockAgent.get('https://host.invalid');
    pool.intercept({ path: '/api/login/Basic', method: 'POST' })
      .reply(200, '{}', { headers: { 'set-cookie': 'AuthCookie=abc' } })
      .persist();

    let hits = 0;
    pool.intercept({ path: '/api/meters/aggregates', method: 'GET' })
      .reply(() => {
        hits += 1;
        return {
          statusCode: 200,
          data: { site: { instant_power: hits * 100 } },
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      })
      .persist();

    const { client } = buildClient();
    const first = await client.getMetersAggregates(5000);
    const second = await client.getMetersAggregates(5000);
    assert.strictEqual(first.site.instant_power, 100);
    assert.strictEqual(second.site.instant_power, 100, 'second call should hit the cache');
    assert.strictEqual(hits, 1, `expected only 1 network hit, got ${hits}`);
  });
});
