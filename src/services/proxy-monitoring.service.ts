import { EventEmitter } from 'events';
import { createLogger, Logger, LogLevel } from './logger.service';
import { getDecodoProxyService } from './decodo-proxy.service';
import { getMessageQueueService } from './message-queue.service';
import ProxyDeviceMapping from '../models/proxy-device-mapping.model';
import { getProxyConfig, isMonitoringEnabled } from '../config/proxy.config';

/**
 * Monitoring metrics interface
 */
export interface MonitoringMetrics {
  timestamp: Date;
  proxies: {
    total: number;
    active: number;
    failed: number;
    avgResponseTime: number;
    avgSuccessRate: number;
    healthyCount: number;
    unhealthyCount: number;
  };
  messageQueues: {
    totalQueues: number;
    totalPending: number;
    totalCompleted: number;
    totalFailed: number;
    avgProcessingTime: number;
    successRate: number;
    isHealthy: boolean;
  };
  alerts: Alert[];
}

/**
 * Alert interface
 */
export interface Alert {
  id: string;
  type: 'error_rate' | 'response_time' | 'queue_size' | 'proxy_failure';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  deviceId?: string;
  proxyId?: string;
  value: number;
  threshold: number;
  timestamp: Date;
  resolved: boolean;
}

/**
 * Monitoring configuration
 */
interface MonitoringConfig {
  enabled: boolean;
  metricsIntervalMs: number;
  healthCheckIntervalMs: number;
  alertThresholds: {
    errorRate: number;
    responseTime: number;
    queueSize: number;
  };
  enableLogging: boolean;
}

/**
 * Proxy Monitoring Service
 * Monitors proxy performance, queue health, and generates alerts
 */
export class ProxyMonitoringService extends EventEmitter {
  private config: MonitoringConfig;
  private logger: Logger;
  private metricsTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private alerts: Map<string, Alert> = new Map();
  private metrics: MonitoringMetrics[] = [];
  private maxMetricsHistory = 1000; // Keep last 1000 metrics entries

  constructor(config: Partial<MonitoringConfig> = {}) {
    super();
    
    const defaultConfig = getProxyConfig().monitoring;
    this.config = {
      enabled: defaultConfig.enabled,
      metricsIntervalMs: defaultConfig.metricsIntervalMs,
      healthCheckIntervalMs: defaultConfig.healthCheckIntervalMs,
      alertThresholds: defaultConfig.alertThresholds,
      enableLogging: true,
      ...config,
    };

    this.logger = createLogger('ProxyMonitoringService', {
      level: this.config.enableLogging ? LogLevel.DEBUG : LogLevel.INFO,
    });

    if (this.config.enabled) {
      this.start();
    }

    this.logger.info('Proxy Monitoring Service initialized', { 
      enabled: this.config.enabled,
      config: this.config 
    });
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Monitoring is disabled');
      return;
    }

    // Start metrics collection
    this.metricsTimer = setInterval(() => {
      this.collectMetrics();
    }, this.config.metricsIntervalMs);

    // Start health checks
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckIntervalMs);

    this.logger.info('Proxy monitoring started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    this.logger.info('Proxy monitoring stopped');
  }

  /**
   * Collect monitoring metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      const timestamp = new Date();
      
      // Collect proxy metrics
      const proxyMetrics = await this.collectProxyMetrics();
      
      // Collect message queue metrics
      const queueMetrics = await this.collectQueueMetrics();
      
      // Check for alerts
      const alerts = await this.checkAlerts(proxyMetrics, queueMetrics);

      const metrics: MonitoringMetrics = {
        timestamp,
        proxies: proxyMetrics,
        messageQueues: queueMetrics,
        alerts,
      };

      // Store metrics
      this.metrics.push(metrics);
      
      // Limit metrics history
      if (this.metrics.length > this.maxMetricsHistory) {
        this.metrics = this.metrics.slice(-this.maxMetricsHistory);
      }

      // Emit metrics event
      this.emit('metrics', metrics);

      this.logger.debug('Metrics collected', {
        proxies: proxyMetrics,
        queues: queueMetrics,
        alertCount: alerts.length,
      });

    } catch (error) {
      this.logger.error('Error collecting metrics', error as Error);
    }
  }

  /**
   * Collect proxy metrics
   */
  private async collectProxyMetrics(): Promise<MonitoringMetrics['proxies']> {
    try {
      const stats = await ProxyDeviceMapping.getProxyStats();
      const healthyProxies = await ProxyDeviceMapping.getHealthyProxies();
      
      let total = 0;
      let active = 0;
      let failed = 0;
      let avgResponseTime = 0;
      let avgSuccessRate = 0;

      for (const stat of stats) {
        total += stat.count;
        if (stat._id === 'active') {
          active = stat.count;
          avgResponseTime = stat.avgResponseTime || 0;
          avgSuccessRate = stat.avgSuccessRate || 0;
        } else if (stat._id === 'failed') {
          failed = stat.count;
        }
      }

      return {
        total,
        active,
        failed,
        avgResponseTime,
        avgSuccessRate,
        healthyCount: healthyProxies.length,
        unhealthyCount: active - healthyProxies.length,
      };
    } catch (error) {
      this.logger.error('Error collecting proxy metrics', error as Error);
      return {
        total: 0,
        active: 0,
        failed: 0,
        avgResponseTime: 0,
        avgSuccessRate: 0,
        healthyCount: 0,
        unhealthyCount: 0,
      };
    }
  }

  /**
   * Collect message queue metrics
   */
  private async collectQueueMetrics(): Promise<MonitoringMetrics['messageQueues']> {
    try {
      const messageQueueService = getMessageQueueService();
      const queueHealth = messageQueueService.getQueueHealth();
      
      return {
        totalQueues: queueHealth.totalQueues,
        totalPending: queueHealth.totalPending,
        totalCompleted: queueHealth.totalCompleted,
        totalFailed: queueHealth.totalFailed,
        avgProcessingTime: queueHealth.avgProcessingTime,
        successRate: queueHealth.successRate,
        isHealthy: queueHealth.isHealthy,
      };
    } catch (error) {
      this.logger.error('Error collecting queue metrics', error as Error);
      return {
        totalQueues: 0,
        totalPending: 0,
        totalCompleted: 0,
        totalFailed: 0,
        avgProcessingTime: 0,
        successRate: 0,
        isHealthy: false,
      };
    }
  }

  /**
   * Check for alerts based on metrics
   */
  private async checkAlerts(
    proxyMetrics: MonitoringMetrics['proxies'],
    queueMetrics: MonitoringMetrics['messageQueues']
  ): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const timestamp = new Date();

    // Check proxy error rate
    if (proxyMetrics.avgSuccessRate < (1 - this.config.alertThresholds.errorRate)) {
      const alert: Alert = {
        id: `proxy-error-rate-${timestamp.getTime()}`,
        type: 'error_rate',
        severity: 'high',
        message: `Proxy error rate is high: ${((1 - proxyMetrics.avgSuccessRate) * 100).toFixed(2)}%`,
        value: 1 - proxyMetrics.avgSuccessRate,
        threshold: this.config.alertThresholds.errorRate,
        timestamp,
        resolved: false,
      };
      alerts.push(alert);
      this.alerts.set(alert.id, alert);
    }

    // Check proxy response time
    if (proxyMetrics.avgResponseTime > this.config.alertThresholds.responseTime) {
      const alert: Alert = {
        id: `proxy-response-time-${timestamp.getTime()}`,
        type: 'response_time',
        severity: 'medium',
        message: `Proxy response time is high: ${proxyMetrics.avgResponseTime}ms`,
        value: proxyMetrics.avgResponseTime,
        threshold: this.config.alertThresholds.responseTime,
        timestamp,
        resolved: false,
      };
      alerts.push(alert);
      this.alerts.set(alert.id, alert);
    }

    // Check queue size
    if (queueMetrics.totalPending > this.config.alertThresholds.queueSize) {
      const alert: Alert = {
        id: `queue-size-${timestamp.getTime()}`,
        type: 'queue_size',
        severity: 'medium',
        message: `Message queue size is high: ${queueMetrics.totalPending} pending messages`,
        value: queueMetrics.totalPending,
        threshold: this.config.alertThresholds.queueSize,
        timestamp,
        resolved: false,
      };
      alerts.push(alert);
      this.alerts.set(alert.id, alert);
    }

    // Check queue health
    if (!queueMetrics.isHealthy) {
      const alert: Alert = {
        id: `queue-health-${timestamp.getTime()}`,
        type: 'error_rate',
        severity: 'high',
        message: `Message queue is unhealthy: ${(queueMetrics.successRate * 100).toFixed(2)}% success rate`,
        value: 1 - queueMetrics.successRate,
        threshold: this.config.alertThresholds.errorRate,
        timestamp,
        resolved: false,
      };
      alerts.push(alert);
      this.alerts.set(alert.id, alert);
    }

    // Emit alerts
    for (const alert of alerts) {
      this.emit('alert', alert);
      this.logger.warn('Alert generated', alert);
    }

    return alerts;
  }

  /**
   * Perform health checks
   */
  private async performHealthChecks(): Promise<void> {
    try {
      this.logger.debug('Performing health checks');

      // Check proxy service health
      const proxyService = getDecodoProxyService();
      const cachedProxies = proxyService.getAllCachedProxies();
      
      for (const proxy of cachedProxies) {
        try {
          const isHealthy = await proxyService.testProxy(proxy);
          if (!isHealthy) {
            const alert: Alert = {
              id: `proxy-failure-${proxy.id}-${Date.now()}`,
              type: 'proxy_failure',
              severity: 'medium',
              message: `Proxy ${proxy.id} failed health check`,
              proxyId: proxy.id,
              value: 0,
              threshold: 1,
              timestamp: new Date(),
              resolved: false,
            };
            this.alerts.set(alert.id, alert);
            this.emit('alert', alert);
          }
        } catch (error) {
          this.logger.warn('Error testing proxy health', { 
            proxyId: proxy.id, 
            error: (error as Error).message 
          });
        }
      }

    } catch (error) {
      this.logger.error('Error performing health checks', error as Error);
    }
  }

  /**
   * Get current metrics
   */
  getCurrentMetrics(): MonitoringMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(limit?: number): MonitoringMetrics[] {
    if (limit) {
      return this.metrics.slice(-limit);
    }
    return [...this.metrics];
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter(alert => !alert.resolved);
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      this.emit('alertResolved', alert);
      this.logger.info('Alert resolved', { alertId });
      return true;
    }
    return false;
  }

  /**
   * Get monitoring status
   */
  getStatus(): {
    enabled: boolean;
    running: boolean;
    activeAlerts: number;
    lastMetricsTime?: Date;
  } {
    const currentMetrics = this.getCurrentMetrics();
    return {
      enabled: this.config.enabled,
      running: this.metricsTimer !== null,
      activeAlerts: this.getActiveAlerts().length,
      lastMetricsTime: currentMetrics?.timestamp,
    };
  }

  /**
   * Cleanup and destroy service
   */
  destroy(): void {
    this.stop();
    this.alerts.clear();
    this.metrics = [];
    this.removeAllListeners();
    this.logger.info('Proxy Monitoring Service destroyed');
  }
}

// Singleton instance
let proxyMonitoringService: ProxyMonitoringService | null = null;

/**
 * Get or create proxy monitoring service instance
 */
export function getProxyMonitoringService(config?: Partial<MonitoringConfig>): ProxyMonitoringService {
  if (!proxyMonitoringService) {
    proxyMonitoringService = new ProxyMonitoringService(config);
  }
  return proxyMonitoringService;
}

/**
 * Destroy the singleton instance
 */
export function destroyProxyMonitoringService(): void {
  if (proxyMonitoringService) {
    proxyMonitoringService.destroy();
    proxyMonitoringService = null;
  }
}
