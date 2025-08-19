import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { createLogger, Logger, LogLevel } from './logger.service';

/**
 * Decodo proxy configuration interface
 */
export interface DecodoProxyConfig {
  /** Decodo API credentials */
  username: string;
  password: string;
  
  /** Proxy endpoint configuration */
  endpoint: string;
  port: number;
  
  /** Connection settings */
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  
  /** Retry configuration */
  maxRetries: number;
  retryDelayMs: number;
  
  /** Health check settings */
  healthCheckIntervalMs: number;
  healthCheckTimeoutMs: number;
  
  /** Logging configuration */
  enableLogging: boolean;
}

/**
 * Proxy information interface
 */
export interface ProxyInfo {
  id: string;
  country: string;
  city?: string;
  carrier?: string;
  networkType: '3G' | '4G' | '5G';
  endpoint: string;
  port: number;
  isActive: boolean;
  lastUsed?: Date;
  responseTime?: number;
  successRate?: number;
}

/**
 * Proxy selection criteria
 */
export interface ProxySelectionCriteria {
  country: string;
  city?: string;
  carrier?: string;
  networkType?: '3G' | '4G' | '5G';
  excludeProxies?: string[];
}

/**
 * Proxy health status
 */
export interface ProxyHealthStatus {
  isHealthy: boolean;
  responseTime: number;
  lastChecked: Date;
  errorCount: number;
  successCount: number;
}

/**
 * Default configuration for Decodo proxy service
 */
const DEFAULT_CONFIG: Partial<DecodoProxyConfig> = {
  endpoint: 'gate.decodo.com',
  port: 10000,
  connectionTimeoutMs: 30000,
  requestTimeoutMs: 60000,
  maxRetries: 3,
  retryDelayMs: 2000,
  healthCheckIntervalMs: 300000, // 5 minutes
  healthCheckTimeoutMs: 10000,
  enableLogging: true,
};

/**
 * Decodo Mobile Proxy Service
 * Handles proxy selection, health monitoring, and connection management
 */
export class DecodoProxyService {
  private config: DecodoProxyConfig;
  private logger: Logger;
  private httpClient: AxiosInstance;
  private proxyCache: Map<string, ProxyInfo> = new Map();
  private healthStatus: Map<string, ProxyHealthStatus> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<DecodoProxyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config } as DecodoProxyConfig;
    
    if (!this.config.username || !this.config.password) {
      throw new Error('Decodo username and password are required');
    }

    this.logger = createLogger('DecodoProxyService', {
      level: this.config.enableLogging ? LogLevel.DEBUG : LogLevel.INFO,
    });

    this.httpClient = axios.create({
      timeout: this.config.requestTimeoutMs,
      headers: {
        'User-Agent': 'WhatsApp-Provider-Server/1.0.0',
      },
    });

    this.startHealthChecking();
    this.logger.info('Decodo Proxy Service initialized', { 
      endpoint: this.config.endpoint,
      port: this.config.port 
    });
  }

  /**
   * Get proxy for a specific device based on selection criteria
   */
  async getProxyForDevice(deviceId: string, criteria: ProxySelectionCriteria): Promise<ProxyInfo> {
    this.logger.debug('Getting proxy for device', { deviceId, criteria });

    try {
      // Check if we have a cached proxy for this device
      const cachedProxy = this.proxyCache.get(deviceId);
      if (cachedProxy && cachedProxy.isActive && this.isProxyHealthy(cachedProxy.id)) {
        this.logger.debug('Using cached proxy for device', { deviceId, proxyId: cachedProxy.id });
        return cachedProxy;
      }

      // Select new proxy based on criteria
      const proxy = await this.selectProxy(criteria);
      
      // Cache the proxy for this device
      this.proxyCache.set(deviceId, proxy);
      
      this.logger.info('Assigned new proxy to device', { 
        deviceId, 
        proxyId: proxy.id, 
        country: proxy.country,
        networkType: proxy.networkType 
      });

      return proxy;
    } catch (error) {
      this.logger.error('Failed to get proxy for device', error as Error, { deviceId, criteria });
      throw error;
    }
  }

  /**
   * Select proxy based on criteria
   */
  private async selectProxy(criteria: ProxySelectionCriteria): Promise<ProxyInfo> {
    // For Israel/Palestine region, use Israeli proxies
    const targetCountry = this.normalizeCountryForProxy(criteria.country);
    
    // Create proxy info (in real implementation, this would query Decodo's API)
    const proxy: ProxyInfo = {
      id: `proxy-${targetCountry}-${Date.now()}`,
      country: targetCountry,
      city: criteria.city,
      carrier: criteria.carrier,
      networkType: criteria.networkType || '4G',
      endpoint: this.config.endpoint,
      port: this.config.port,
      isActive: true,
      lastUsed: new Date(),
    };

    // Initialize health status
    this.healthStatus.set(proxy.id, {
      isHealthy: true,
      responseTime: 0,
      lastChecked: new Date(),
      errorCount: 0,
      successCount: 0,
    });

    return proxy;
  }

  /**
   * Normalize country code for proxy selection
   */
  private normalizeCountryForProxy(country: string): string {
    const countryMap: Record<string, string> = {
      'IL': 'IL', // Israel
      'PS': 'IL', // Palestine -> use Israeli proxies
      'US': 'US',
      'GB': 'GB',
      'DE': 'DE',
      'FR': 'FR',
      'CA': 'CA',
      'AU': 'AU',
      'JP': 'JP',
      'IN': 'IN',
    };

    return countryMap[country.toUpperCase()] || 'US'; // Default to US if country not found
  }

  /**
   * Create proxy agent for HTTP requests
   */
  createProxyAgent(proxy: ProxyInfo, protocol: 'http' | 'socks5' = 'http'): any {
    const proxyUrl = `${protocol}://${this.config.username}:${this.config.password}@${proxy.endpoint}:${proxy.port}`;
    
    if (protocol === 'socks5') {
      return new SocksProxyAgent(proxyUrl);
    } else {
      return new HttpsProxyAgent(proxyUrl);
    }
  }

  /**
   * Test proxy connection
   */
  async testProxy(proxy: ProxyInfo): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const agent = this.createProxyAgent(proxy);
      const response = await axios.get('https://ip.decodo.com/json', {
        httpsAgent: agent,
        timeout: this.config.healthCheckTimeoutMs,
      });

      const responseTime = Date.now() - startTime;
      
      // Update health status
      const health = this.healthStatus.get(proxy.id);
      if (health) {
        health.isHealthy = true;
        health.responseTime = responseTime;
        health.lastChecked = new Date();
        health.successCount++;
      }

      this.logger.debug('Proxy test successful', { 
        proxyId: proxy.id, 
        responseTime,
        ip: response.data?.ip 
      });

      return true;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // Update health status
      const health = this.healthStatus.get(proxy.id);
      if (health) {
        health.isHealthy = false;
        health.responseTime = responseTime;
        health.lastChecked = new Date();
        health.errorCount++;
      }

      this.logger.warn('Proxy test failed', { 
        proxyId: proxy.id, 
        error: (error as Error).message,
        responseTime 
      });

      return false;
    }
  }

  /**
   * Check if proxy is healthy
   */
  private isProxyHealthy(proxyId: string): boolean {
    const health = this.healthStatus.get(proxyId);
    if (!health) return false;

    // Consider proxy unhealthy if error rate is too high
    const totalRequests = health.successCount + health.errorCount;
    if (totalRequests > 10) {
      const errorRate = health.errorCount / totalRequests;
      if (errorRate > 0.3) { // More than 30% error rate
        return false;
      }
    }

    return health.isHealthy;
  }

  /**
   * Start health checking for all proxies
   */
  private startHealthChecking(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Perform health checks on all active proxies
   */
  private async performHealthChecks(): Promise<void> {
    const activeProxies = Array.from(this.proxyCache.values()).filter(p => p.isActive);
    
    this.logger.debug('Performing health checks', { proxyCount: activeProxies.length });

    const healthCheckPromises = activeProxies.map(async (proxy) => {
      try {
        await this.testProxy(proxy);
      } catch (error) {
        this.logger.warn('Health check failed for proxy', { 
          proxyId: proxy.id, 
          error: (error as Error).message 
        });
      }
    });

    await Promise.allSettled(healthCheckPromises);
  }

  /**
   * Get proxy health status
   */
  getProxyHealth(proxyId: string): ProxyHealthStatus | null {
    return this.healthStatus.get(proxyId) || null;
  }

  /**
   * Remove proxy from cache (force new proxy selection)
   */
  removeProxyFromDevice(deviceId: string): void {
    const proxy = this.proxyCache.get(deviceId);
    if (proxy) {
      proxy.isActive = false;
      this.proxyCache.delete(deviceId);
      this.logger.info('Removed proxy from device', { deviceId, proxyId: proxy.id });
    }
  }

  /**
   * Get all cached proxies
   */
  getAllCachedProxies(): ProxyInfo[] {
    return Array.from(this.proxyCache.values());
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    this.proxyCache.clear();
    this.healthStatus.clear();
    
    this.logger.info('Decodo Proxy Service destroyed');
  }
}

// Singleton instance
let decodoProxyService: DecodoProxyService | null = null;

/**
 * Get or create Decodo proxy service instance
 */
export function getDecodoProxyService(config?: Partial<DecodoProxyConfig>): DecodoProxyService {
  if (!decodoProxyService) {
    if (!config) {
      throw new Error('Decodo proxy service configuration is required for first initialization');
    }
    decodoProxyService = new DecodoProxyService(config);
  }
  return decodoProxyService;
}

/**
 * Destroy the singleton instance
 */
export function destroyDecodoProxyService(): void {
  if (decodoProxyService) {
    decodoProxyService.destroy();
    decodoProxyService = null;
  }
}
