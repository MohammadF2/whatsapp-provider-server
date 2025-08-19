/**
 * Performance Monitoring Service
 * 
 * Provides comprehensive performance monitoring, metrics collection,
 * and alerting for the QR code system operations.
 */

import { createLogger, Logger, PerformanceTimer } from './logger.service';
import { ErrorCategory } from '../models/qrcode.errors';

/**
 * Performance metrics interface
 */
export interface PerformanceMetrics {
  /** Operation name */
  operation: string;
  
  /** Total execution count */
  totalCount: number;
  
  /** Success count */
  successCount: number;
  
  /** Failure count */
  failureCount: number;
  
  /** Success rate percentage */
  successRate: number;
  
  /** Average execution time in milliseconds */
  averageTime: number;
  
  /** Minimum execution time in milliseconds */
  minTime: number;
  
  /** Maximum execution time in milliseconds */
  maxTime: number;

  /** 50th percentile execution time in milliseconds */
  p50Time: number;

  /** 95th percentile execution time in milliseconds */
  p95Time: number;

  /** 99th percentile execution time in milliseconds */
  p99Time: number;
  
  /** Last execution time */
  lastExecutionTime: Date;
  
  /** Error breakdown by category */
  errorsByCategory: Record<ErrorCategory, number>;
}

/**
 * Performance alert configuration
 */
export interface AlertConfig {
  /** Maximum acceptable average response time in milliseconds */
  maxAverageResponseTime: number;
  
  /** Minimum acceptable success rate percentage */
  minSuccessRate: number;
  
  /** Maximum acceptable error rate percentage */
  maxErrorRate: number;
  
  /** Time window for alert evaluation in milliseconds */
  alertWindowMs: number;
  
  /** Minimum sample size for alert evaluation */
  minSampleSize: number;
}

/**
 * Default alert configuration
 */
const DEFAULT_ALERT_CONFIG: AlertConfig = {
  maxAverageResponseTime: 30000, // 30 seconds
  minSuccessRate: 95, // 95%
  maxErrorRate: 5, // 5%
  alertWindowMs: 300000, // 5 minutes
  minSampleSize: 10,
};

/**
 * Performance data point
 */
interface PerformanceDataPoint {
  timestamp: Date;
  duration: number;
  success: boolean;
  errorCategory?: ErrorCategory;
  context?: Record<string, any>;
}

/**
 * Performance Monitor Service
 */
export class PerformanceMonitorService {
  private readonly logger: Logger;
  private readonly alertConfig: AlertConfig;
  private readonly operationData: Map<string, PerformanceDataPoint[]> = new Map();
  private readonly activeTimers: Map<string, PerformanceTimer> = new Map();
  private alertCheckInterval: NodeJS.Timeout | null = null;

  constructor(alertConfig: Partial<AlertConfig> = {}) {
    this.alertConfig = { ...DEFAULT_ALERT_CONFIG, ...alertConfig };
    this.logger = createLogger('PerformanceMonitor', {
      enablePerformanceLogs: true,
    });
    
    this.startAlertMonitoring();
  }

  /**
   * Start timing an operation
   */
  startTiming(operation: string, context?: Record<string, any>): string {
    const timerId = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timer = new PerformanceTimer(operation);
    
    this.activeTimers.set(timerId, timer);
    
    this.logger.debug('Started timing operation', { 
      operation, 
      timerId,
      context,
    });
    
    return timerId;
  }

  /**
   * End timing an operation and record metrics
   */
  endTiming(timerId: string, success: boolean = true, errorCategory?: ErrorCategory, context?: Record<string, any>): void {
    const timer = this.activeTimers.get(timerId);
    if (!timer) {
      this.logger.warn('Timer not found for timing end', { timerId });
      return;
    }

    const perfData = timer.end();
    this.activeTimers.delete(timerId);

    const dataPoint: PerformanceDataPoint = {
      timestamp: new Date(),
      duration: perfData.duration,
      success,
      errorCategory,
      context,
    };

    // Store data point
    const operation = perfData.operation;
    if (!this.operationData.has(operation)) {
      this.operationData.set(operation, []);
    }
    
    const operationDataPoints = this.operationData.get(operation)!;
    operationDataPoints.push(dataPoint);

    // Keep only recent data points (last 1000 or within alert window)
    const cutoffTime = new Date(Date.now() - this.alertConfig.alertWindowMs * 2);
    const filteredData = operationDataPoints.filter(dp => dp.timestamp > cutoffTime);
    this.operationData.set(operation, filteredData.slice(-1000)); // Keep max 1000 data points

    this.logger.debug('Ended timing operation', {
      operation,
      timerId,
      duration: perfData.duration,
      success,
      errorCategory,
      context,
    });

    // Log performance warning if operation took too long
    if (perfData.duration > this.alertConfig.maxAverageResponseTime) {
      this.logger.warn('Operation exceeded maximum response time', {
        operation,
        duration: perfData.duration,
        maxAllowed: this.alertConfig.maxAverageResponseTime,
        context,
      });
    }
  }

  /**
   * Record operation metrics with automatic timing
   */
  async recordOperation<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: Record<string, any>
  ): Promise<T> {
    const timerId = this.startTiming(operation, context);
    
    try {
      const result = await fn();
      this.endTiming(timerId, true, undefined, context);
      return result;
    } catch (error) {
      const errorCategory = this.categorizeError(error as Error);
      this.endTiming(timerId, false, errorCategory, { ...context, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Get performance metrics for an operation
   */
  getMetrics(operation: string): PerformanceMetrics | null {
    const dataPoints = this.operationData.get(operation);
    if (!dataPoints || dataPoints.length === 0) {
      return null;
    }

    const successfulOps = dataPoints.filter(dp => dp.success);
    const failedOps = dataPoints.filter(dp => !dp.success);
    
    const durations = dataPoints.map(dp => dp.duration);
    const successfulDurations = successfulOps.map(dp => dp.duration);
    
    // Calculate percentiles
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const p50Index = Math.floor(sortedDurations.length * 0.5);
    const p95Index = Math.floor(sortedDurations.length * 0.95);
    const p99Index = Math.floor(sortedDurations.length * 0.99);

    // Count errors by category
    const errorsByCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.VALIDATION]: 0,
      [ErrorCategory.AUTHENTICATION]: 0,
      [ErrorCategory.AUTHORIZATION]: 0,
      [ErrorCategory.NOT_FOUND]: 0,
      [ErrorCategory.TIMEOUT]: 0,
      [ErrorCategory.CLIENT_ERROR]: 0,
      [ErrorCategory.SERVER_ERROR]: 0,
      [ErrorCategory.RATE_LIMIT]: 0,
      [ErrorCategory.RESOURCE_ERROR]: 0,
    };

    failedOps.forEach(op => {
      if (op.errorCategory) {
        errorsByCategory[op.errorCategory]++;
      }
    });

    return {
      operation,
      totalCount: dataPoints.length,
      successCount: successfulOps.length,
      failureCount: failedOps.length,
      successRate: (successfulOps.length / dataPoints.length) * 100,
      averageTime: successfulDurations.length > 0 
        ? successfulDurations.reduce((sum, d) => sum + d, 0) / successfulDurations.length 
        : 0,
      minTime: Math.min(...durations),
      maxTime: Math.max(...durations),
      p50Time: sortedDurations[p50Index] || 0,
      p95Time: sortedDurations[p95Index] || 0,
      p99Time: sortedDurations[p99Index] || 0,
      lastExecutionTime: dataPoints[dataPoints.length - 1].timestamp,
      errorsByCategory,
    };
  }

  /**
   * Get metrics for all operations
   */
  getAllMetrics(): Record<string, PerformanceMetrics> {
    const allMetrics: Record<string, PerformanceMetrics> = {};
    
    for (const operation of this.operationData.keys()) {
      const metrics = this.getMetrics(operation);
      if (metrics) {
        allMetrics[operation] = metrics;
      }
    }
    
    return allMetrics;
  }

  /**
   * Get recent performance data for an operation
   */
  getRecentData(operation: string, windowMs: number = this.alertConfig.alertWindowMs): PerformanceDataPoint[] {
    const dataPoints = this.operationData.get(operation);
    if (!dataPoints) {
      return [];
    }

    const cutoffTime = new Date(Date.now() - windowMs);
    return dataPoints.filter(dp => dp.timestamp > cutoffTime);
  }

  /**
   * Check for performance alerts
   */
  checkAlerts(): Array<{ operation: string; alertType: string; message: string; metrics: PerformanceMetrics }> {
    const alerts: Array<{ operation: string; alertType: string; message: string; metrics: PerformanceMetrics }> = [];

    for (const operation of this.operationData.keys()) {
      const recentData = this.getRecentData(operation);
      
      if (recentData.length < this.alertConfig.minSampleSize) {
        continue; // Not enough data for reliable alerting
      }

      const metrics = this.getMetrics(operation);
      if (!metrics) {
        continue;
      }

      // Check success rate
      if (metrics.successRate < this.alertConfig.minSuccessRate) {
        alerts.push({
          operation,
          alertType: 'LOW_SUCCESS_RATE',
          message: `Success rate (${metrics.successRate.toFixed(2)}%) is below threshold (${this.alertConfig.minSuccessRate}%)`,
          metrics,
        });
      }

      // Check error rate
      const errorRate = (metrics.failureCount / metrics.totalCount) * 100;
      if (errorRate > this.alertConfig.maxErrorRate) {
        alerts.push({
          operation,
          alertType: 'HIGH_ERROR_RATE',
          message: `Error rate (${errorRate.toFixed(2)}%) is above threshold (${this.alertConfig.maxErrorRate}%)`,
          metrics,
        });
      }

      // Check average response time
      if (metrics.averageTime > this.alertConfig.maxAverageResponseTime) {
        alerts.push({
          operation,
          alertType: 'HIGH_RESPONSE_TIME',
          message: `Average response time (${metrics.averageTime.toFixed(2)}ms) is above threshold (${this.alertConfig.maxAverageResponseTime}ms)`,
          metrics,
        });
      }
    }

    return alerts;
  }

  /**
   * Clear metrics for an operation
   */
  clearMetrics(operation: string): void {
    this.operationData.delete(operation);
    this.logger.info('Cleared metrics for operation', { operation });
  }

  /**
   * Clear all metrics
   */
  clearAllMetrics(): void {
    this.operationData.clear();
    this.logger.info('Cleared all performance metrics');
  }

  /**
   * Get system health summary
   */
  getHealthSummary(): {
    totalOperations: number;
    operationsWithAlerts: number;
    overallSuccessRate: number;
    averageResponseTime: number;
    activeTimers: number;
  } {
    const allMetrics = this.getAllMetrics();
    const operations = Object.values(allMetrics);
    
    if (operations.length === 0) {
      return {
        totalOperations: 0,
        operationsWithAlerts: 0,
        overallSuccessRate: 100,
        averageResponseTime: 0,
        activeTimers: this.activeTimers.size,
      };
    }

    const totalSuccesses = operations.reduce((sum, m) => sum + m.successCount, 0);
    const totalOperations = operations.reduce((sum, m) => sum + m.totalCount, 0);
    const totalResponseTime = operations.reduce((sum, m) => sum + (m.averageTime * m.successCount), 0);
    
    const alerts = this.checkAlerts();
    const operationsWithAlerts = new Set(alerts.map(a => a.operation)).size;

    return {
      totalOperations: operations.length,
      operationsWithAlerts,
      overallSuccessRate: totalOperations > 0 ? (totalSuccesses / totalOperations) * 100 : 100,
      averageResponseTime: totalSuccesses > 0 ? totalResponseTime / totalSuccesses : 0,
      activeTimers: this.activeTimers.size,
    };
  }

  /**
   * Destroy the performance monitor and clean up resources
   */
  destroy(): void {
    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
      this.alertCheckInterval = null;
    }
    
    this.activeTimers.clear();
    this.operationData.clear();
    
    this.logger.info('Performance monitor destroyed');
  }

  /**
   * Start alert monitoring
   */
  private startAlertMonitoring(): void {
    // Check for alerts every minute
    this.alertCheckInterval = setInterval(() => {
      try {
        const alerts = this.checkAlerts();
        
        if (alerts.length > 0) {
          this.logger.warn('Performance alerts detected', {
            alertCount: alerts.length,
            alerts: alerts.map(a => ({
              operation: a.operation,
              alertType: a.alertType,
              message: a.message,
            })),
          });
        }
      } catch (error) {
        this.logger.error('Error checking performance alerts', error as Error);
      }
    }, 60000); // Check every minute

    // Ensure the timer doesn't keep the process alive
    this.alertCheckInterval.unref();
  }

  /**
   * Categorize error for metrics
   */
  private categorizeError(error: Error): ErrorCategory {
    // This is a simplified categorization - in a real implementation,
    // you might want to use the same logic as in the error recovery service
    if (error.name.includes('Timeout')) {
      return ErrorCategory.TIMEOUT;
    }
    if (error.name.includes('Auth')) {
      return ErrorCategory.AUTHENTICATION;
    }
    if (error.name.includes('Validation')) {
      return ErrorCategory.VALIDATION;
    }
    if (error.name.includes('NotFound')) {
      return ErrorCategory.NOT_FOUND;
    }
    
    return ErrorCategory.SERVER_ERROR;
  }
}

/**
 * Default performance monitor instance
 */
export const performanceMonitor = new PerformanceMonitorService();

/**
 * Create performance monitor with custom configuration
 */
export function createPerformanceMonitor(config: Partial<AlertConfig> = {}): PerformanceMonitorService {
  return new PerformanceMonitorService(config);
}
