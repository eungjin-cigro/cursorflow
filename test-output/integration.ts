/**
 * Integration module that combines API utilities and UI components
 * 
 * This module demonstrates the integration of backend API services
 * with frontend UI components for a complete application layer.
 */

// Import API utilities from the backend module
import { api, get, post, put, del } from './api';
import type { ApiResponse, ApiError, RequestConfig } from './api';

// Import UI components from the frontend module
import { Button } from './Button';
import type { default as ButtonComponent } from './Button';

/**
 * Re-export all API utilities for convenient access
 */
export { api, get, post, put, del };
export type { ApiResponse, ApiError, RequestConfig };

/**
 * Re-export UI components
 */
export { Button };
export type { ButtonComponent };

/**
 * Integration types for combined functionality
 */
export interface IntegrationConfig {
  apiBaseUrl: string;
  defaultHeaders?: Record<string, string>;
  enableLogging?: boolean;
}

export interface IntegrationState {
  isLoading: boolean;
  error: ApiError | null;
  lastResponse: ApiResponse<unknown> | null;
}

/**
 * Default integration configuration
 */
export const DEFAULT_INTEGRATION_CONFIG: IntegrationConfig = {
  apiBaseUrl: '/api',
  defaultHeaders: {
    'Content-Type': 'application/json',
  },
  enableLogging: false,
};

/**
 * Creates an integrated API client with logging and error handling
 */
export function createIntegratedApi(config: Partial<IntegrationConfig> = {}) {
  const mergedConfig = { ...DEFAULT_INTEGRATION_CONFIG, ...config };
  
  const log = (message: string, data?: unknown) => {
    if (mergedConfig.enableLogging) {
      console.log(`[Integration] ${message}`, data ?? '');
    }
  };

  return {
    async fetch<T>(endpoint: string): Promise<ApiResponse<T>> {
      log('GET request', { endpoint });
      const response = await get<T>(endpoint, {
        baseUrl: mergedConfig.apiBaseUrl,
        headers: mergedConfig.defaultHeaders,
      });
      log('GET response', response);
      return response;
    },

    async send<T, R>(endpoint: string, data: T): Promise<ApiResponse<R>> {
      log('POST request', { endpoint, data });
      const response = await post<T, R>(endpoint, data, {
        baseUrl: mergedConfig.apiBaseUrl,
        headers: mergedConfig.defaultHeaders,
      });
      log('POST response', response);
      return response;
    },

    async update<T, R>(endpoint: string, data: T): Promise<ApiResponse<R>> {
      log('PUT request', { endpoint, data });
      const response = await put<T, R>(endpoint, data, {
        baseUrl: mergedConfig.apiBaseUrl,
        headers: mergedConfig.defaultHeaders,
      });
      log('PUT response', response);
      return response;
    },

    async remove<T>(endpoint: string): Promise<ApiResponse<T>> {
      log('DELETE request', { endpoint });
      const response = await del<T>(endpoint, {
        baseUrl: mergedConfig.apiBaseUrl,
        headers: mergedConfig.defaultHeaders,
      });
      log('DELETE response', response);
      return response;
    },

    /**
     * Reference to the Button component for UI rendering
     */
    Button,
  };
}

/**
 * Default integrated API instance
 */
export const integratedApi = createIntegratedApi();

/**
 * Version info for this integration module
 */
export const INTEGRATION_VERSION = '1.0.0';

export default {
  api: integratedApi,
  Button,
  version: INTEGRATION_VERSION,
  createIntegratedApi,
};
