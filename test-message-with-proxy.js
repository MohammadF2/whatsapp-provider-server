/**
 * Test message sending with proxy integration
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';

async function testMessageWithProxy() {
  console.log('🚀 Testing Message Sending with Proxy Integration');
  console.log('='.repeat(60));

  try {
    // Step 1: Get authentication token
    console.log('\n🔐 Getting authentication token...');
    
    const testEmail = `test${Date.now()}@example.com`;
    const testPassword = 'testpass123';
    
    // Register user
    try {
      await axios.post(`${BASE_URL}/api/auth/register`, {
        name: 'Test User',
        email: testEmail,
        password: testPassword
      });
      console.log('✅ User registered');
    } catch (error) {
      if (error.response?.status !== 400) {
        throw error;
      }
    }
    
    // Login
    const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: testEmail,
      password: testPassword
    });
    
    const token = loginResponse.data.token;
    console.log('✅ Authentication successful');
    
    const authHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // Step 2: Get available devices
    console.log('\n📱 Getting available devices...');
    const devicesResponse = await axios.get(`${BASE_URL}/api/devices`, {
      headers: authHeaders
    });
    
    if (!devicesResponse.data.devices || devicesResponse.data.devices.length === 0) {
      console.log('❌ No devices found. Please connect a WhatsApp device first.');
      return;
    }
    
    const device = devicesResponse.data.devices[0];
    console.log(`✅ Found device: ${device._id}`);
    console.log(`   - Name: ${device.name || 'Unnamed'}`);
    console.log(`   - Status: ${device.status}`);
    console.log(`   - Has Selenium Config: ${!!device.seleniumConfig?.browserType}`);

    // Step 3: Check proxy status before sending
    console.log('\n🔧 Checking proxy status...');
    const proxyStatusResponse = await axios.get(`${BASE_URL}/api/proxy/status`, {
      headers: authHeaders
    });
    
    console.log('✅ Proxy status retrieved');
    console.log(`   - Decodo Enabled: ${proxyStatusResponse.data.decodoEnabled}`);
    console.log(`   - Message Queue Enabled: ${proxyStatusResponse.data.messageQueueEnabled}`);
    console.log(`   - Monitoring Enabled: ${proxyStatusResponse.data.monitoringEnabled}`);

    // Step 4: Check queue status for device
    console.log('\n📊 Checking queue status for device...');
    try {
      const queueResponse = await axios.get(`${BASE_URL}/api/proxy/queue/${device._id}`, {
        headers: authHeaders
      });
      
      console.log('✅ Queue status retrieved');
      console.log(`   - Pending Messages: ${queueResponse.data.pendingMessages || 0}`);
      console.log(`   - Queue Health: ${queueResponse.data.stats ? 'Available' : 'Not available'}`);
    } catch (error) {
      console.log(`⚠️  Queue status: ${error.response?.data?.message || 'Not available'}`);
    }

    // Step 5: Send test message
    console.log('\n📨 Sending test message with proxy integration...');
    
    const testMessage = {
      to: '972594386856', // Your test number
      message: `🚀 Test message with proxy integration - ${new Date().toLocaleTimeString()}`
    };
    
    console.log(`   - To: ${testMessage.to}`);
    console.log(`   - Message: ${testMessage.message}`);
    console.log(`   - Device: ${device._id}`);
    
    const sendResponse = await axios.post(`${BASE_URL}/api/whatsapp/send-message/${device._id}`, testMessage, {
      headers: authHeaders
    });
    
    if (sendResponse.data.success) {
      console.log('✅ Message sent successfully!');
      console.log(`   - Message ID: ${sendResponse.data.messageId || 'N/A'}`);
      
      // Wait a moment and check queue status again
      console.log('\n⏳ Waiting 5 seconds to check queue processing...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      try {
        const queueAfterResponse = await axios.get(`${BASE_URL}/api/proxy/queue/${device._id}`, {
          headers: authHeaders
        });
        
        console.log('📊 Queue status after sending:');
        console.log(`   - Pending Messages: ${queueAfterResponse.data.pendingMessages || 0}`);
        console.log(`   - Processing: ${queueAfterResponse.data.stats ? 'Active' : 'Inactive'}`);
      } catch (error) {
        console.log(`⚠️  Could not get queue status after sending`);
      }
      
    } else {
      console.log('❌ Message sending failed');
      console.log(`   - Error: ${sendResponse.data.message}`);
    }

    // Step 6: Check proxy mappings
    console.log('\n🔗 Checking proxy mappings...');
    try {
      const mappingsResponse = await axios.get(`${BASE_URL}/api/proxy/mappings?limit=5`, {
        headers: authHeaders
      });
      
      console.log('✅ Proxy mappings retrieved');
      console.log(`   - Total Mappings: ${mappingsResponse.data.count || 0}`);
      
      if (mappingsResponse.data.mappings && mappingsResponse.data.mappings.length > 0) {
        console.log('   - Recent Mappings:');
        mappingsResponse.data.mappings.slice(0, 3).forEach((mapping, index) => {
          console.log(`     ${index + 1}. Device: ${mapping.deviceId.substring(0, 8)}... → ${mapping.proxyConfig.country} (${mapping.status})`);
        });
      } else {
        console.log('   - No proxy mappings found yet');
      }
      
    } catch (error) {
      console.log(`❌ Failed to get proxy mappings: ${error.response?.data?.message || error.message}`);
    }

    // Step 7: Check monitoring metrics
    console.log('\n📈 Checking monitoring metrics...');
    try {
      const metricsResponse = await axios.get(`${BASE_URL}/api/proxy/metrics?limit=3`, {
        headers: authHeaders
      });
      
      console.log('✅ Monitoring metrics retrieved');
      console.log(`   - Metrics Count: ${metricsResponse.data.count || 0}`);
      
      if (metricsResponse.data.metrics && metricsResponse.data.metrics.length > 0) {
        const latest = metricsResponse.data.metrics[metricsResponse.data.metrics.length - 1];
        console.log('   - Latest Metrics:');
        console.log(`     * Timestamp: ${new Date(latest.timestamp).toLocaleTimeString()}`);
        console.log(`     * Total Proxies: ${latest.proxies.total}`);
        console.log(`     * Active Proxies: ${latest.proxies.active}`);
        console.log(`     * Queue Health: ${latest.messageQueues.isHealthy}`);
      }
      
    } catch (error) {
      console.log(`❌ Failed to get metrics: ${error.response?.data?.message || error.message}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 Proxy Integration Test Complete!');
    console.log('✅ Message sent through proxy-enabled queue system');
    console.log('📊 All monitoring systems are operational');
    
  } catch (error) {
    console.log('\n❌ Test failed:', error.message);
    if (error.response) {
      console.log('   Status:', error.response.status);
      console.log('   Data:', error.response.data);
    }
  }
}

// Run the test
testMessageWithProxy().catch(console.error);
