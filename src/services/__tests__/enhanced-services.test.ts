/**
 * Enhanced Services Test Suite
 * 
 * Comprehensive tests for the new enhanced services including:
 * - Logger service with correlation IDs and performance timing
 * - Rate limiter with different algorithms
 * - Health check service and monitoring
 * - Performance monitor and metrics collection
 * - Timeout manager and retry strategies
 * - Error recovery service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger, createLogger, generateCorrelationId, PerformanceTimer } from '../logger.service';
import { RateLimiterService, RateLimitAlgorithm } from '../rate-limiter.service';
import { HealthCheckService, HealthStatus } from '../health-check.service';
import { PerformanceMonitorService } from '../performance-monitor.service';
import { TimeoutManagerService } from '../timeout-manager.service';
import { RetryStrategyService, RetryStrategy } from '../retry-strategy.service';
import { ErrorRecoveryService } from '../error-recovery.service';

describe('Enhanced Services Test Suite', () => {
  describe('Logger Service', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = createLogger('TestService');
    });

    it('should create logger with correlation ID', () => {
      const correlationId = generateCorrelationId();
      const childLogger = logger.child(correlationId, { testContext: 'value' });
      
      expect(childLogger).toBeDefined();
      expect(correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should track performance timing', async () => {
      const timer = logger.startTimer('test-operation');
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const perfData = timer.end();
      
      expect(perfData.duration).toBeGreaterThan(0);
      expect(perfData.operation).toBe('test-operation');
    });

    it('should log with timing wrapper', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const result = await logger.withTiming('test-async-operation', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'success';
      });
      
      expect(result).toBe('success');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should handle errors in timing wrapper', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      await expect(logger.withTiming('failing-operation', async () => {
        throw new Error('Test error');
      })).rejects.toThrow('Test error');
      
      expect(consoleErrorSpy).toHaveBeenCalled();
      
      consoleErrorSpy.mockRestore();
    });

    it('should set and clear context', () => {
      logger.setContext({ userId: '123', deviceId: 'abc' });
      
      // Context should be included in logs
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('Test message');
      
      logger.clearContext();
      logger.info('Another message');
      
      expect(consoleSpy).toHaveBeenCalledTimes(2);
      consoleSpy.mockRestore();
    });
  });

  describe('Rate Limiter Service', () => {
    let rateLimiter: RateLimiterService;

    beforeEach(() => {
      rateLimiter = new RateLimiterService();
    });

    afterEach(() => {
      rateLimiter.destroy();
    });

    it('should enforce rate limits', () => {
      rateLimiter.setConfig('test-limit', {
        maxRequests: 2,
        windowMs: 60000,
        algorithm: RateLimitAlgorithm.FIXED_WINDOW,
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
        headers: {
          total: true,
          remaining: true,
          reset: true,
          retryAfter: true,
        },
      });

      // First two requests should be allowed
      const result1 = rateLimiter.consume('test-limit', 'user1');
      const result2 = rateLimiter.consume('test-limit', 'user1');
      
      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result2.remainingRequests).toBe(0);

      // Third request should be blocked
      const result3 = rateLimiter.consume('test-limit', 'user1');
      expect(result3.allowed).toBe(false);
      expect(result3.retryAfter).toBeGreaterThan(0);
    });

    it('should handle different algorithms', () => {
      const algorithms = [
        RateLimitAlgorithm.FIXED_WINDOW,
        RateLimitAlgorithm.TOKEN_BUCKET,
        RateLimitAlgorithm.SLIDING_WINDOW,
        RateLimitAlgorithm.SLIDING_WINDOW_LOG,
      ];

      algorithms.forEach(algorithm => {
        rateLimiter.setConfig(`test-${algorithm}`, {
          maxRequests: 5,
          windowMs: 60000,
          algorithm,
          skipSuccessfulRequests: false,
          skipFailedRequests: false,
          headers: {
            total: true,
            remaining: true,
            reset: true,
            retryAfter: true,
          },
        });

        const result = rateLimiter.consume(`test-${algorithm}`, 'user1');
        expect(result.allowed).toBe(true);
      });
    });

    it('should reset rate limits', () => {
      rateLimiter.setConfig('test-reset', {
        maxRequests: 1,
        windowMs: 60000,
        algorithm: RateLimitAlgorithm.FIXED_WINDOW,
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
        headers: {
          total: true,
          remaining: true,
          reset: true,
          retryAfter: true,
        },
      });

      // Consume the limit
      rateLimiter.consume('test-reset', 'user1');
      const blockedResult = rateLimiter.consume('test-reset', 'user1');
      expect(blockedResult.allowed).toBe(false);

      // Reset and try again
      rateLimiter.reset('test-reset', 'user1');
      const afterResetResult = rateLimiter.consume('test-reset', 'user1');
      expect(afterResetResult.allowed).toBe(true);
    });

    it('should provide statistics', () => {
      rateLimiter.consume('qrGeneration', 'user1');
      rateLimiter.consume('qrGeneration', 'user2');
      
      const stats = rateLimiter.getStatistics();
      
      expect(stats.totalKeys).toBeGreaterThan(0);
      expect(stats.configCount).toBeGreaterThan(0);
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });
  });

  describe('Health Check Service', () => {
    let healthCheck: HealthCheckService;

    beforeEach(() => {
      healthCheck = new HealthCheckService();
    });

    afterEach(() => {
      healthCheck.destroy();
    });

    it('should register and run health checks', async () => {
      healthCheck.registerCheck('test-check', async () => ({
        status: HealthStatus.HEALTHY,
        message: 'Test check passed',
        timestamp: new Date(),
        duration: 10,
      }));

      const result = await healthCheck.runCheck('test-check');
      
      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.message).toBe('Test check passed');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle failing health checks', async () => {
      healthCheck.registerCheck('failing-check', async () => {
        throw new Error('Health check failed');
      });

      const result = await healthCheck.runCheck('failing-check');
      
      expect(result.status).toBe(HealthStatus.CRITICAL);
      expect(result.message).toContain('Health check failed');
    });

    it('should run all health checks', async () => {
      healthCheck.registerCheck('check1', async () => ({
        status: HealthStatus.HEALTHY,
        message: 'Check 1 passed',
        timestamp: new Date(),
        duration: 5,
      }));

      healthCheck.registerCheck('check2', async () => ({
        status: HealthStatus.DEGRADED,
        message: 'Check 2 degraded',
        timestamp: new Date(),
        duration: 8,
      }));

      const results = await healthCheck.runAllChecks();
      
      expect(Object.keys(results)).toHaveLength(2);
      expect(results.check1.status).toBe(HealthStatus.HEALTHY);
      expect(results.check2.status).toBe(HealthStatus.DEGRADED);
    });

    it('should get system health summary', async () => {
      const systemHealth = await healthCheck.getSystemHealth();
      
      expect(systemHealth.overall).toBeDefined();
      expect(systemHealth.timestamp).toBeInstanceOf(Date);
      expect(systemHealth.uptime).toBeGreaterThan(0);
      expect(systemHealth.checks).toBeDefined();
      expect(systemHealth.metrics).toBeDefined();
    });

    it('should calculate overall health status', async () => {
      healthCheck.registerCheck('healthy-check', async () => ({
        status: HealthStatus.HEALTHY,
        message: 'Healthy',
        timestamp: new Date(),
        duration: 5,
      }));

      healthCheck.registerCheck('critical-check', async () => ({
        status: HealthStatus.CRITICAL,
        message: 'Critical',
        timestamp: new Date(),
        duration: 5,
      }));

      const systemHealth = await healthCheck.getSystemHealth();
      
      // Overall should be critical if any check is critical
      expect(systemHealth.overall).toBe(HealthStatus.CRITICAL);
    });
  });

  describe('Performance Monitor Service', () => {
    let performanceMonitor: PerformanceMonitorService;

    beforeEach(() => {
      performanceMonitor = new PerformanceMonitorService();
    });

    afterEach(() => {
      performanceMonitor.destroy();
    });

    it('should track operation timing', async () => {
      const timerId = performanceMonitor.startTiming('test-operation');
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      performanceMonitor.endTiming(timerId, true);
      
      const metrics = performanceMonitor.getMetrics('test-operation');
      
      expect(metrics).toBeDefined();
      expect(metrics!.totalCount).toBe(1);
      expect(metrics!.successCount).toBe(1);
      expect(metrics!.averageTime).toBeGreaterThan(0);
    });

    it('should record operation with automatic timing', async () => {
      const result = await performanceMonitor.recordOperation('auto-timed-operation', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'success';
      });
      
      expect(result).toBe('success');
      
      const metrics = performanceMonitor.getMetrics('auto-timed-operation');
      expect(metrics!.totalCount).toBe(1);
      expect(metrics!.successCount).toBe(1);
    });

    it('should track failed operations', async () => {
      try {
        await performanceMonitor.recordOperation('failing-operation', async () => {
          throw new Error('Operation failed');
        });
      } catch (error) {
        // Expected
      }
      
      const metrics = performanceMonitor.getMetrics('failing-operation');
      expect(metrics!.totalCount).toBe(1);
      expect(metrics!.failureCount).toBe(1);
      expect(metrics!.successRate).toBe(0);
    });

    it('should calculate percentiles', async () => {
      // Record multiple operations with different durations
      for (let i = 0; i < 10; i++) {
        const timerId = performanceMonitor.startTiming('percentile-test');
        await new Promise(resolve => setTimeout(resolve, i * 2));
        performanceMonitor.endTiming(timerId, true);
      }
      
      const metrics = performanceMonitor.getMetrics('percentile-test');
      
      expect(metrics!.p95Time).toBeGreaterThanOrEqual(metrics!.p50Time);
      expect(metrics!.p99Time).toBeGreaterThanOrEqual(metrics!.p95Time);
    });

    it('should check for performance alerts', async () => {
      // Create operations that exceed thresholds
      for (let i = 0; i < 5; i++) {
        try {
          await performanceMonitor.recordOperation('alert-test', async () => {
            throw new Error('Simulated failure');
          });
        } catch (error) {
          // Expected
        }
      }
      
      const alerts = performanceMonitor.checkAlerts();
      
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].alertType).toBeDefined();
      expect(alerts[0].message).toBeDefined();
    });

    it('should provide health summary', () => {
      const healthSummary = performanceMonitor.getHealthSummary();
      
      expect(healthSummary.totalOperations).toBeGreaterThanOrEqual(0);
      expect(healthSummary.operationsWithAlerts).toBeGreaterThanOrEqual(0);
      expect(healthSummary.overallSuccessRate).toBeGreaterThanOrEqual(0);
      expect(healthSummary.averageResponseTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Timeout Manager Service', () => {
    let timeoutManager: TimeoutManagerService;

    beforeEach(() => {
      vi.useFakeTimers();
      timeoutManager = new TimeoutManagerService();
    });

    afterEach(() => {
      timeoutManager.destroy();
      vi.useRealTimers();
    });

    it('should set and clear timeouts', () => {
      const callback = vi.fn();
      
      const timeoutId = timeoutManager.setTimeout('qrGeneration', callback, {}, 1000);
      
      expect(timeoutId).toBeDefined();
      
      const cleared = timeoutManager.clearTimeout(timeoutId);
      expect(cleared).toBe(true);
      
      // Advance time to ensure callback is not called
      vi.advanceTimersByTime(2000);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should execute timeout callback', async () => {
      const callback = vi.fn();
      
      timeoutManager.setTimeout('qrGeneration', callback, {}, 1000);
      
      // Advance time to trigger timeout
      vi.advanceTimersByTime(1500);
      
      // Wait for async callback
      await vi.runAllTimersAsync();
      
      expect(callback).toHaveBeenCalled();
    });

    it('should execute operation with timeout protection', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await timeoutManager.executeWithTimeout(
        operation,
        'qrGeneration',
        {},
        1000
      );
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalled();
    });

    it('should timeout long-running operations', async () => {
      const operation = vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 2000))
      );
      
      const promise = timeoutManager.executeWithTimeout(
        operation,
        'qrGeneration',
        {},
        1000
      );
      
      // Advance time to trigger timeout
      vi.advanceTimersByTime(1500);
      
      await expect(promise).rejects.toThrow();
    });

    it('should provide timeout statistics', () => {
      timeoutManager.setTimeout('qrGeneration', vi.fn(), {}, 1000);
      timeoutManager.setTimeout('connection', vi.fn(), {}, 2000);
      
      const stats = timeoutManager.getActiveTimeoutStats();
      
      expect(stats.totalActive).toBe(2);
      expect(stats.byOperation.qrGeneration).toBe(1);
      expect(stats.byOperation.connection).toBe(1);
    });
  });

  describe('Retry Strategy Service', () => {
    let retryStrategy: RetryStrategyService;

    beforeEach(() => {
      retryStrategy = new RetryStrategyService();
    });

    it('should execute operation with retry', async () => {
      let attemptCount = 0;
      const operation = vi.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });
      
      const result = await retryStrategy.executeWithRetry(
        operation,
        'qrGeneration'
      );
      
      expect(result).toBe('success');
      expect(attemptCount).toBe(3);
    });

    it('should fail after max retries', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Persistent failure'));
      
      await expect(retryStrategy.executeWithRetry(
        operation,
        'qrGeneration'
      )).rejects.toThrow('Persistent failure');
    });

    it('should use custom retry configuration', async () => {
      let attemptCount = 0;
      const operation = vi.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error('Failure');
        }
        return 'success';
      });
      
      const customConfig = {
        maxRetries: 1,
        strategy: RetryStrategy.FIXED,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 1,
        useJitter: false,
        jitterFactor: 0,
      };
      
      const result = await retryStrategy.executeWithCustomRetry(
        operation,
        customConfig
      );
      
      expect(result).toBe('success');
      expect(attemptCount).toBe(2);
    });

    it('should manage retry configurations', () => {
      const customConfig = {
        maxRetries: 5,
        strategy: RetryStrategy.EXPONENTIAL,
        baseDelayMs: 500,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        useJitter: true,
        jitterFactor: 0.1,
      };
      
      retryStrategy.setRetryConfig('custom-operation', customConfig);
      
      const retrievedConfig = retryStrategy.getRetryConfig('custom-operation');
      expect(retrievedConfig).toEqual(customConfig);
      
      const allConfigs = retryStrategy.getAllRetryConfigs();
      expect(allConfigs['custom-operation']).toEqual(customConfig);
    });
  });

  describe('Error Recovery Service', () => {
    let errorRecovery: ErrorRecoveryService;

    beforeEach(() => {
      errorRecovery = new ErrorRecoveryService();
    });

    it('should execute operation with retry', async () => {
      let attemptCount = 0;
      const operation = vi.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });
      
      const result = await errorRecovery.executeWithRetry(
        operation,
        'test-operation'
      );
      
      expect(result).toBe('success');
      expect(attemptCount).toBe(3);
    });

    it('should provide error recovery recommendations', () => {
      const error = new Error('Test error');
      
      const recommendations = errorRecovery.getRecoveryRecommendations(error);
      
      expect(recommendations.shouldRetry).toBeDefined();
      expect(recommendations.suggestedDelay).toBeGreaterThan(0);
      expect(recommendations.recoveryActions).toBeInstanceOf(Array);
      expect(recommendations.errorCategory).toBeDefined();
    });

    it('should track circuit breaker status', async () => {
      // Trigger circuit breaker by causing failures
      for (let i = 0; i < 10; i++) {
        try {
          await errorRecovery.executeWithCircuitBreaker(
            () => Promise.reject(new Error('Failure')),
            'test-circuit-breaker'
          );
        } catch (error) {
          // Expected
        }
      }
      
      const statuses = errorRecovery.getCircuitBreakerStatuses();
      expect(Object.keys(statuses)).toContain('test-circuit-breaker');
    });

    it('should reset circuit breaker', async () => {
      // Trigger circuit breaker
      for (let i = 0; i < 6; i++) {
        try {
          await errorRecovery.executeWithCircuitBreaker(
            () => Promise.reject(new Error('Failure')),
            'reset-test-breaker'
          );
        } catch (error) {
          // Expected
        }
      }
      
      const resetResult = errorRecovery.resetCircuitBreaker('reset-test-breaker');
      expect(resetResult).toBe(true);
      
      const statuses = errorRecovery.getCircuitBreakerStatuses();
      const breakerStatus = statuses['reset-test-breaker'];
      expect(breakerStatus.failureCount).toBe(0);
    });
  });
});
