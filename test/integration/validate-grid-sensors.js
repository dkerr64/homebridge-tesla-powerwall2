#!/usr/bin/env node

/**
 * Grid Power Sensor Validation Script
 * 
 * This script validates that the grid power sensors are working correctly
 * by checking the power flow data from the Powerwall API.
 * 
 * Note: Uses CommonJS (require) for compatibility with Node.js execution
 * as a standalone script without TypeScript compilation.
 */

/* eslint-disable no-console */

const { Agent, fetch } = require('undici');

// Configuration
const config = {
  ip: process.env.POWERWALL_IP || process.argv[2] || '',
  password: process.env.POWERWALL_PASSWORD || process.argv[3] || '',
  threshold: parseInt(process.env.GRID_THRESHOLD || process.argv[4] || '50', 10),
};

// Show usage if required parameters are missing
if (!config.ip || !config.password) {
  console.log('🔋 Tesla Powerwall Grid Power Sensor Validator');
  console.log('=============================================');
  console.log('');
  console.log('This script validates the grid power sensor functionality by reading');
  console.log('power flow data from your Tesla Powerwall.');
  console.log('');
  console.log('Usage:');
  console.log('  node test/integration/validate-grid-sensors.js <ip> <password> [threshold]');
  console.log('');
  console.log('Parameters:');
  console.log('  ip        - IP address of your Tesla Powerwall (required)');
  console.log('  password  - Tesla Powerwall password (required)');
  console.log('  threshold - Grid sensor threshold in watts (default: 50)');
  console.log('');
  console.log('Example:');
  console.log('  node test/integration/validate-grid-sensors.js 192.168.1.100 mypassword 50');
  console.log('');
  process.exit(1);
}

async function validateGridSensors() {
  try {
    console.log('🔋 Tesla Powerwall Grid Power Sensor Validator');
    console.log('=============================================');
    console.log('');
    console.log('📡 Configuration:');
    console.log(`   IP Address: ${config.ip}`);
    console.log(`   Threshold: ${config.threshold}W`);
    console.log('');

    const baseUrl = `https://${config.ip}`;
    const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });

    // Step 1: Login
    console.log('🔐 Step 1: Authenticating...');
    const loginResponse = await fetch(`${baseUrl}/api/login/Basic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      dispatcher,
      body: JSON.stringify({
        username: 'customer', // Tesla Powerwall only supports 'customer' as username
        password: config.password,
      }),
    });

    if (!loginResponse.ok) {
      throw new Error(`Login failed: ${loginResponse.status} ${loginResponse.statusText}`);
    }

    // Extract cookies
    const cookiePairs = loginResponse.headers.getSetCookie();
    if (cookiePairs.length === 0) {
      throw new Error('No session cookie received from login');
    }
    const sessionCookie = cookiePairs.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
    console.log('✅ Authentication successful');
    console.log('');

    // Step 2: Get meters aggregates
    console.log('📊 Step 2: Reading power flow data...');
    const metersResponse = await fetch(`${baseUrl}/api/meters/aggregates`, {
      method: 'GET',
      headers: { Cookie: sessionCookie },
      dispatcher,
    });

    if (!metersResponse.ok) {
      throw new Error(`Failed to get meters: ${metersResponse.status} ${metersResponse.statusText}`);
    }

    const metersData = await metersResponse.json();
    console.log('✅ Power flow data retrieved');
    console.log('');

    // Step 3: Analyze grid power
    const sitePower = metersData.site?.instant_power || 0;
    const solarPower = metersData.solar?.instant_power || 0;
    const batteryPower = metersData.battery?.instant_power || 0;
    const loadPower = metersData.load?.instant_power || 0;

    console.log('⚡ Current Power Flow:');
    console.log(`   Grid (site): ${sitePower.toFixed(1)}W ${sitePower > 0 ? '(importing ⬇️)' : sitePower < 0 ? '(exporting ⬆️)' : '(idle)'}`);
    console.log(`   Solar: ${solarPower.toFixed(1)}W`);
    console.log(`   Battery: ${batteryPower.toFixed(1)}W ${batteryPower > 0 ? '(discharging)' : batteryPower < 0 ? '(charging)' : '(idle)'}`);
    console.log(`   Load (home): ${loadPower.toFixed(1)}W`);
    console.log('');

    // Step 4: Evaluate sensor states
    console.log('🎯 Grid Power Sensor States:');
    console.log('');

    // Exporting sensor (exporting to grid)
    const isExportingToGrid = sitePower < -config.threshold;
    console.log(`   📡 EXPORTING TO GRID Sensor:`);
    console.log(`      Current: ${sitePower.toFixed(1)}W`);
    console.log(`      Threshold: < -${config.threshold}W`);
    console.log(`      State: ${isExportingToGrid ? '✅ DETECTED (Contact Open)' : '⚪ NOT DETECTED (Contact Closed)'}`);
    if (isExportingToGrid) {
      console.log(`      💡 You are exporting ${Math.abs(sitePower).toFixed(1)}W to the grid!`);
    }
    console.log('');

    // Importing sensor (importing from grid)
    const isImportingFromGrid = sitePower > config.threshold;
    console.log(`   📡 IMPORTING FROM GRID Sensor:`);
    console.log(`      Current: ${sitePower.toFixed(1)}W`);
    console.log(`      Threshold: > ${config.threshold}W`);
    console.log(`      State: ${isImportingFromGrid ? '✅ DETECTED (Contact Open)' : '⚪ NOT DETECTED (Contact Closed)'}`);
    if (isImportingFromGrid) {
      console.log(`      💡 You are importing ${sitePower.toFixed(1)}W from the grid!`);
    }
    console.log('');

    // Step 5: Recommendations
    console.log('📋 Summary:');
    if (!isExportingToGrid && !isImportingFromGrid) {
      console.log('   ℹ️  Grid power is below threshold - sensors will not trigger');
      console.log('   ℹ️  This is normal when battery is meeting all loads');
    } else if (isExportingToGrid) {
      console.log('   ✅ Grid exporting sensor would trigger automations');
      console.log('   💡 Use this to know when you have excess power to use');
    } else if (isImportingFromGrid) {
      console.log('   ✅ Grid importing sensor would trigger automations');
      console.log('   💡 Use this to reduce consumption during peak times');
    }
    console.log('');

    console.log('✅ Validation complete!');
    console.log('');
    console.log('💡 Next Steps:');
    console.log('   1. Add these sensors to your HomeKit setup');
    console.log('   2. Create automations based on sensor states');
    console.log('   3. Adjust threshold if needed (current: ' + config.threshold + 'W)');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Validation failed:', error.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  - Verify your IP address is correct');
    console.error('  - Check that your password is correct');
    console.error('  - Ensure your Powerwall is accessible on the network');
    console.error('  - Try accessing https://' + config.ip + ' in a browser');
    console.error('');
    process.exit(1);
  }
}

// Run the validator
validateGridSensors();
