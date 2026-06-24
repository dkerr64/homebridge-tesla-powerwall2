# homebridge-tesla-powerwall2

[![npm](https://badgen.net/npm/v/homebridge-tesla-powerwall2/latest?icon=npm&label)](https://www.npmjs.com/package/homebridge-tesla-powerwall2)
[![npm](https://badgen.net/npm/dt/homebridge-tesla-powerwall2?label=downloads)](https://www.npmjs.com/package/homebridge-tesla-powerwall2)

**Unofficial** Homebridge Plugin for the Tesla Powerwall 2

Communication with the Tesla Powerwall is according to https://github.com/vloschiavo/powerwall2 .

This plugin has been completely modernized with TypeScript, updated dependencies, and Homebridge 2.0 compatibility while maintaining all original functionality.  With thanks to [@nmuldoon](https://github.com/nmuldoon/)

See [CHANGELOG.md](https://github.com/dkerr64/homebridge-tesla-powerwall2/blob/master/CHANGELOG.md) for latest updates and history

## Requirements

- **Node.js**: 18.15.0 or higher
- **Homebridge**: 1.6.0 or higher

## Installation

### Recommended: Homebridge UI

1. Install [Homebridge](https://github.com/homebridge/homebridge): see the [Homebridge wiki](https://github.com/homebridge/homebridge/wiki)
2. In the Homebridge Web-GUI, search for the "Tesla Powerwall" plugin and install it.
3. Configure the plugin using the config UI interface.

### Command Line Installation

```bash
npm install -g homebridge-tesla-powerwall2
```

## Testing Your Connection

Before configuring the plugin, test your connection to ensure everything works:

```bash
# Navigate to the plugin directory (if installed globally)
cd $(npm root -g)/homebridge-tesla-powerwall2

# Run the connection test
node test/integration/test-connection.js <ip-address> <password>

# Example:
node test/integration/test-connection.js 192.168.1.50 your-password-here
```

The test script will:

- ✅ Verify authentication
- ✅ Test battery status retrieval
- ✅ Test power flow data
- ✅ Test grid connectivity status
- 📋 Provide configuration template for Homebridge

### Testing Grid Power Sensors ⭐ **NEW**

To validate that the grid power sensors will work correctly:

```bash
# Run the grid sensor validator
node test/integration/validate-grid-sensors.js <ip-address> <password> [threshold]

# Example with 50W threshold:
node test/integration/validate-grid-sensors.js 192.168.1.50 your-password-here 50
```

The validator will:

- ✅ Show current power flow (grid, solar, battery, home)
- ✅ Display grid sensor states based on your threshold
- ✅ Provide recommendations for automation setup
- 💡 Help you tune the threshold for your system

## Configuration

### Basic Configuration

```json
{
    "platforms": [
        {
            "platform": "TeslaPowerwall",
            "name": "Tesla Powerwall",
            "ip": "192.168.1.50",
            "password": "your-password-here",
            "pollingInterval": 15,
            "enableGridPowerSensors": true,
            "gridSensorThreshold": 50
        }
    ]
}
```

### Required Parameters

- `platform`: Must be "TeslaPowerwall"
- `name`: Display name for your Powerwall
- `ip`: IP address of your Tesla Powerwall
- `password`: Your Powerwall password

### Optional Parameters

```json
{
    "platform": "TeslaPowerwall",
    "name": "Tesla Powerwall",
    "ip": "192.168.1.50",
    "password": "your-password-here",
    "port": "443",
    "pollingInterval": 15,
    "enableGridStatus": true,
    "enableGridPowerSensors": true,
    "gridSensorThreshold": 50,
    "enablePowerMeters": true,
    "enableHistory": false,
    "debug": false
}
```

### Configuration Options Explained

#### Connection Settings

- `ip`: **Required** - The IP address of your Tesla Powerwall on your local network
- `password`: **Required** - Your Tesla Powerwall password (set via the Tesla app)
- `port`: Port number (default: "443")

#### Monitoring Settings

- `pollingInterval`: How often to poll the Powerwall for updates in seconds (default: 15, min: 5, max: 300)
- `enableGridStatus`: Show grid connectivity status as a Contact Sensor (default: true)
- `enableGridPowerSensors`: Show sensors for grid power flow detection (default: true) ⭐ **NEW**
- `gridSensorThreshold`: Power threshold in watts for sensor activation (default: 50W, helps avoid false triggers) ⭐ **NEW**
- `enablePowerMeters`: Show power flow meters (Solar, Grid, Home, Battery) as Light Sensors (default: true)
- `enableHistory`: Enable historical data logging for Eve app (default: false)

#### Troubleshooting

- `debug`: Enable detailed debug logging (default: false)

## Features

### Accessories Provided

1. **Battery Status** - Shows battery charge level, charging state, and low battery alerts
2. **Grid Offline Sensor** (`Tesla Powerwall Grid Offline`) - Contact sensor reflecting whether the Powerwall is grid-tied
   - **Closed** = grid connected (`grid_status: SystemGridConnected`)
   - **Open** = grid disconnected / islanded (`SystemIslandedActive` or similar)
3. **Exporting Sensor** (`Tesla Powerwall Exporting`) - Contact sensor that opens when you are exporting to the grid
   - **Open** = exporting to the grid (site `instant_power` < -`gridSensorThreshold`)
   - **Closed** = idle / not exporting
4. **Importing Sensor** (`Tesla Powerwall Importing`) - Contact sensor that opens when you are importing from the grid
   - **Open** = importing from the grid (site `instant_power` > +`gridSensorThreshold`)
   - **Closed** = idle / not importing
5. **Power Meters** - Light sensors showing instantaneous power flow, in watts
   (the lux value equals watts). Three are provided:
   - `Tesla Powerwall Solar` - power your panels are generating
   - `Tesla Powerwall Grid` - power flowing to/from the utility grid
   - `Tesla Powerwall Home` - total power your home is consuming
   - `Tesla Powerwall Battery` - power flowing to/from the Powerwall battery

   > HomeKit has no native power-sensor type, so watts are carried on a light
   > sensor's lux value (range 0–100000, which covers any residential system).
   > Values are reported as actual watts.

> **A note on "Open" vs "Closed"**: HomeKit contact sensors only have two
> labels — "Open" and "Closed" — borrowed from door/window sensors. The
> convention is **Closed = quiescent / resting state, Open = the noteworthy
> event** (which is what you usually build automations on). For these
> sensors:
>
> - `Grid Offline` is **Closed** while everything is normal (grid connected)
>   and **Opens** when the Powerwall islands.
> - `Exporting` and `Importing` are **Closed** while idle and **Open** while
>   that flow direction is actively above the threshold.
>
> If you'd prefer different labels, you can rename the accessories in the
> Home app (long-press → Settings → rename); your automations will keep
> working under the new names.

### Grid Power Sensors - Automation Examples

The grid power sensors enable powerful HomeKit automations:

#### Example 1: Get notified when exporting power to the grid

```
When: Tesla Powerwall Exporting opens
Then: Send notification "You're selling power to the grid! 💰"
```

#### Example 2: Notify when importing expensive peak power

```
When: Tesla Powerwall Importing opens
AND Time is between 4:00 PM and 9:00 PM
Then: Send notification "Using peak power from grid ⚡"
```

#### Example 3: Turn off non-essential loads when pulling from grid

```
When: Tesla Powerwall Importing opens
Then: 
  - Turn off pool pump
  - Turn off EV charger
  - Send notification "Reducing load to minimize grid usage"
```

#### Example 4: Start charging devices when exporting to grid

```
When: Tesla Powerwall Exporting opens
AND Battery level > 80%
Then: 
  - Start EV charging
  - Turn on pool pump
  - Send notification "Free solar power available! ☀️"
```

### Sensor Threshold Configuration

The `gridSensorThreshold` setting (default 50W) prevents false triggers from minor power fluctuations:

- **50W (default)**: Good balance for most installations
- **100W+**: Recommended for systems with frequent small fluctuations
- **0W**: Maximum sensitivity, may cause false triggers

## Legacy Configuration (from v3.x)

For users upgrading from version 3.x, the plugin has been simplified. The old `additionalServices` configuration is no longer needed. Simply use the new boolean flags:

- `enableGridStatus` - replaces gridstatus options
- `enableGridPowerSensors` - NEW feature for grid power flow detection
- `enablePowerMeters` - replaces individual meter options
- `enableHistory` - replaces eveHistory options

## API Limitations

### Operation Mode Control (Issue #54)

**Important Note**: Due to recent Tesla Powerwall firmware updates, **operation mode control (switching between Self-Powered, Time-based, or changing Backup Reserve) is NOT available via the local API**. 

According to Tesla's architecture:

- The **local API** (used by this plugin) provides read-only access to system status and power flow data
- **Operation mode changes** require the Tesla Fleet API, which needs cloud authentication

If you need to automate operation mode changes, you have these options:

1. Use the Tesla mobile app manually
2. Integrate with Tesla's Fleet API (requires developer account and cloud access)
3. Use a separate automation system that supports the Tesla Fleet API

This plugin focuses on what's possible with the local API:

- Real-time monitoring of battery, grid, solar, and home
- Grid power flow detection (feeding/pulling sensors)
- Grid connectivity status
- Triggering HomeKit automations based on power flow

We may add Tesla Fleet API support in a future version if there's sufficient demand and if it can be implemented without compromising security or requiring complex cloud setups.

## Example Configurations

### Minimal Configuration

```json
{
    "platform": "TeslaPowerwall",
    "name": "Tesla Powerwall",
    "ip": "192.168.1.50",
    "password": "your-password-here",
    "pollingInterval": 10
}
```

### Full Configuration with All Features

```json
{
    "platform": "TeslaPowerwall",
    "name": "Tesla Powerwall",
    "ip": "192.168.1.50",
    "password": "your-password-here",
    "pollingInterval": 15,
    "enableGridStatus": true,
    "enableGridPowerSensors": true,
    "gridSensorThreshold": 50,
    "enablePowerMeters": true,
    "enableHistory": false,
    "debug": false
}
```

### Configuration with Disabled Sensors

```json
{
    "platform": "TeslaPowerwall",
    "name": "Tesla Powerwall",
    "ip": "192.168.1.50",
    "password": "your-password-here",
    "pollingInterval": 15,
    "enableGridStatus": false,
    "enableGridPowerSensors": false,
    "enablePowerMeters": false
}
```

## Troubleshooting

### 🔧 Connection Testing

Always start with the connection test script:
```bash
node test/integration/test-connection.js <ip> <username> <password>
```

### ❌ Login Errors

If you get login errors (403, authentication failed):

1. Verify your password is correct
2. Check if your Powerwall requires re-registration
3. Try the connection test script for detailed debugging

### 🔄 Plugin Stopped Working After Powerwall Update

- Ensure you're using the latest plugin version (4.1.0+)
- Verify the `password` field is correctly configured

### ⚡ Grid Power Sensors Not Triggering

If the new grid power sensors aren't working as expected:

1. Check the `gridSensorThreshold` setting - you may need to adjust it
2. Use debug logging to see actual power values: `"debug": true`
3. Verify your Powerwall is actually feeding/pulling power above the threshold
4. Check the Homebridge logs for sensor state changes

### 📊 For Older Powerwall Versions (< 20.49.0)

If your Powerwall firmware is older than 20.49.0, you may need to use the legacy version:

```bash
npm install -g homebridge-tesla-powerwall@1.1.0
```

## Development

### Building from Source

```bash
git clone https://github.com/dkerr64/homebridge-tesla-powerwall2.git
cd homebridge-tesla-powerwall2
npm install
npm run build
```

### Running Tests

```bash
npm test
npm run lint
```

## Migration from v3.x to v4.1.0

The v4.x updates include major improvements:

1. **Node.js Requirement**: Now requires Node.js 18.15.0+
2. **Simplified Configuration**: The complex `additionalServices` object has been simplified to simple boolean flags
3. **New Features**: Grid power sensors for automation triggers
4. **Dependencies**: All dependencies updated to latest versions
5. **Testing**: Use the new test script to verify connectivity

### Breaking Changes from v3.x

- Configuration format has been simplified (old format still works but is deprecated)
- Some advanced Eve features may not be available in v4.x

Simply update the plugin and restart Homebridge. Your existing configuration should continue to work, but consider migrating to the new simpler format.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests if applicable
4. Submit a pull request

## Feature Requests / Bug Reports

Please create an [Issue](https://github.com/dkerr64/homebridge-tesla-powerwall2/issues/new) with:

- Plugin version
- Homebridge version
- Node.js version
- Powerwall firmware version
- Detailed description of the issue
- Log output if applicable

## License

This project is licensed under the Apache 2.0 - see the [LICENSE](https://github.com/dkerr64/homebridge-tesla-powerwall2/blob/master/LICENSE) file for details.

---

**Disclaimer**: This is an unofficial plugin and is not associated with Tesla, Inc. in any way.
