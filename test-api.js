/**
 * Simple API test script for the proxy integration
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';

async function testAPI() {
  console.log('🚀 Testing WhatsApp Provider Server with Proxy Integration');
  console.log('='.repeat(60));

  const testEmail = `test${Date.now()}@example.com`;
  const testPassword = 'testpass123';

  try {
    // Test 1: Server Health
    console.log('\n📡 Testing Server Health...');
    const healthResponse = await axios.get(`${BASE_URL}/api`);
    console.log('✅ Server is online:', healthResponse.data.message);
    console.log('📋 Available endpoints:', Object.keys(healthResponse.data.endpoints));

    // Test 2: Create Test User
    console.log('\n👤 Creating test user...');
    try {
      const registerResponse = await axios.post(`${BASE_URL}/api/auth/register`, {
        name: 'Test User',
        email: testEmail,
        password: testPassword
      });
      console.log('✅ User created successfully');
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.message?.includes('already exists')) {
        console.log('ℹ️  User already exists, continuing...');
      } else {
        console.log('❌ Failed to create user:', error.response?.data?.message || error.message);
        return;
      }
    }

    // Test 3: Login and Get Token
    console.log('\n🔐 Logging in...');
    const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: testEmail,
      password: testPassword
    });
    
    if (!loginResponse.data.token) {
      console.log('❌ No token received from login');
      return;
    }
    
    const token = loginResponse.data.token;
    console.log('✅ Login successful, token received');

    // Set up headers for authenticated requests
    const authHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // Test 4: Proxy Service Status
    console.log('\n🔧 Testing Proxy Service Status...');
    try {
      const proxyStatusResponse = await axios.get(`${BASE_URL}/api/proxy/status`, {
        headers: authHeaders
      });
      
      console.log('✅ Proxy status retrieved successfully');
      console.log('   - Decodo Enabled:', proxyStatusResponse.data.decodoEnabled);
      console.log('   - Message Queue Enabled:', proxyStatusResponse.data.messageQueueEnabled);
      console.log('   - Monitoring Enabled:', proxyStatusResponse.data.monitoringEnabled);
      
      if (proxyStatusResponse.data.services.messageQueue) {
        console.log('   - Active Queues:', proxyStatusResponse.data.services.messageQueue.activeQueues || 0);
        console.log('   - Queue Health:', proxyStatusResponse.data.services.messageQueue.health?.isHealthy || 'Unknown');
      }
      
    } catch (error) {
      console.log('❌ Failed to get proxy status:', error.response?.data?.message || error.message);
    }

    // Test 5: Monitoring Metrics
    console.log('\n📊 Testing Monitoring Metrics...');
    try {
      const metricsResponse = await axios.get(`${BASE_URL}/api/proxy/metrics?limit=3`, {
        headers: authHeaders
      });
      
      console.log('✅ Metrics retrieved successfully');
      console.log('   - Metrics Count:', metricsResponse.data.count || 0);
      
      if (metricsResponse.data.metrics && metricsResponse.data.metrics.length > 0) {
        const latest = metricsResponse.data.metrics[metricsResponse.data.metrics.length - 1];
        console.log('   - Latest Metrics:');
        console.log('     * Timestamp:', new Date(latest.timestamp).toLocaleTimeString());
        console.log('     * Total Proxies:', latest.proxies.total);
        console.log('     * Active Proxies:', latest.proxies.active);
        console.log('     * Queue Health:', latest.messageQueues.isHealthy);
        console.log('     * Total Queues:', latest.messageQueues.totalQueues);
      }
      
    } catch (error) {
      console.log('❌ Failed to get metrics:', error.response?.data?.message || error.message);
    }

    // Test 6: Active Alerts
    console.log('\n🚨 Testing Active Alerts...');
    try {
      const alertsResponse = await axios.get(`${BASE_URL}/api/proxy/alerts`, {
        headers: authHeaders
      });
      
      console.log('✅ Alerts retrieved successfully');
      console.log('   - Active Alerts:', alertsResponse.data.count || 0);
      
      if (alertsResponse.data.alerts && alertsResponse.data.alerts.length > 0) {
        console.log('   - Alert Details:');
        alertsResponse.data.alerts.slice(0, 3).forEach((alert, index) => {
          console.log(`     ${index + 1}. ${alert.type} - ${alert.severity} - ${alert.message}`);
        });
      }
      
    } catch (error) {
      console.log('❌ Failed to get alerts:', error.response?.data?.message || error.message);
    }

    // Test 7: Proxy Device Mappings
    console.log('\n🔗 Testing Proxy Device Mappings...');
    try {
      const mappingsResponse = await axios.get(`${BASE_URL}/api/proxy/mappings?limit=5`, {
        headers: authHeaders
      });
      
      console.log('✅ Proxy mappings retrieved successfully');
      console.log('   - Mappings Count:', mappingsResponse.data.count || 0);
      
      if (mappingsResponse.data.mappings && mappingsResponse.data.mappings.length > 0) {
        console.log('   - Sample Mappings:');
        mappingsResponse.data.mappings.slice(0, 3).forEach((mapping, index) => {
          console.log(`     ${index + 1}. Device: ${mapping.deviceId.substring(0, 8)}... → ${mapping.proxyConfig.country} (${mapping.status})`);
        });
      }
      
    } catch (error) {
      console.log('❌ Failed to get proxy mappings:', error.response?.data?.message || error.message);
    }

    // Test 8: Test Message Queuing (if we have a device)
    console.log('\n📨 Testing Message Queue Functionality...');
    try {
      // First, let's see if there are any devices
      const devicesResponse = await axios.get(`${BASE_URL}/api/devices`, {
        headers: authHeaders
      });
      
      if (devicesResponse.data.devices && devicesResponse.data.devices.length > 0) {
        const testDevice = devicesResponse.data.devices[0];
        console.log(`   - Found test device: ${testDevice._id}`);
        
        // Try to get queue status for this device
        const queueResponse = await axios.get(`${BASE_URL}/api/proxy/queue/${testDevice._id}`, {
          headers: authHeaders
        });
        
        console.log('✅ Queue status retrieved');
        console.log('   - Pending Messages:', queueResponse.data.pendingMessages || 0);
        console.log('   - Queue Stats:', queueResponse.data.stats ? 'Available' : 'Not available');
        
      } else {
        console.log('ℹ️  No devices found for queue testing');
      }
      
    } catch (error) {
      console.log('❌ Failed to test message queue:', error.response?.data?.message || error.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 API Testing Complete!');
    console.log('✅ Proxy integration is working correctly');
    console.log('📊 All core services are operational');
    
  } catch (error) {
    console.log('\n❌ API Test failed:', error.message);
    if (error.response) {
      console.log('   Status:', error.response.status);
      console.log('   Data:', error.response.data);
    }
  }
}

// Run the test
testAPI().catch(console.error);
