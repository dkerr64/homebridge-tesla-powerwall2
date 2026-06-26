import type { Logging } from 'homebridge';
import { Agent, type Dispatcher, fetch, type Response } from 'undici';
import type { MetersAggregatesResponse, SystemStatusResponse, GridStatusResponse } from '../types.js';
import { Semaphore } from 'semaphore-promise';

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

export interface HttpClientOptions {
  dispatcher?: Dispatcher;
  autoStartLogin?: boolean;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_SHARED_CACHE_MS = 3000;
const MIN_AUTH_INTERVAL_MS = 5000;
const AUTH_REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 11;

export class HttpClient {
  private readonly baseUrl: string;
  private readonly dispatcher: Dispatcher;
  private readonly ownsDispatcher: boolean;
  private readonly cache: Map<string, CacheEntry> = new Map();
  private sessionCookies: string = '';
  private lastAuthAttempt: number = 0;
  private authInProgress: Promise<void> | null = null;
  private loginIntervalId: NodeJS.Timeout | null = null;
  private httpGetSemaphore = new Semaphore();

  constructor(
    private readonly ip: string,
    private readonly port: string,
    private readonly username: string,
    private readonly password: string,
    private readonly log: Logging,
    options: HttpClientOptions = {},
  ) {
    this.baseUrl = port ? `https://${ip}:${port}` : `https://${ip}`;

    if (options.dispatcher) {
      this.dispatcher = options.dispatcher;
      this.ownsDispatcher = false;
    } else {
      this.dispatcher = new Agent({
        connect: { rejectUnauthorized: false },
      });
      this.ownsDispatcher = true;
    }

    if (options.autoStartLogin !== false) {
      this.startLoginProcess().catch(error => {
        this.log.error('Failed to start login process:', error);
      });
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.sessionCookies) {
      this.log.debug('No session cookies, authenticating...');
      await this.authenticateWithRateLimit();
    }
  }

  clearSession(): void {
    this.sessionCookies = '';
    this.log.debug('Session cookies cleared');
  }

  private async authenticateWithRateLimit(): Promise<void> {
    if (this.authInProgress) {
      this.log.debug('Authentication already in progress, waiting...');
      return this.authInProgress;
    }

    const timeSinceLastAuth = Date.now() - this.lastAuthAttempt;
    if (timeSinceLastAuth < MIN_AUTH_INTERVAL_MS) {
      const waitTime = MIN_AUTH_INTERVAL_MS - timeSinceLastAuth;
      this.log.debug(`Rate limiting: waiting ${waitTime}ms before authentication`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.authInProgress = this.authenticate();
    this.lastAuthAttempt = Date.now();

    try {
      await this.authInProgress;
    } finally {
      this.authInProgress = null;
    }
  }

  private async makeRequest(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: unknown,
    cacheInterval?: number,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${endpoint}`;

    if (method === 'GET' && cacheInterval) {
      const cached = this.cache.get(url);
      if (cached && (Date.now() - cached.timestamp) < cacheInterval) {
        return cached.data;
      }
    }

    if (endpoint !== '/api/login/Basic') {
      await this.ensureAuthenticated();
    }

    return this.executeRequestWithRetry(method, url, endpoint, body, cacheInterval);
  }

  private async executeRequestWithRetry(
    method: 'GET' | 'POST',
    url: string,
    endpoint: string,
    body?: unknown,
    cacheInterval?: number,
    isRetry: boolean = false,
  ): Promise<unknown> {
    const response = await this.executeSingleRequest(method, url, body);

    if (response.status === 429) {
      if (isRetry) {
        throw new Error('Rate limit retry failed');
      }
      const retryAfter = response.headers.get('retry-after') || '30';
      const waitTime = parseInt(retryAfter, 10) * 1000;
      this.log.warn(`Rate limited (429) on ${method}, waiting ${waitTime}ms before retry`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.executeRequestWithRetry(method, url, endpoint, body, cacheInterval, true);
    }

    if (response.status === 401 && !isRetry && endpoint !== '/api/login/Basic') {
      this.log.debug('Received 401, re-authenticating...');
      this.sessionCookies = '';
      await this.authenticateWithRateLimit();
      return this.executeRequestWithRetry(method, url, endpoint, body, cacheInterval, true);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (endpoint === '/api/login/Basic') {
      this.extractAndStoreCookies(response);
    }

    const data = await response.json();

    if (method === 'GET' && cacheInterval) {
      this.cache.set(url, { data, timestamp: Date.now() });
    }

    return data;
  }

  private async executeSingleRequest(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {};

    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }
    if (this.sessionCookies) {
      headers.Cookie = this.sessionCookies;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, {
        method,
        headers,
        dispatcher: this.dispatcher,
        signal: controller.signal,
        body: method === 'POST' && body ? JSON.stringify(body) : undefined,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private extractAndStoreCookies(response: Response): void {
    const cookieValues = response.headers.getSetCookie();
    if (cookieValues.length === 0) {
      this.log.warn('No session cookies received from login response');
      return;
    }
    this.sessionCookies = cookieValues
      .map(cookie => cookie.split(';')[0]?.trim() ?? '')
      .filter(pair => pair.length > 0)
      .join('; ');
    this.log.debug('Session cookies updated:', this.sessionCookies.length > 0 ? 'Success' : 'Empty');
  }

  async get(endpoint: string, cacheInterval?: number): Promise<unknown> {
    if (cacheInterval) {
      // If we are using a cache, we need to acquire a semaphore to ensure that only
      // one request is made at a time... allowing cache to be properly initialized.
      const releaseSemaphore = await this.httpGetSemaphore.acquire();
      try {
        return await this.makeRequest('GET', endpoint, undefined, cacheInterval);
      } catch (error) {
        this.log.error(`Error fetching ${endpoint}:`, error);
        throw error;
      } finally {
        releaseSemaphore();
      }
    } else {
      return this.makeRequest('GET', endpoint, undefined, cacheInterval);
    }
  }

  async post(endpoint: string, body: unknown): Promise<unknown> {
    return this.makeRequest('POST', endpoint, body);
  }

  private async startLoginProcess(): Promise<void> {
    try {
      await this.authenticateWithRateLimit();
    } catch (error) {
      this.log.error('Initial authentication failed:', error);
    }

    this.loginIntervalId = setInterval(async () => {
      try {
        await this.authenticateWithRateLimit();
      } catch (error) {
        this.log.error('Periodic authentication failed:', error);
      }
    }, AUTH_REFRESH_INTERVAL_MS);
  }

  destroy(): void {
    if (this.loginIntervalId) {
      clearInterval(this.loginIntervalId);
      this.loginIntervalId = null;
    }
    this.cache.clear();
    this.sessionCookies = '';
    if (this.ownsDispatcher) {
      this.dispatcher.close().catch(() => { /* ignore */ });
    }
  }

  async authenticate(): Promise<void> {
    try {
      // Bypass the wrapper here to avoid an ensureAuthenticated recursion.
      const url = `${this.baseUrl}/api/login/Basic`;
      await this.executeRequestWithRetry('POST', url, '/api/login/Basic', {
        username: this.username,
        password: this.password,
      });
      this.log.debug('Tesla Powerwall authentication successful');
    } catch (error) {
      this.log.error('Tesla Powerwall authentication failed:', error);
      throw error;
    }
  }

  async getSystemStatus(cacheMs: number = DEFAULT_SHARED_CACHE_MS): Promise<SystemStatusResponse> {
    return this.get('/api/system_status/soe', cacheMs) as Promise<SystemStatusResponse>;
  }

  async getMetersAggregates(cacheMs: number = DEFAULT_SHARED_CACHE_MS): Promise<MetersAggregatesResponse> {
    return this.get('/api/meters/aggregates', cacheMs) as Promise<MetersAggregatesResponse>;
  }

  async getSiteMaster(cacheMs: number = DEFAULT_SHARED_CACHE_MS): Promise<unknown> {
    return this.get('/api/sitemaster', cacheMs);
  }

  async getGridStatus(cacheMs: number = DEFAULT_SHARED_CACHE_MS): Promise<GridStatusResponse> {
    return this.get('/api/system_status/grid_status', cacheMs) as Promise<GridStatusResponse>;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getSystemStatus(0);
      return true;
    } catch (error) {
      this.log.error('Connection test failed:', error);
      return false;
    }
  }
}
