/**
 * Test script for Decodo Proxy Integration
 * 
 * This script tests the proxy integration without requiring a full server setup.
 * Run with: node test-proxy-integration.js
 */

const axios = require('axios');

// Test configuration
const TEST_CONFIG = {
  serverUrl: 'http://localhost:3000',
  testDeviceId: 'test-device-123',
  testPhoneNumber: '+1234567890',
  testMessage: 'Hello from proxy integration test!',
  authToken: null, // Will be set after login
};

// Test credentials (update these with your actual test credentials)
const TEST_CREDENTIALS = {
  username: 'testuser',
  password: 'testpass123',
};

/**
 * Helper function to make authenticated API requests
 */
async function apiRequest(method, endpoint, data = null) {
  const config = {
    method,
    url: `${TEST_CONFIG.serverUrl}${endpoint}`,
    headers: {},
  };

  if (TEST_CONFIG.authToken) {
    config.headers.Authorization = `Bearer ${TEST_CONFIG.authToken}`;
  }

  if (data) {
    config.data = data;
    config.headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status,
    };
  }
}

/**
 * Test authentication
 */
async function testAuthentication() {
  console.log('\n🔐 Testing Authentication...');
  
  const result = await apiRequest('POST', '/api/auth/login', TEST_CREDENTIALS);
  
  if (result.success && result.data.token) {
    TEST_CONFIG.authToken = result.data.token;
    console.log('✅ Authentication successful');
    return true;
  } else {
    console.log('❌ Authentication failed:', result.error);
    return false;
  }
}

/**
 * Test proxy service status
 */
async function testProxyStatus() {
  console.log('\n📊 Testing Proxy Service Status...');
  
  const result = await apiRequest('GET', '/api/proxy/status');
  
  if (result.success) {
    console.log('✅ Proxy status retrieved successfully');
    console.log('   - Decodo Enabled:', result.data.decodoEnabled);
    console.log('   - Message Queue Enabled:', result.data.messageQueueEnabled);
    console.log('   - Monitoring Enabled:', result.data.monitoringEnabled);
    
    if (result.data.services.proxy) {
      console.log('   - Cached Proxies:', result.data.services.proxy.cachedProxies || 0);
    }
    
    if (result.data.services.messageQueue) {
      console.log('   - Active Queues:', result.data.services.messageQueue.activeQueues || 0);
    }
    
    return true;
  } else {
    console.log('❌ Failed to get proxy status:', result.error);
    return false;
  }
}

/**
 * Test message queue functionality
 */
async function testMessageQueue() {
  console.log('\n📨 Testing Message Queue...');
  
  // Test sending a queued message
  const sendResult = await apiRequest('POST', '/api/whatsapp/send-message', {
    deviceId: TEST_CONFIG.testDeviceId,
    to: TEST_CONFIG.testPhoneNumber,
    message: TEST_CONFIG.testMessage,
  });
  
  if (sendResult.success) {
    console.log('✅ Message queued successfully');
    
    // Wait a moment then check queue status
    setTimeout(async () => {
      const queueResult = await apiRequest('GET', `/api/proxy/queue/${TEST_CONFIG.testDeviceId}`);
      
      if (queueResult.success) {
        console.log('✅ Queue status retrieved');
        console.log('   - Pending Messages:', queueResult.data.pendingMessages || 0);
        console.log('   - Stats:', queueResult.data.stats);
      } else {
        console.log('⚠️  Queue status not available (queue may not exist yet)');
      }
    }, 1000);
    
    return true;
  } else {
    console.log('❌ Failed to queue message:', sendResult.error);
    return false;
  }
}

/**
 * Test monitoring metrics
 */
async function testMonitoring() {
  console.log('\n📈 Testing Monitoring...');
  
  // Test metrics endpoint
  const metricsResult = await apiRequest('GET', '/api/proxy/metrics?limit=5');
  
  if (metricsResult.success) {
    console.log('✅ Metrics retrieved successfully');
    console.log('   - Metrics Count:', metricsResult.data.count || 0);
    
    if (metricsResult.data.metrics && metricsResult.data.metrics.length > 0) {
      const latest = metricsResult.data.metrics[metricsResult.data.metrics.length - 1];
      console.log('   - Latest Metrics:');
      console.log('     * Proxies Total:', latest.proxies.total);
      console.log('     * Proxies Active:', latest.proxies.active);
      console.log('     * Queue Health:', latest.messageQueues.isHealthy);
    }
  } else {
    console.log('⚠️  Monitoring not available:', result.error);
  }
  
  // Test alerts endpoint
  const alertsResult = await apiRequest('GET', '/api/proxy/alerts');
  
  if (alertsResult.success) {
    console.log('✅ Alerts retrieved successfully');
    console.log('   - Active Alerts:', alertsResult.data.count || 0);
    
    if (alertsResult.data.alerts && alertsResult.data.alerts.length > 0) {
      console.log('   - Alert Types:', alertsResult.data.alerts.map(a => a.type).join(', '));
    }
  } else {
    console.log('⚠️  Alerts not available:', alertsResult.error);
  }
  
  return true;
}

/**
 * Test proxy device mappings
 */
async function testProxyMappings() {
  console.log('\n🔗 Testing Proxy Mappings...');
  
  const result = await apiRequest('GET', '/api/proxy/mappings?limit=10');
  
  if (result.success) {
    console.log('✅ Proxy mappings retrieved successfully');
    console.log('   - Mappings Count:', result.data.count || 0);
    
    if (result.data.mappings && result.data.mappings.length > 0) {
      const mapping = result.data.mappings[0];
      console.log('   - Sample Mapping:');
      console.log('     * Device ID:', mapping.deviceId);
      console.log('     * Proxy Country:', mapping.proxyConfig.country);
      console.log('     * Status:', mapping.status);
      console.log('     * Success Rate:', (mapping.healthMetrics.successRate * 100).toFixed(2) + '%');
    }
    
    return true;
  } else {
    console.log('❌ Failed to get proxy mappings:', result.error);
    return false;
  }
}

/**
 * Test server connectivity
 */
async function testServerConnectivity() {
  console.log('\n🌐 Testing Server Connectivity...');
  
  try {
    const response = await axios.get(`${TEST_CONFIG.serverUrl}/api/health`);
    console.log('✅ Server is reachable');
    return true;
  } catch (error) {
    // Try the root endpoint
    try {
      const response = await axios.get(TEST_CONFIG.serverUrl);
      console.log('✅ Server is reachable (root endpoint)');
      return true;
    } catch (rootError) {
      console.log('❌ Server is not reachable:', error.message);
      console.log('   Make sure the server is running on', TEST_CONFIG.serverUrl);
      return false;
    }
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('🚀 Starting Decodo Proxy Integration Tests');
  console.log('==========================================');
  
  const tests = [
    { name: 'Server Connectivity', fn: testServerConnectivity },
    { name: 'Authentication', fn: testAuthentication },
    { name: 'Proxy Status', fn: testProxyStatus },
    { name: 'Message Queue', fn: testMessageQueue },
    { name: 'Monitoring', fn: testMonitoring },
    { name: 'Proxy Mappings', fn: testProxyMappings },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.log(`❌ Test "${test.name}" threw an error:`, error.message);
      failed++;
    }
  }
  
  console.log('\n==========================================');
  console.log('🏁 Test Results Summary');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! Proxy integration is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Check the logs above for details.');
    console.log('   Common issues:');
    console.log('   - Server not running');
    console.log('   - Invalid credentials');
    console.log('   - Proxy services not configured');
    console.log('   - Database connection issues');
  }
  
  process.exit(failed === 0 ? 0 : 1);
}

// Handle command line arguments
if (process.argv.length > 2) {
  const serverUrl = process.argv[2];
  if (serverUrl.startsWith('http')) {
    TEST_CONFIG.serverUrl = serverUrl;
    console.log('Using custom server URL:', serverUrl);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('❌ Test runner failed:', error);
  process.exit(1);
});
