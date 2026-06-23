# Changelog

All notable changes to this project will be documented in this file.

## [4.2.4] - 2026-06-??

Plugin renamed from homebridge-tesla-powerwall to homebridge-tesla-powerwall2 and maintainer changed to @dkerr64
- To disquinguish from the legacy plugin that no longer works
- To allow us to publish this new plugin on [npmjs](https://www.npmjs.com/) as maintainer of original plugin is not responding to outreach on whether he would accept a pull request and update the published plugin
- And reflects that the plugin is only tested with Powerwall 2

## [4.2.3] - 2026-06-11

### Fixed
- Power meters (solar/grid/load) now report the **actual watts** instead of
  one-tenth of the reading. The previous `power / 10` scaling was removed;
  HomeKit's ambient-light (lux) characteristic accepts up to 100000, which
  comfortably covers any residential Powerwall. (#18)
- Battery level and the battery lightbulb brightness now **round down**
  (`Math.floor`) instead of to the nearest integer, matching the Tesla and
  Apple Home apps and the HomeKit integer 0–100 spec. (#19)

### Changed
- `tsconfig.json` now uses `"module"`/`"moduleResolution": "nodenext"`
  (the previous `"node"` value is deprecated), matching the current
  homebridge-plugin-template. Relative dynamic imports were given explicit
  `.js` extensions as required by `nodenext`. (#17)
- Added a `lint` script (`eslint . --max-warnings=0`) and made
  `prepublishOnly` run lint before build, matching the plugin template.
  Fixed the existing lint errors (switch-case indentation, unused import)
  and renamed `eslint.config.js` → `eslint.config.mjs` to clear the
  `MODULE_TYPELESS_PACKAGE_JSON` warning. (#16)

### Documentation
- Expanded the README's power-meter description to spell out what each
  meter shows (Solar = generation, Grid = utility flow, Load = household
  consumption) and to note that the lux value equals actual watts.

## [4.2.2] - 2026-06-10

### Changed (breaking for existing automations)
- Inverted the contact-sensor polarity for the `Exporting` and `Importing`
  sensors so it now matches HomeKit's door-sensor convention: **Closed
  while idle, Open while active**. Previously the sensors reported
  `Closed` whenever export/import was actively flowing, which left both
  tiles showing `Open` at rest and made automations read backwards. If you
  built automations on the old polarity (triggering on "detects contact"
  while flow was active), flip them to trigger on the sensor opening
  instead. The `Grid Online` sensor is unchanged — it was already
  Closed-at-rest.
- Renamed the three grid contact sensors to action-oriented labels so the
  tile name alone conveys the meaning:
  - `Tesla Powerwall Grid Status` → `Tesla Powerwall Grid Online`
  - `Tesla Powerwall Grid Feeding` → `Tesla Powerwall Exporting`
  - `Tesla Powerwall Grid Pulling` → `Tesla Powerwall Importing`
  Accessory UUIDs are seeded by stable strings, so existing installs keep
  their HomeKit identity; only new installs see the new defaults, and any
  Home-app rename overrides the plugin label anyway. Config keys
  (`enableGridStatus`, `enableGridPowerSensors`) are unchanged.
- `AccessoryInformation.Model` strings updated to match the new names.
- Homebridge UI titles/descriptions in `config.schema.json` reworded for
  the new names (underlying property names unchanged).

### Documentation
- README "Accessories Provided" section rewritten with the new names and
  explicit Open/Closed state mapping for each contact sensor, plus a note
  on HomeKit's door-sensor terminology (Open = event, Closed = idle).
- Automation examples updated to reference the new accessory names and the
  new "sensor opens" trigger phrasing.

## [4.2.1] - 2026-06-10

### Fixed
- Inverted Powerwall charging state (#10). The Tesla aggregates API reports
  `battery.instant_power` as positive when discharging and negative when
  charging; the comparison in `getChargingState` had the polarity reversed,
  so HomeKit saw `CHARGING` during discharge and vice versa.

### Tests
- Added unit coverage for `PowerwallAccessory.getChargingState` around the
  charging/discharging/noise-band cases.

## [4.2.0] - 2026-06-09

### Changed
- Replaced `node-fetch` with `undici` and Node's native fetch
- Bumped Homebridge dev dependency to 2.x (matches `engines` field)
- Updated `@types/node`, `typescript-eslint`, `mocha`, `nock`, `tough-cookie` to latest
- Switched coverage tooling from `nyc` to `c8` (no instrumentation, no vulnerable transitives)
- Shared cache window (3s default) on all Powerwall API calls so concurrent accessory polls share a single network request
- `HttpClient` interface now strongly typed in `TeslaPowerwallPlatformInterface` (was `any`)

### Removed
- Unused runtime deps: `moment`, `fakegato-history`, `node-fetch`, `@types/node-fetch`
- Unused dev deps: `chalk`, `tough-cookie`, `events`
- Orphaned `src/configUI.ts` (never wired up)
- Orphaned `src/helper/` JS files (pre-TypeScript-rewrite leftovers)
- Dead `createAccessoryHandler` method in `platform.ts`
- Legacy `.eslintrc.json` (superseded by flat `eslint.config.js`)
- `README.md.old`
- `enableHistory` config option (no implementation existed)

### Security
- Reduced `npm audit` findings from 12 → 0 by adding `overrides` for the
  remaining mocha transitives (`diff` → `^9.0.0`, `serialize-javascript` →
  `^7.0.5`). Mocha's runtime usage (`diffWordsWithSpace`, `createPatch`) is
  stable across these majors; the test suite passes unchanged.

### Tests
- Replaced the legacy mocha suite (which targeted the pre-TypeScript static-platform shape with `0_powerwall`/`1_solar`/`PowerMeterService` etc.) with focused tests for the current `DynamicPlatformPlugin`: plugin registration, platform construction error paths, and HttpClient auth/401-retry/cache behaviour exercised through `undici.MockAgent`
- `HttpClient` now accepts an optional `dispatcher` and `autoStartLogin` flag so its HTTP layer is unit-testable
- Migrated `test/integration/*.js` scripts off `node-fetch`/`tough-cookie` onto `undici`

## [4.1.0] - 2026-01-16

### Added
- **Grid Power Sensors** (addresses Issue #35)
  - New "Grid Feeding" sensor triggers when exporting power to grid
  - New "Grid Pulling" sensor triggers when importing power from grid
  - Configurable threshold (default 50W) to prevent false triggers
  - Perfect for HomeKit automations and energy management
  - Validation script for testing sensor behavior

- **Testing Tools**
  - Grid sensor validation script (`test/integration/validate-grid-sensors.js`)
  - Real-time power flow visualization
  - Sensor state evaluation

- **Documentation**
  - Comprehensive automation examples (4 use cases)
  - API limitation documentation for operation mode control
  - Testing instructions
  - Configuration examples

### Changed
- Updated all dependencies to latest compatible versions
  - @eslint/js: 9.8.0 → 9.39.2
  - @types/node: 20.5.0 → 20.19.30
  - eslint: 9.8.0 → 9.39.2
  - homebridge: 1.8.0 → 1.11.1
  - typescript: 5.2.2 → 5.9.3
  - And more...

### Fixed
- Memory leaks in all accessories (added proper cleanup methods)
- Type safety improvements across the codebase
- Nullish coalescing for numeric config values (allows 0 as valid threshold)
- Parameter validation in validation script

### Security
- Fixed 4 npm audit vulnerabilities (6→2 remaining low-severity dev dependencies)
- CodeQL security scan: 0 alerts

### Documented
- **Operation Mode Control Limitations** (Issue #54)
  - Local API does not support changing operation modes
  - Requires Tesla Fleet API (cloud-based)
  - Provided alternatives and future roadmap

## [4.0.1] - Previous Version
- TypeScript rewrite
- Homebridge 2.0 compatibility
- Modern dependency updates

[4.1.0]: https://github.com/nmuldoon/homebridge-tesla-powerwall/compare/v4.0.1...v4.1.0
[4.0.1]: https://github.com/nmuldoon/homebridge-tesla-powerwall/releases/tag/v4.0.1
