import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * Interface for proxy device mapping document
 */
export interface IProxyDeviceMapping extends Document {
  deviceId: string;
  proxyId: string;
  proxyConfig: {
    country: string;
    city?: string;
    carrier?: string;
    networkType: '3G' | '4G' | '5G';
    endpoint: string;
    port: number;
  };
  status: 'active' | 'inactive' | 'failed';
  healthMetrics: {
    responseTime?: number;
    successRate?: number;
    lastSuccessfulConnection?: Date;
    lastFailedConnection?: Date;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
  };
  assignedAt: Date;
  lastUsed?: Date;
  failureCount: number;
  maxFailures: number;
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  recordSuccess(responseTime?: number): void;
  recordFailure(error?: string): void;
  isHealthy(): boolean;
  getProxyUrl(username: string, password: string, protocol?: 'http' | 'socks5'): string;
}

/**
 * Interface for static methods
 */
export interface IProxyDeviceMappingModel extends Model<IProxyDeviceMapping> {
  findActiveByDevice(deviceId: string): Promise<IProxyDeviceMapping | null>;
  findByCountry(country: string, status?: string): Promise<IProxyDeviceMapping[]>;
  getHealthyProxies(): Promise<IProxyDeviceMapping[]>;
  cleanupInactiveProxies(olderThanDays?: number): Promise<any>;
  getProxyStats(): Promise<any[]>;
}

/**
 * Schema for proxy device mapping
 */
const proxyDeviceMappingSchema = new Schema<IProxyDeviceMapping>(
  {
    deviceId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    proxyId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    proxyConfig: {
      country: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
      },
      city: {
        type: String,
        trim: true,
      },
      carrier: {
        type: String,
        trim: true,
      },
      networkType: {
        type: String,
        enum: ['3G', '4G', '5G'],
        default: '4G',
      },
      endpoint: {
        type: String,
        required: true,
        trim: true,
      },
      port: {
        type: Number,
        required: true,
        min: 1,
        max: 65535,
      },
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'failed'],
      default: 'active',
      index: true,
    },
    healthMetrics: {
      responseTime: {
        type: Number,
        min: 0,
      },
      successRate: {
        type: Number,
        min: 0,
        max: 1,
      },
      lastSuccessfulConnection: {
        type: Date,
      },
      lastFailedConnection: {
        type: Date,
      },
      totalRequests: {
        type: Number,
        default: 0,
        min: 0,
      },
      successfulRequests: {
        type: Number,
        default: 0,
        min: 0,
      },
      failedRequests: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    assignedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastUsed: {
      type: Date,
      index: true,
    },
    failureCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxFailures: {
      type: Number,
      default: 5,
      min: 1,
    },
  },
  {
    timestamps: true,
    collection: 'proxy_device_mappings',
  }
);

// Compound indexes for efficient queries
proxyDeviceMappingSchema.index({ deviceId: 1, status: 1 });
proxyDeviceMappingSchema.index({ proxyId: 1, status: 1 });
proxyDeviceMappingSchema.index({ 'proxyConfig.country': 1, status: 1 });
proxyDeviceMappingSchema.index({ assignedAt: 1 });
proxyDeviceMappingSchema.index({ lastUsed: 1 });

// Ensure only one active proxy per device
proxyDeviceMappingSchema.index(
  { deviceId: 1, status: 1 },
  { 
    unique: true,
    partialFilterExpression: { status: 'active' }
  }
);

/**
 * Pre-save middleware to update health metrics
 */
proxyDeviceMappingSchema.pre('save', function(next) {
  // Calculate success rate if we have requests
  if (this.healthMetrics.totalRequests > 0) {
    this.healthMetrics.successRate = 
      this.healthMetrics.successfulRequests / this.healthMetrics.totalRequests;
  }

  // Mark as failed if failure count exceeds max failures
  if (this.failureCount >= this.maxFailures && this.status === 'active') {
    this.status = 'failed';
  }

  next();
});

/**
 * Instance methods
 */
proxyDeviceMappingSchema.methods.recordSuccess = function(responseTime?: number) {
  this.healthMetrics.totalRequests++;
  this.healthMetrics.successfulRequests++;
  this.healthMetrics.lastSuccessfulConnection = new Date();
  this.lastUsed = new Date();
  
  if (responseTime !== undefined) {
    // Calculate moving average of response time
    if (this.healthMetrics.responseTime) {
      this.healthMetrics.responseTime = 
        (this.healthMetrics.responseTime + responseTime) / 2;
    } else {
      this.healthMetrics.responseTime = responseTime;
    }
  }

  // Reset failure count on success
  this.failureCount = 0;
  
  if (this.status === 'failed') {
    this.status = 'active';
  }
};

proxyDeviceMappingSchema.methods.recordFailure = function(error?: string) {
  this.healthMetrics.totalRequests++;
  this.healthMetrics.failedRequests++;
  this.healthMetrics.lastFailedConnection = new Date();
  this.failureCount++;
  
  // Mark as failed if failure count exceeds threshold
  if (this.failureCount >= this.maxFailures) {
    this.status = 'failed';
  }
};

proxyDeviceMappingSchema.methods.isHealthy = function(): boolean {
  if (this.status !== 'active') {
    return false;
  }

  // Consider healthy if success rate is above 70%
  if (this.healthMetrics.totalRequests > 10) {
    return (this.healthMetrics.successRate || 0) >= 0.7;
  }

  // If not enough data, consider healthy if not failed recently
  return this.failureCount < this.maxFailures;
};

proxyDeviceMappingSchema.methods.getProxyUrl = function(username: string, password: string, protocol: 'http' | 'socks5' = 'http'): string {
  return `${protocol}://${username}:${password}@${this.proxyConfig.endpoint}:${this.proxyConfig.port}`;
};

/**
 * Static methods
 */
proxyDeviceMappingSchema.statics.findActiveByDevice = function(deviceId: string) {
  return this.findOne({ deviceId, status: 'active' });
};

proxyDeviceMappingSchema.statics.findByCountry = function(country: string, status: string = 'active') {
  return this.find({ 'proxyConfig.country': country.toUpperCase(), status });
};

proxyDeviceMappingSchema.statics.getHealthyProxies = function() {
  return this.find({
    status: 'active',
    failureCount: { $lt: 5 },
    $or: [
      { 'healthMetrics.totalRequests': { $lte: 10 } },
      { 'healthMetrics.successRate': { $gte: 0.7 } }
    ]
  });
};

proxyDeviceMappingSchema.statics.cleanupInactiveProxies = function(olderThanDays: number = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  
  return this.deleteMany({
    status: 'inactive',
    lastUsed: { $lt: cutoffDate }
  });
};

proxyDeviceMappingSchema.statics.getProxyStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgResponseTime: { $avg: '$healthMetrics.responseTime' },
        avgSuccessRate: { $avg: '$healthMetrics.successRate' }
      }
    }
  ]);
};

/**
 * Virtual for proxy health status
 */
proxyDeviceMappingSchema.virtual('healthStatus').get(function(this: IProxyDeviceMapping) {
  return {
    isHealthy: this.isHealthy(),
    successRate: this.healthMetrics.successRate || 0,
    responseTime: this.healthMetrics.responseTime || 0,
    uptime: this.healthMetrics.totalRequests > 0 ?
      (this.healthMetrics.successfulRequests / this.healthMetrics.totalRequests) * 100 : 0
  };
});

// Ensure virtual fields are serialized
proxyDeviceMappingSchema.set('toJSON', { virtuals: true });
proxyDeviceMappingSchema.set('toObject', { virtuals: true });

/**
 * Export the model
 */
const ProxyDeviceMapping = mongoose.model<IProxyDeviceMapping, IProxyDeviceMappingModel>('ProxyDeviceMapping', proxyDeviceMappingSchema);

export default ProxyDeviceMapping;
