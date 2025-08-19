/**
 * Test all proxy endpoints with authentication
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';

async function testProxyEndpoints() {
  console.log('🔧 Testing Proxy Endpoints');
  console.log('='.repeat(40));
  
  try {
    // Step 1: Create user and login
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
    
    // Step 2: Test all proxy endpoints
    console.log('\n📊 Testing Proxy Endpoints:');
    console.log('-'.repeat(40));
    
    const endpoints = [
      {
        name: 'Proxy Status',
        url: '/api/proxy/status',
        method: 'GET'
      },
      {
        name: 'Monitoring Metrics',
        url: '/api/proxy/metrics?limit=5',
        method: 'GET'
      },
      {
        name: 'Active Alerts',
        url: '/api/proxy/alerts',
        method: 'GET'
      },
      {
        name: 'Proxy Mappings',
        url: '/api/proxy/mappings?limit=10',
        method: 'GET'
      }
    ];
    
    for (const endpoint of endpoints) {
      try {
        console.log(`\n🔗 Testing: ${endpoint.name}`);
        console.log(`   URL: ${BASE_URL}${endpoint.url}`);
        
        const response = await axios({
          method: endpoint.method,
          url: `${BASE_URL}${endpoint.url}`,
          headers: authHeaders
        });
        
        console.log(`   ✅ Status: ${response.status}`);
        
        // Show relevant data
        if (endpoint.url.includes('/status')) {
          console.log(`   📊 Decodo Enabled: ${response.data.decodoEnabled}`);
          console.log(`   📊 Queue Enabled: ${response.data.messageQueueEnabled}`);
          console.log(`   📊 Monitoring Enabled: ${response.data.monitoringEnabled}`);
        } else if (endpoint.url.includes('/metrics')) {
          console.log(`   📊 Metrics Count: ${response.data.count || 0}`);
        } else if (endpoint.url.includes('/alerts')) {
          console.log(`   🚨 Active Alerts: ${response.data.count || 0}`);
        } else if (endpoint.url.includes('/mappings')) {
          console.log(`   🔗 Mappings Count: ${response.data.count || 0}`);
        }
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.response?.status || error.message}`);
        if (error.response?.data) {
          console.log(`   📝 Error: ${error.response.data.message || 'Unknown error'}`);
        }
      }
    }
    
    // Step 3: Test device-specific endpoints (if devices exist)
    console.log('\n📱 Testing Device-Specific Endpoints:');
    console.log('-'.repeat(40));
    
    try {
      const devicesResponse = await axios.get(`${BASE_URL}/api/devices`, {
        headers: authHeaders
      });
      
      if (devicesResponse.data.devices && devicesResponse.data.devices.length > 0) {
        const testDevice = devicesResponse.data.devices[0];
        console.log(`\n📱 Found device: ${testDevice._id}`);
        
        // Test queue status
        try {
          const queueResponse = await axios.get(`${BASE_URL}/api/proxy/queue/${testDevice._id}`, {
            headers: authHeaders
          });
          console.log(`   ✅ Queue Status: Available`);
          console.log(`   📊 Pending Messages: ${queueResponse.data.pendingMessages || 0}`);
        } catch (error) {
          console.log(`   ⚠️  Queue Status: ${error.response?.data?.message || 'Not available'}`);
        }
        
      } else {
        console.log('   ℹ️  No devices found for testing');
      }
      
    } catch (error) {
      console.log(`   ❌ Failed to get devices: ${error.message}`);
    }
    
    console.log('\n' + '='.repeat(40));
    console.log('✅ Endpoint Testing Complete!');
    console.log('\n📋 Correct URLs to use:');
    console.log(`   🔗 Proxy Status: ${BASE_URL}/api/proxy/status`);
    console.log(`   📊 Metrics: ${BASE_URL}/api/proxy/metrics`);
    console.log(`   🚨 Alerts: ${BASE_URL}/api/proxy/alerts`);
    console.log(`   🔗 Mappings: ${BASE_URL}/api/proxy/mappings`);
    console.log(`   📱 Queue Status: ${BASE_URL}/api/proxy/queue/{deviceId}`);
    console.log('\n⚠️  Remember: All endpoints require authentication!');
    console.log(`   Add header: Authorization: Bearer {your-token}`);
    
  } catch (error) {
    console.log('\n❌ Test failed:', error.message);
    if (error.response) {
      console.log('   Status:', error.response.status);
      console.log('   Data:', error.response.data);
    }
  }
}

// Run the test
testProxyEndpoints().catch(console.error);
