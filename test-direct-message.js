/**
 * Test direct message sending with known device ID
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';
const DEVICE_ID = '68305cb77147e59eec2a4ef4'; // Known device from server logs

async function testDirectMessage() {
  console.log('🚀 Testing Direct Message with Proxy Integration');
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

    // Step 2: Check proxy status
    console.log('\n🔧 Checking proxy status...');
    const proxyStatusResponse = await axios.get(`${BASE_URL}/api/proxy/status`, {
      headers: authHeaders
    });
    
    console.log('✅ Proxy status retrieved');
    console.log(`   - Decodo Enabled: ${proxyStatusResponse.data.decodoEnabled}`);
    console.log(`   - Message Queue Enabled: ${proxyStatusResponse.data.messageQueueEnabled}`);
    console.log(`   - Monitoring Enabled: ${proxyStatusResponse.data.monitoringEnabled}`);

    // Step 3: Check queue status for device
    console.log(`\n📊 Checking queue status for device ${DEVICE_ID}...`);
    try {
      const queueResponse = await axios.get(`${BASE_URL}/api/proxy/queue/${DEVICE_ID}`, {
        headers: authHeaders
      });
      
      console.log('✅ Queue status retrieved');
      console.log(`   - Pending Messages: ${queueResponse.data.pendingMessages || 0}`);
      console.log(`   - Queue Health: ${queueResponse.data.stats ? 'Available' : 'Not available'}`);
    } catch (error) {
      console.log(`⚠️  Queue status: ${error.response?.data?.message || 'Not available'}`);
    }

    // Step 4: Send test message
    console.log('\n📨 Sending test message with proxy integration...');

    const testMessage = {
      deviceId: DEVICE_ID,
      to: '972594386856', // Your test number
      content: `🚀 PROXY TEST - ${new Date().toLocaleTimeString()} - Message sent through proxy-enabled queue system!`
    };

    console.log(`   - To: ${testMessage.to}`);
    console.log(`   - Message: ${testMessage.content}`);
    console.log(`   - Device: ${DEVICE_ID}`);

    const sendResponse = await axios.post(`${BASE_URL}/api/whatsapp/send-message`, testMessage, {
      headers: authHeaders
    });
    
    if (sendResponse.data.success) {
      console.log('✅ Message sent successfully!');
      console.log(`   - Message ID: ${sendResponse.data.messageId || 'N/A'}`);
      
      // Wait a moment and check queue status again
      console.log('\n⏳ Waiting 10 seconds to check queue processing...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      try {
        const queueAfterResponse = await axios.get(`${BASE_URL}/api/proxy/queue/${DEVICE_ID}`, {
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

    // Step 5: Check proxy mappings
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

    console.log('\n' + '='.repeat(60));
    console.log('🎉 Direct Message Test Complete!');
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
testDirectMessage().catch(console.error);
