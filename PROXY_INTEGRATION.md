# Decodo Mobile Proxy Integration

This document describes the integration of Decodo's mobile proxy service with the WhatsApp provider server application.

## Overview

The integration provides:
- **Proxy Selection Logic**: Automatic proxy assignment based on device location
- **Message Queue System**: Rate-limited message processing per device
- **Monitoring & Health Checks**: Real-time proxy and queue monitoring
- **Persistent Proxy Mapping**: Consistent proxy assignment across restarts

## Features

### 1. Proxy Selection Logic

- **Israel/Palestine Region**: Devices with mobile numbers from IL/PS use Israeli mobile proxies
- **Other Countries**: Devices use mobile proxies matching their country of origin
- **Proxy Consistency**: Once assigned, devices maintain the same proxy to avoid detection
- **Automatic Failover**: Failed proxies are automatically replaced

### 2. Message Queue Implementation

- **Per-Device Queues**: Separate message queue for each WhatsApp device/session
- **Rate Limiting**: Configurable messages per minute (default: 20/min)
- **Human-like Delays**: 3-second delays between messages to mimic human behavior
- **Priority Support**: High, normal, and low priority message handling
- **Retry Logic**: Automatic retry with exponential backoff for failed messages

### 3. Monitoring & Alerts

- **Real-time Metrics**: Proxy performance, queue health, success rates
- **Health Checks**: Automatic proxy testing and health monitoring
- **Alert System**: Configurable alerts for error rates, response times, queue sizes
- **Performance Tracking**: Response times, success rates, failure counts

## Configuration

### Environment Variables

Add these variables to your `.env` file:

```env
# Decodo Mobile Proxy Configuration
DECODO_ENABLED=true
DECODO_USERNAME=your-decodo-username
DECODO_PASSWORD=your-decodo-password
DECODO_ENDPOINT=gate.decodo.com
DECODO_PORT=10000
DECODO_CONNECTION_TIMEOUT=30000
DECODO_REQUEST_TIMEOUT=60000
DECODO_MAX_RETRIES=3
DECODO_RETRY_DELAY=2000
DECODO_HEALTH_CHECK_INTERVAL=300000
DECODO_HEALTH_CHECK_TIMEOUT=10000
DECODO_ENABLE_LOGGING=true

# Message Queue Configuration
MESSAGE_QUEUE_ENABLED=true
MESSAGE_QUEUE_MAX_SIZE=1000
MESSAGE_QUEUE_RATE_LIMIT=20
MESSAGE_QUEUE_DELAY=3000
MESSAGE_QUEUE_MAX_RETRIES=3
MESSAGE_QUEUE_RETRY_MULTIPLIER=2
MESSAGE_QUEUE_MAX_RETRY_DELAY=60000
MESSAGE_QUEUE_PROCESSING_INTERVAL=1000
MESSAGE_QUEUE_ENABLE_LOGGING=true

# Monitoring Configuration
MONITORING_ENABLED=true
MONITORING_METRICS_INTERVAL=60000
MONITORING_HEALTH_CHECK_INTERVAL=300000
MONITORING_ERROR_RATE_THRESHOLD=0.1
MONITORING_RESPONSE_TIME_THRESHOLD=5000
MONITORING_QUEUE_SIZE_THRESHOLD=100
```

## API Endpoints

**Base URL**: `http://localhost:3001`

**Authentication Required**: All proxy endpoints require JWT authentication.
Add header: `Authorization: Bearer {your-token}`

### Proxy Status
```
GET /api/proxy/status
```
Returns the status of all proxy services.

**Example Response:**
```json
{
  "decodoEnabled": true,
  "messageQueueEnabled": true,
  "monitoringEnabled": true,
  "services": {
    "messageQueue": {
      "activeQueues": 0,
      "health": { "isHealthy": true }
    }
  }
}
```

### Monitoring Metrics
```
GET /api/proxy/metrics?limit=100
```
Returns historical monitoring metrics.

### Active Alerts
```
GET /api/proxy/alerts
```
Returns active monitoring alerts.

### Resolve Alert
```
POST /api/proxy/alerts/{alertId}/resolve
```
Resolves a specific alert.

### Proxy Device Mappings
```
GET /api/proxy/mappings?deviceId=xxx&status=active
```
Returns proxy-device mappings.

### Queue Status
```
GET /api/proxy/queue/{deviceId}
```
Returns queue status for a specific device.

### Clear Queue
```
POST /api/proxy/queue/{deviceId}/clear
```
Clears the message queue for a device.

## Usage

### Sending Messages (Recommended)

Use the new queued message sending for better rate limiting:

```javascript
// Send message through queue (recommended)
const result = await sendMessageQueued(deviceId, phoneNumber, message, {
  priority: 'normal',
  type: 'text',
  maxAttempts: 3,
  metadata: { source: 'api' }
});
```

### Direct Message Sending

For immediate sending (bypasses queue):

```javascript
// Direct sending (use sparingly)
const result = await sendMessage(deviceId, phoneNumber, message);
```

## Database Models

### ProxyDeviceMapping

Stores persistent proxy-device mappings:

```javascript
{
  deviceId: String,
  proxyId: String,
  proxyConfig: {
    country: String,
    city: String,
    carrier: String,
    networkType: '3G' | '4G' | '5G',
    endpoint: String,
    port: Number
  },
  status: 'active' | 'inactive' | 'failed',
  healthMetrics: {
    responseTime: Number,
    successRate: Number,
    lastSuccessfulConnection: Date,
    lastFailedConnection: Date,
    totalRequests: Number,
    successfulRequests: Number,
    failedRequests: Number
  },
  assignedAt: Date,
  lastUsed: Date,
  failureCount: Number,
  maxFailures: Number
}
```

## Services Architecture

### DecodoProxyService
- Manages proxy selection and assignment
- Handles proxy health monitoring
- Provides proxy agents for HTTP requests

### MessageQueueService
- Manages per-device message queues
- Implements rate limiting and delays
- Handles message retry logic

### ProxyMonitoringService
- Collects performance metrics
- Generates alerts based on thresholds
- Provides monitoring dashboard data

## Country Mapping

The system maps device countries to proxy countries:

- **Israel/Palestine Region**: IL, PS, JO, LB, SY → Israeli proxies
- **Other Countries**: Direct mapping (US → US, GB → GB, etc.)
- **Default Fallback**: US proxies for unmapped countries

## Rate Limiting

Default rate limiting settings:
- **Messages per minute**: 20 per device
- **Message delay**: 3 seconds between messages
- **Queue size**: 1000 messages per device
- **Retry attempts**: 3 with exponential backoff

## Monitoring Thresholds

Default alert thresholds:
- **Error rate**: 10% failure rate
- **Response time**: 5 seconds
- **Queue size**: 100 pending messages

## Best Practices

1. **Use Queued Messaging**: Always use `sendMessageQueued()` for better rate limiting
2. **Monitor Alerts**: Regularly check `/api/proxy/alerts` for issues
3. **Proxy Consistency**: Don't manually change proxy assignments
4. **Queue Management**: Clear queues only when necessary
5. **Health Monitoring**: Enable monitoring for production environments

## Troubleshooting

### Common Issues

1. **Proxy Connection Failures**
   - Check Decodo credentials
   - Verify network connectivity
   - Review proxy health status

2. **Queue Backlog**
   - Check rate limiting settings
   - Monitor device connection status
   - Clear queue if necessary

3. **High Error Rates**
   - Review proxy health metrics
   - Check WhatsApp session status
   - Verify message format

### Logs

Enable detailed logging with:
```env
DECODO_ENABLE_LOGGING=true
MESSAGE_QUEUE_ENABLE_LOGGING=true
```

### Health Checks

Monitor service health via:
- `/api/proxy/status` - Overall service status
- `/api/proxy/metrics` - Performance metrics
- `/api/proxy/alerts` - Active alerts

## Performance Considerations

- **Memory Usage**: Each device queue consumes memory
- **Database Load**: Proxy mappings are cached but persisted
- **Network Overhead**: Health checks generate additional traffic
- **Rate Limiting**: Conservative defaults prevent WhatsApp blocking

## Security

- **Credentials**: Store Decodo credentials securely
- **API Access**: Proxy endpoints require authentication
- **Logging**: Sensitive data is not logged
- **Network**: Proxy traffic is encrypted

## Support

For issues related to:
- **Decodo Service**: Contact Decodo support
- **Integration**: Check logs and monitoring alerts
- **Performance**: Review metrics and adjust configuration

## Troubleshooting

### Common Issues

#### 1. "Cannot GET /api/api/proxy/status"
**Problem**: Double `/api` in URL
**Solution**: Use `/api/proxy/status` instead of `/api/api/proxy/status`

#### 2. "No token, authorization denied"
**Problem**: Missing authentication
**Solution**:
1. Login to get token: `POST /api/auth/login`
2. Add header: `Authorization: Bearer {token}`

#### 3. "Decodo proxy service configuration is required"
**Problem**: Missing Decodo credentials
**Solution**: Add to `.env` file:
```env
DECODO_ENABLED=true
DECODO_USERNAME=your-username
DECODO_PASSWORD=your-password
```

#### 4. High error rate alerts
**Problem**: Proxy connection issues
**Solution**:
1. Check Decodo credentials
2. Test proxy connection: `node test-decodo-connection.js`
3. Verify network connectivity

#### 5. Messages not being queued
**Problem**: Message queue disabled or misconfigured
**Solution**: Check `.env` settings:
```env
MESSAGE_QUEUE_ENABLED=true
MESSAGE_QUEUE_RATE_LIMIT=20
```

### Testing Commands

```bash
# Test proxy connection
node test-decodo-connection.js

# Test API endpoints
node test-proxy-endpoints.js

# Test full integration
node test-api.js
```

### Log Locations

- **Server logs**: Console output
- **Proxy logs**: Look for `[DecodoProxyService]` entries
- **Queue logs**: Look for `[MessageQueueService]` entries
- **Monitoring logs**: Look for `[ProxyMonitoringService]` entries
