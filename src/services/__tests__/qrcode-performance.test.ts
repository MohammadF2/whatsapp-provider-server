/**
 * QR Code Performance and Load Tests
 * 
 * Comprehensive performance testing for the QR code system including:
 * - Load testing with concurrent requests
 * - Memory usage monitoring
 * - Response time benchmarks
 * - Resource cleanup verification
 * - Stress testing scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { QRCodeManager, resetQRCodeManager } from '../qrcode-manager.service';
import { getSessionStore, resetSessionStore } from '../session-store.service';
import { performanceMonitor } from '../performance-monitor.service';
import { timeoutManager } from '../timeout-manager.service';
import { rateLimiter } from '../rate-limiter.service';

// Mock external dependencies
vi.mock('whatsapp-web.js', () => ({
  Client: vi.fn(),
  LocalAuth: vi.fn(),
}));

vi.mock('../selenium.service', () => ({
  default: {
    createDriver: vi.fn().mockResolvedValue({
      quit: vi.fn().mockResolvedValue(undefined)
    }),
    closeDriver: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../custom-browser-launcher', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined)
    })
  }
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn()
  },
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn()
}));

vi.mock('path', () => ({
  default: {
    resolve: vi.fn().mockReturnValue('/mock/sessions'),
    join: vi.fn().mockReturnValue('/mock/sessions/device1')
  },
  resolve: vi.fn().mockReturnValue('/mock/sessions'),
  join: vi.fn().mockReturnValue('/mock/sessions/device1')
}));

describe('QR Code Performance Tests', () => {
  let qrCodeManager: QRCodeManager;
  let mockClient: any;
  let mockClientWrapper: any;
  let mockFactory: any;

  beforeAll(() => {
    // Set longer timeout for performance tests
    vi.setConfig({ testTimeout: 30000 });
  });

  beforeEach(() => {
    // Reset all services
    resetQRCodeManager();
    resetSessionStore();
    performanceMonitor.clearAllMetrics();
    timeoutManager.clearAllTimeouts();
    rateLimiter.clear();
    
    vi.clearAllMocks();

    // Create mock WhatsApp client
    mockClient = {
      on: vi.fn(),
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockReturnValue('DISCONNECTED'),
    };

    // Create mock client wrapper
    mockClientWrapper = {
      deviceId: 'test-device',
      client: mockClient,
      onQR: vi.fn(),
      onReady: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    // Mock factory
    mockFactory = {
      createClient: vi.fn().mockResolvedValue(mockClientWrapper),
      hasClient: vi.fn().mockReturnValue(false),
      destroyClient: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock('../whatsapp-client-factory.service', () => ({
      default: mockFactory,
    }));

    // Mock Client constructor
    const { Client } = require('whatsapp-web.js');
    Client.mockImplementation(() => mockClient);

    // Create QR Code Manager with performance-optimized configuration
    qrCodeManager = new QRCodeManager({
      qrGenerationTimeoutMs: 10000,
      sessionExpirationMs: 30000,
      cleanupIntervalMs: 0,
      enableLogging: false,
      maxSessionsPerUser: 10,
      maxSessionsPerDevice: 1,
    });
  });

  afterEach(async () => {
    try {
      await qrCodeManager.destroy();
    } catch (error) {
      // Ignore cleanup errors
    }
    
    resetQRCodeManager();
    resetSessionStore();
    vi.clearAllMocks();
  });

  describe('Load Testing', () => {
    it('should handle 50 concurrent QR generation requests', async () => {
      const concurrentRequests = 50;
      const startTime = Date.now();
      
      // Create concurrent requests
      const promises = Array.from({ length: concurrentRequests }, (_, i) => 
        qrCodeManager.generateQRCode(`device-${i}`, `user-${i}`)
      );

      const results = await Promise.allSettled(promises);
      const endTime = Date.now();
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      const duration = endTime - startTime;

      // Performance assertions
      expect(successful).toBeGreaterThan(concurrentRequests * 0.8); // At least 80% success
      expect(duration).toBeLessThan(15000); // Complete within 15 seconds
      expect(duration / successful).toBeLessThan(500); // Average < 500ms per request

      console.log(`Load Test Results:
        - Concurrent Requests: ${concurrentRequests}
        - Successful: ${successful}
        - Failed: ${failed}
        - Total Duration: ${duration}ms
        - Average per Request: ${(duration / successful).toFixed(2)}ms
        - Requests per Second: ${(successful / (duration / 1000)).toFixed(2)}
      `);
    });

    it('should handle sustained load over time', async () => {
      const batchSize = 10;
      const batches = 5;
      const batchDelay = 1000; // 1 second between batches
      
      const allResults = [];
      const batchTimes = [];

      for (let batch = 0; batch < batches; batch++) {
        const batchStart = Date.now();
        
        const batchPromises = Array.from({ length: batchSize }, (_, i) => 
          qrCodeManager.generateQRCode(`device-batch-${batch}-${i}`, `user-batch-${batch}-${i}`)
        );

        const batchResults = await Promise.allSettled(batchPromises);
        const batchEnd = Date.now();
        
        allResults.push(...batchResults);
        batchTimes.push(batchEnd - batchStart);

        // Wait between batches
        if (batch < batches - 1) {
          await new Promise(resolve => setTimeout(resolve, batchDelay));
        }
      }

      const totalSuccessful = allResults.filter(r => r.status === 'fulfilled').length;
      const totalRequests = batchSize * batches;
      const averageBatchTime = batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length;

      expect(totalSuccessful).toBeGreaterThan(totalRequests * 0.8);
      expect(averageBatchTime).toBeLessThan(5000); // Each batch < 5 seconds
      
      // Verify performance doesn't degrade over time
      const firstBatchTime = batchTimes[0];
      const lastBatchTime = batchTimes[batchTimes.length - 1];
      expect(lastBatchTime).toBeLessThan(firstBatchTime * 2); // No more than 2x slower

      console.log(`Sustained Load Results:
        - Total Requests: ${totalRequests}
        - Successful: ${totalSuccessful}
        - Average Batch Time: ${averageBatchTime.toFixed(2)}ms
        - First Batch: ${firstBatchTime}ms
        - Last Batch: ${lastBatchTime}ms
        - Performance Degradation: ${((lastBatchTime / firstBatchTime - 1) * 100).toFixed(2)}%
      `);
    });

    it('should handle mixed workload scenarios', async () => {
      const scenarios = [
        { type: 'generate', count: 20 },
        { type: 'status', count: 30 },
        { type: 'cancel', count: 10 },
      ];

      const allPromises = [];
      const sessionIds = [];

      // Generate some sessions first
      for (let i = 0; i < 10; i++) {
        const session = await qrCodeManager.generateQRCode(`device-mixed-${i}`, `user-mixed-${i}`);
        sessionIds.push(session.sessionId);
      }

      const startTime = Date.now();

      // Execute mixed workload
      for (const scenario of scenarios) {
        for (let i = 0; i < scenario.count; i++) {
          switch (scenario.type) {
            case 'generate':
              allPromises.push(
                qrCodeManager.generateQRCode(`device-gen-${i}`, `user-gen-${i}`)
              );
              break;
            case 'status':
              if (sessionIds.length > 0) {
                const sessionId = sessionIds[i % sessionIds.length];
                allPromises.push(
                  qrCodeManager.getSessionStatus(sessionId)
                );
              }
              break;
            case 'cancel':
              if (sessionIds.length > 0) {
                const sessionId = sessionIds[i % sessionIds.length];
                allPromises.push(
                  qrCodeManager.cancelSession(sessionId)
                );
              }
              break;
          }
        }
      }

      const results = await Promise.allSettled(allPromises);
      const endTime = Date.now();

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const duration = endTime - startTime;

      expect(successful).toBeGreaterThan(allPromises.length * 0.7); // At least 70% success
      expect(duration).toBeLessThan(10000); // Complete within 10 seconds

      console.log(`Mixed Workload Results:
        - Total Operations: ${allPromises.length}
        - Successful: ${successful}
        - Duration: ${duration}ms
        - Operations per Second: ${(successful / (duration / 1000)).toFixed(2)}
      `);
    });
  });

  describe('Memory Usage Testing', () => {
    it('should maintain reasonable memory usage under load', async () => {
      const initialMemory = process.memoryUsage();
      const sessionStore = getSessionStore();
      
      // Generate many sessions
      const sessions = [];
      for (let i = 0; i < 100; i++) {
        try {
          const session = await qrCodeManager.generateQRCode(`device-mem-${i}`, `user-mem-${i}`);
          sessions.push(session);
        } catch (error) {
          // May hit limits, which is expected
        }
      }

      const peakMemory = process.memoryUsage();
      const memoryStats = sessionStore.getMemoryStats();

      // Trigger memory optimization
      const optimizationResult = sessionStore.optimizeMemory();

      const finalMemory = process.memoryUsage();

      // Memory assertions
      const memoryIncrease = peakMemory.heapUsed - initialMemory.heapUsed;
      const memoryPerSession = sessions.length > 0 ? memoryIncrease / sessions.length : 0;

      expect(memoryPerSession).toBeLessThan(50000); // Less than 50KB per session
      expect(memoryStats.averageSessionSize).toBeLessThan(10000); // Less than 10KB average
      
      // Verify memory optimization worked
      if (optimizationResult.sessionsRemoved > 0) {
        expect(finalMemory.heapUsed).toBeLessThan(peakMemory.heapUsed);
      }

      console.log(`Memory Usage Results:
        - Sessions Created: ${sessions.length}
        - Memory Increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB
        - Memory per Session: ${(memoryPerSession / 1024).toFixed(2)}KB
        - Average Session Size: ${(memoryStats.averageSessionSize / 1024).toFixed(2)}KB
        - Sessions Removed in Optimization: ${optimizationResult.sessionsRemoved}
        - Memory Freed: ${(optimizationResult.memoryFreed / 1024).toFixed(2)}KB
      `);
    });

    it('should handle memory pressure gracefully', async () => {
      const sessionStore = getSessionStore();
      
      // Fill up to near capacity
      const sessions = [];
      for (let i = 0; i < 200; i++) {
        try {
          const session = await qrCodeManager.generateQRCode(`device-pressure-${i}`, `user-pressure-${i % 10}`);
          sessions.push(session);
        } catch (error) {
          // Expected when hitting limits
          break;
        }
      }

      // Check memory stats
      const memoryStats = sessionStore.getMemoryStats();
      
      // Trigger optimization
      const optimizationResult = sessionStore.optimizeMemory();

      // Verify system is still responsive
      const newSession = await qrCodeManager.generateQRCode('device-after-pressure', 'user-after-pressure');
      expect(newSession).toBeDefined();

      console.log(`Memory Pressure Results:
        - Sessions Before Optimization: ${memoryStats.totalSessions}
        - Memory Usage: ${(memoryStats.memoryUsage / 1024 / 1024).toFixed(2)}MB
        - Sessions Removed: ${optimizationResult.sessionsRemoved}
        - System Responsive: ${newSession ? 'Yes' : 'No'}
      `);
    });
  });

  describe('Response Time Benchmarks', () => {
    it('should meet response time SLAs', async () => {
      const iterations = 20;
      const responseTimes = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        
        try {
          await qrCodeManager.generateQRCode(`device-sla-${i}`, `user-sla-${i}`);
          const endTime = Date.now();
          responseTimes.push(endTime - startTime);
        } catch (error) {
          // Record failed attempts as max time
          responseTimes.push(10000);
        }
      }

      // Calculate percentiles
      const sortedTimes = responseTimes.sort((a, b) => a - b);
      const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)];
      const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
      const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)];
      const average = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;

      // SLA assertions
      expect(p50).toBeLessThan(2000); // 50th percentile < 2 seconds
      expect(p95).toBeLessThan(5000); // 95th percentile < 5 seconds
      expect(p99).toBeLessThan(8000); // 99th percentile < 8 seconds
      expect(average).toBeLessThan(3000); // Average < 3 seconds

      console.log(`Response Time SLA Results:
        - Average: ${average.toFixed(2)}ms
        - 50th Percentile: ${p50}ms
        - 95th Percentile: ${p95}ms
        - 99th Percentile: ${p99}ms
        - Min: ${Math.min(...responseTimes)}ms
        - Max: ${Math.max(...responseTimes)}ms
      `);
    });
  });

  describe('Resource Cleanup Testing', () => {
    it('should properly clean up resources after operations', async () => {
      const initialTimeouts = timeoutManager.getActiveTimeoutStats().totalActive;
      const sessionStore = getSessionStore();
      
      // Create and cancel multiple sessions
      const sessions = [];
      for (let i = 0; i < 10; i++) {
        const session = await qrCodeManager.generateQRCode(`device-cleanup-${i}`, `user-cleanup-${i}`);
        sessions.push(session);
      }

      // Cancel half of them
      for (let i = 0; i < 5; i++) {
        await qrCodeManager.cancelSession(sessions[i].sessionId);
      }

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));

      const finalTimeouts = timeoutManager.getActiveTimeoutStats().totalActive;
      const sessionStats = sessionStore.getStatistics();

      // Verify cleanup
      expect(finalTimeouts).toBeLessThanOrEqual(initialTimeouts + 5); // Only active sessions should have timeouts
      expect(sessionStats.activeSessions).toBeLessThanOrEqual(5); // Only non-cancelled sessions

      console.log(`Resource Cleanup Results:
        - Initial Timeouts: ${initialTimeouts}
        - Final Timeouts: ${finalTimeouts}
        - Active Sessions: ${sessionStats.activeSessions}
        - Total Sessions: ${sessionStats.totalSessions}
      `);
    });
  });

  describe('Stress Testing', () => {
    it('should survive extreme load conditions', async () => {
      const extremeLoad = 100;
      const rapidFire = true;
      
      const promises = [];
      const startTime = Date.now();

      // Create extreme load
      for (let i = 0; i < extremeLoad; i++) {
        const promise = qrCodeManager.generateQRCode(`device-stress-${i}`, `user-stress-${i % 20}`)
          .catch(error => ({ error: error.message }));
        
        promises.push(promise);
        
        // Add small delay if not rapid fire
        if (!rapidFire && i % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      const results = await Promise.allSettled(promises);
      const endTime = Date.now();

      const successful = results.filter(r => r.status === 'fulfilled' && !r.value.error).length;
      const duration = endTime - startTime;

      // System should survive (not crash) even if not all requests succeed
      expect(successful).toBeGreaterThan(0); // At least some should succeed
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds

      // Verify system is still responsive after stress
      const postStressSession = await qrCodeManager.generateQRCode('device-post-stress', 'user-post-stress');
      expect(postStressSession).toBeDefined();

      console.log(`Stress Test Results:
        - Extreme Load: ${extremeLoad} requests
        - Successful: ${successful}
        - Success Rate: ${(successful / extremeLoad * 100).toFixed(2)}%
        - Duration: ${duration}ms
        - System Survived: Yes
        - Post-Stress Responsive: ${postStressSession ? 'Yes' : 'No'}
      `);
    });
  });
});
