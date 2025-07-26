/**
 * Health Check Service
 * 
 * Provides comprehensive health monitoring for the QR code system,
 * including system metrics, dependency checks, and performance monitoring.
 */

import { createLogger, Logger } from './logger.service';
import { performanceMonitor } from './performance-monitor.service';
import { rateLimiter } from './rate-limiter.service';
import { timeoutManager } from './timeout-manager.service';
import { errorRecoveryService } from './error-recovery.service';
import { getSessionStore } from './session-store.service';

/**
 * Health status levels
 */
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  CRITICAL = 'critical',
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: HealthStatus;
  message: string;
  details?: Record<string, any>;
  timestamp: Date;
  duration: number;
}

/**
 * System health summary
 */
export interface SystemHealth {
  overall: HealthStatus;
  timestamp: Date;
  uptime: number;
  version: string;
  checks: Record<string, HealthCheckResult>;
  metrics: {
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    performance: {
      totalOperations: number;
      operationsWithAlerts: number;
      overallSuccessRate: number;
      averageResponseTime: number;
      activeTimers: number;
    };
    sessions: {
      total: number;
      active: number;
      expired: number;
      failed: number;
    };
    rateLimiting: {
      totalKeys: number;
      configCount: number;
      memoryUsage: number;
    };
    timeouts: {
      totalActive: number;
      averageAge: number;
    };
    circuitBreakers: Record<string, any>;
  };
}

/**
 * Health check function type
 */
export type HealthCheckFunction = () => Promise<HealthCheckResult>;

/**
 * Health Check Service
 */
export class HealthCheckService {
  private readonly logger: Logger;
  private readonly checks: Map<string, HealthCheckFunction> = new Map();
  private readonly startTime: Date;
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.logger = createLogger('HealthCheck', {
      enablePerformanceLogs: true,
    });
    
    this.startTime = new Date();
    this.registerDefaultChecks();
    this.startMonitoring();
    
    this.logger.info('Health check service initialized');
  }

  /**
   * Register a health check
   */
  registerCheck(name: string, checkFunction: HealthCheckFunction): void {
    this.checks.set(name, checkFunction);
    this.logger.debug('Health check registered', { name });
  }

  /**
   * Unregister a health check
   */
  unregisterCheck(name: string): boolean {
    const removed = this.checks.delete(name);
    if (removed) {
      this.logger.debug('Health check unregistered', { name });
    }
    return removed;
  }

  /**
   * Run a specific health check
   */
  async runCheck(name: string): Promise<HealthCheckResult> {
    const checkFunction = this.checks.get(name);
    if (!checkFunction) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: `Health check '${name}' not found`,
        timestamp: new Date(),
        duration: 0,
      };
    }

    const startTime = Date.now();
    
    try {
      const result = await checkFunction();
      result.duration = Date.now() - startTime;
      return result;
    } catch (error) {
      return {
        status: HealthStatus.CRITICAL,
        message: `Health check '${name}' failed: ${(error as Error).message}`,
        details: { error: (error as Error).stack },
        timestamp: new Date(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Run all health checks
   */
  async runAllChecks(): Promise<Record<string, HealthCheckResult>> {
    const results: Record<string, HealthCheckResult> = {};
    
    const checkPromises = Array.from(this.checks.keys()).map(async (name) => {
      const result = await this.runCheck(name);
      results[name] = result;
    });

    await Promise.all(checkPromises);
    return results;
  }

  /**
   * Get comprehensive system health
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const checks = await this.runAllChecks();
    const overall = this.calculateOverallHealth(checks);
    
    return {
      overall,
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime(),
      version: process.env.npm_package_version || '1.0.0',
      checks,
      metrics: await this.collectMetrics(),
    };
  }

  /**
   * Get simple health status
   */
  async getSimpleHealth(): Promise<{ status: HealthStatus; timestamp: Date }> {
    const checks = await this.runAllChecks();
    const overall = this.calculateOverallHealth(checks);
    
    return {
      status: overall,
      timestamp: new Date(),
    };
  }

  /**
   * Check if system is healthy
   */
  async isHealthy(): Promise<boolean> {
    const health = await this.getSimpleHealth();
    return health.status === HealthStatus.HEALTHY || health.status === HealthStatus.DEGRADED;
  }

  /**
   * Destroy the health check service
   */
  destroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.checks.clear();
    this.logger.info('Health check service destroyed');
  }

  /**
   * Register default health checks
   */
  private registerDefaultChecks(): void {
    // Memory usage check
    this.registerCheck('memory', async () => {
      const memUsage = process.memoryUsage();
      const totalMem = memUsage.heapTotal;
      const usedMem = memUsage.heapUsed;
      const percentage = (usedMem / totalMem) * 100;
      
      let status = HealthStatus.HEALTHY;
      let message = `Memory usage: ${percentage.toFixed(2)}%`;
      
      if (percentage > 90) {
        status = HealthStatus.CRITICAL;
        message = `Critical memory usage: ${percentage.toFixed(2)}%`;
      } else if (percentage > 80) {
        status = HealthStatus.UNHEALTHY;
        message = `High memory usage: ${percentage.toFixed(2)}%`;
      } else if (percentage > 70) {
        status = HealthStatus.DEGRADED;
        message = `Elevated memory usage: ${percentage.toFixed(2)}%`;
      }
      
      return {
        status,
        message,
        details: { memUsage, percentage },
        timestamp: new Date(),
        duration: 0,
      };
    });

    // Performance monitoring check
    this.registerCheck('performance', async () => {
      const healthSummary = performanceMonitor.getHealthSummary();
      
      let status = HealthStatus.HEALTHY;
      let message = `Performance: ${healthSummary.overallSuccessRate.toFixed(2)}% success rate`;
      
      if (healthSummary.overallSuccessRate < 50) {
        status = HealthStatus.CRITICAL;
        message = `Critical performance: ${healthSummary.overallSuccessRate.toFixed(2)}% success rate`;
      } else if (healthSummary.overallSuccessRate < 80) {
        status = HealthStatus.UNHEALTHY;
        message = `Poor performance: ${healthSummary.overallSuccessRate.toFixed(2)}% success rate`;
      } else if (healthSummary.overallSuccessRate < 95) {
        status = HealthStatus.DEGRADED;
        message = `Degraded performance: ${healthSummary.overallSuccessRate.toFixed(2)}% success rate`;
      }
      
      return {
        status,
        message,
        details: healthSummary,
        timestamp: new Date(),
        duration: 0,
      };
    });

    // Session store check
    this.registerCheck('sessions', async () => {
      try {
        const sessionStore = getSessionStore();
        const stats = sessionStore.getStatistics();
        
        let status = HealthStatus.HEALTHY;
        let message = `Sessions: ${stats.totalSessions} total, ${stats.activeSessions} active`;
        
        if (stats.activeSessions > 100) {
          status = HealthStatus.DEGRADED;
          message = `High session count: ${stats.activeSessions} active sessions`;
        }
        
        return {
          status,
          message,
          details: stats,
          timestamp: new Date(),
          duration: 0,
        };
      } catch (error) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: `Session store error: ${(error as Error).message}`,
          timestamp: new Date(),
          duration: 0,
        };
      }
    });

    // Rate limiter check
    this.registerCheck('rateLimiter', async () => {
      try {
        const stats = rateLimiter.getStatistics();
        
        let status = HealthStatus.HEALTHY;
        let message = `Rate limiter: ${stats.totalKeys} active limits`;
        
        if (stats.memoryUsage > 1024 * 1024) { // 1MB
          status = HealthStatus.DEGRADED;
          message = `Rate limiter high memory usage: ${(stats.memoryUsage / 1024 / 1024).toFixed(2)}MB`;
        }
        
        return {
          status,
          message,
          details: stats,
          timestamp: new Date(),
          duration: 0,
        };
      } catch (error) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: `Rate limiter error: ${(error as Error).message}`,
          timestamp: new Date(),
          duration: 0,
        };
      }
    });

    // Timeout manager check
    this.registerCheck('timeouts', async () => {
      try {
        const stats = timeoutManager.getActiveTimeoutStats();
        
        let status = HealthStatus.HEALTHY;
        let message = `Timeouts: ${stats.totalActive} active`;
        
        if (stats.totalActive > 50) {
          status = HealthStatus.DEGRADED;
          message = `High timeout count: ${stats.totalActive} active timeouts`;
        }
        
        if (stats.averageAge > 300000) { // 5 minutes
          status = HealthStatus.UNHEALTHY;
          message = `Old timeouts detected: average age ${(stats.averageAge / 1000).toFixed(0)}s`;
        }
        
        return {
          status,
          message,
          details: stats,
          timestamp: new Date(),
          duration: 0,
        };
      } catch (error) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: `Timeout manager error: ${(error as Error).message}`,
          timestamp: new Date(),
          duration: 0,
        };
      }
    });

    // Circuit breaker check
    this.registerCheck('circuitBreakers', async () => {
      try {
        const statuses = errorRecoveryService.getCircuitBreakerStatuses();
        const openBreakers = Object.entries(statuses).filter(([_, status]) => status.state === 'open');
        
        let status = HealthStatus.HEALTHY;
        let message = `Circuit breakers: ${Object.keys(statuses).length} total`;
        
        if (openBreakers.length > 0) {
          status = HealthStatus.DEGRADED;
          message = `Circuit breakers open: ${openBreakers.map(([name]) => name).join(', ')}`;
        }
        
        return {
          status,
          message,
          details: statuses,
          timestamp: new Date(),
          duration: 0,
        };
      } catch (error) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: `Circuit breaker error: ${(error as Error).message}`,
          timestamp: new Date(),
          duration: 0,
        };
      }
    });
  }

  /**
   * Calculate overall health status from individual checks
   */
  private calculateOverallHealth(checks: Record<string, HealthCheckResult>): HealthStatus {
    const statuses = Object.values(checks).map(check => check.status);
    
    if (statuses.includes(HealthStatus.CRITICAL)) {
      return HealthStatus.CRITICAL;
    }
    
    if (statuses.includes(HealthStatus.UNHEALTHY)) {
      return HealthStatus.UNHEALTHY;
    }
    
    if (statuses.includes(HealthStatus.DEGRADED)) {
      return HealthStatus.DEGRADED;
    }
    
    return HealthStatus.HEALTHY;
  }

  /**
   * Collect system metrics
   */
  private async collectMetrics(): Promise<SystemHealth['metrics']> {
    const memUsage = process.memoryUsage();
    const performanceHealth = performanceMonitor.getHealthSummary();
    const sessionStore = getSessionStore();
    const sessionStats = sessionStore.getStatistics();
    const rateLimiterStats = rateLimiter.getStatistics();
    const timeoutStats = timeoutManager.getActiveTimeoutStats();
    const circuitBreakerStatuses = errorRecoveryService.getCircuitBreakerStatuses();

    return {
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      },
      performance: performanceHealth,
      sessions: {
        total: sessionStats.totalSessions,
        active: sessionStats.activeSessions,
        expired: sessionStats.expiredSessions,
        failed: sessionStats.failedSessions,
      },
      rateLimiting: rateLimiterStats,
      timeouts: {
        totalActive: timeoutStats.totalActive,
        averageAge: timeoutStats.averageAge,
      },
      circuitBreakers: circuitBreakerStatuses,
    };
  }

  /**
   * Start health monitoring
   */
  private startMonitoring(): void {
    // Log health status every 5 minutes
    this.monitoringInterval = setInterval(async () => {
      try {
        const health = await this.getSimpleHealth();
        
        if (health.status === HealthStatus.HEALTHY) {
          this.logger.debug('System health check', { status: health.status });
        } else {
          this.logger.warn('System health degraded', { status: health.status });
        }
      } catch (error) {
        this.logger.error('Health monitoring error', error as Error);
      }
    }, 300000); // 5 minutes

    // Ensure the timer doesn't keep the process alive
    this.monitoringInterval.unref();
  }
}

/**
 * Default health check service instance
 */
export const healthCheck = new HealthCheckService();

/**
 * Create health check service
 */
export function createHealthCheck(): HealthCheckService {
  return new HealthCheckService();
}
