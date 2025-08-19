/**
 * Test Decodo proxy connection directly
 */

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Your Decodo credentials
const DECODO_CONFIG = {
  endpoint: 'gate.decodo.com',
  port: 10001,
  username: 'sp0ono9c6u',
  password: 'lD0vp~1ysosM1Vp2yD'
};

async function testDecodoConnection() {
  console.log('🔧 Testing Decodo Proxy Connection');
  console.log('='.repeat(50));
  
  try {
    // Create proxy URL
    const proxyUrl = `http://${DECODO_CONFIG.username}:${DECODO_CONFIG.password}@${DECODO_CONFIG.endpoint}:${DECODO_CONFIG.port}`;
    console.log(`📡 Proxy URL: http://${DECODO_CONFIG.username}:***@${DECODO_CONFIG.endpoint}:${DECODO_CONFIG.port}`);
    
    // Create proxy agent
    const proxyAgent = new HttpsProxyAgent(proxyUrl);
    
    // Test 1: Basic IP check
    console.log('\n🌐 Testing basic IP check...');
    const startTime = Date.now();
    
    try {
      const response = await axios.get('https://httpbin.org/ip', {
        httpsAgent: proxyAgent,
        timeout: 30000,
        headers: {
          'User-Agent': 'WhatsApp-Provider-Server/1.0.0'
        }
      });
      
      const responseTime = Date.now() - startTime;
      console.log('✅ Proxy connection successful!');
      console.log(`   - Response time: ${responseTime}ms`);
      console.log(`   - Proxy IP: ${response.data.origin}`);
      
    } catch (error) {
      console.log('❌ Proxy connection failed:', error.message);
      if (error.code) {
        console.log(`   - Error code: ${error.code}`);
      }
      if (error.response) {
        console.log(`   - HTTP status: ${error.response.status}`);
      }
      return false;
    }
    
    // Test 2: Check geolocation
    console.log('\n🌍 Testing geolocation...');
    try {
      const geoResponse = await axios.get('https://httpbin.org/headers', {
        httpsAgent: proxyAgent,
        timeout: 30000
      });
      
      console.log('✅ Geolocation test successful');
      console.log('   - Headers received from proxy');
      
    } catch (error) {
      console.log('⚠️  Geolocation test failed:', error.message);
    }
    
    // Test 3: Multiple requests to test stability
    console.log('\n🔄 Testing connection stability (5 requests)...');
    let successCount = 0;
    let totalTime = 0;
    
    for (let i = 1; i <= 5; i++) {
      try {
        const reqStart = Date.now();
        await axios.get('https://httpbin.org/uuid', {
          httpsAgent: proxyAgent,
          timeout: 15000
        });
        const reqTime = Date.now() - reqStart;
        totalTime += reqTime;
        successCount++;
        console.log(`   ✅ Request ${i}: ${reqTime}ms`);
      } catch (error) {
        console.log(`   ❌ Request ${i}: Failed (${error.message})`);
      }
    }
    
    const avgTime = successCount > 0 ? Math.round(totalTime / successCount) : 0;
    const successRate = (successCount / 5) * 100;
    
    console.log(`\n📊 Stability Results:`);
    console.log(`   - Success rate: ${successRate}%`);
    console.log(`   - Average response time: ${avgTime}ms`);
    console.log(`   - Successful requests: ${successCount}/5`);
    
    if (successRate >= 80) {
      console.log('\n🎉 Decodo proxy is working excellently!');
      console.log('✅ Ready for WhatsApp integration');
      return true;
    } else if (successRate >= 60) {
      console.log('\n⚠️  Decodo proxy is working but with some issues');
      console.log('🔧 May need optimization for production use');
      return true;
    } else {
      console.log('\n❌ Decodo proxy has significant issues');
      console.log('🔧 Please check credentials and network connectivity');
      return false;
    }
    
  } catch (error) {
    console.log('\n❌ Test failed:', error.message);
    return false;
  }
}

// Test different proxy endpoints
async function testProxyEndpoints() {
  console.log('\n🔍 Testing different proxy configurations...');
  
  const configs = [
    { name: 'HTTP Proxy', protocol: 'http' },
    { name: 'HTTPS Proxy', protocol: 'https' }
  ];
  
  for (const config of configs) {
    console.log(`\n📡 Testing ${config.name}...`);
    try {
      const proxyUrl = `${config.protocol}://${DECODO_CONFIG.username}:${DECODO_CONFIG.password}@${DECODO_CONFIG.endpoint}:${DECODO_CONFIG.port}`;
      const proxyAgent = new HttpsProxyAgent(proxyUrl);
      
      const response = await axios.get('https://httpbin.org/ip', {
        httpsAgent: proxyAgent,
        timeout: 15000
      });
      
      console.log(`   ✅ ${config.name} working - IP: ${response.data.origin}`);
    } catch (error) {
      console.log(`   ❌ ${config.name} failed: ${error.message}`);
    }
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Decodo Proxy Connection Test');
  console.log('================================');
  
  const basicTest = await testDecodoConnection();
  
  if (basicTest) {
    await testProxyEndpoints();
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('🏁 Test Complete');
  
  if (basicTest) {
    console.log('✅ Your Decodo proxy credentials are working!');
    console.log('🚀 Ready to use with WhatsApp Provider Server');
  } else {
    console.log('❌ Proxy connection issues detected');
    console.log('🔧 Please verify:');
    console.log('   - Credentials are correct');
    console.log('   - Network connectivity');
    console.log('   - Decodo service status');
  }
}

// Run the tests
runTests().catch(console.error);
