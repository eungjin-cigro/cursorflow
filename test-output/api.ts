/**
 * API utility module for making HTTP requests
 */

export interface ApiResponse<T> {
  data: T;
  status: number;
  message?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RequestConfig {
  baseUrl?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

const DEFAULT_CONFIG: RequestConfig = {
  baseUrl: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
};

/**
 * Makes a GET request to the specified endpoint
 */
export async function get<T>(
  endpoint: string,
  config: RequestConfig = {}
): Promise<ApiResponse<T>> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const url = `${mergedConfig.baseUrl}${endpoint}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: mergedConfig.headers,
  });
  
  const data = await response.json();
  
  return {
    data,
    status: response.status,
    message: response.statusText,
  };
}

/**
 * Makes a POST request to the specified endpoint
 */
export async function post<T, R>(
  endpoint: string,
  body: T,
  config: RequestConfig = {}
): Promise<ApiResponse<R>> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const url = `${mergedConfig.baseUrl}${endpoint}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: mergedConfig.headers,
    body: JSON.stringify(body),
  });
  
  const data = await response.json();
  
  return {
    data,
    status: response.status,
    message: response.statusText,
  };
}

/**
 * Makes a PUT request to the specified endpoint
 */
export async function put<T, R>(
  endpoint: string,
  body: T,
  config: RequestConfig = {}
): Promise<ApiResponse<R>> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const url = `${mergedConfig.baseUrl}${endpoint}`;
  
  const response = await fetch(url, {
    method: 'PUT',
    headers: mergedConfig.headers,
    body: JSON.stringify(body),
  });
  
  const data = await response.json();
  
  return {
    data,
    status: response.status,
    message: response.statusText,
  };
}

/**
 * Makes a DELETE request to the specified endpoint
 */
export async function del<T>(
  endpoint: string,
  config: RequestConfig = {}
): Promise<ApiResponse<T>> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const url = `${mergedConfig.baseUrl}${endpoint}`;
  
  const response = await fetch(url, {
    method: 'DELETE',
    headers: mergedConfig.headers,
  });
  
  const data = await response.json();
  
  return {
    data,
    status: response.status,
    message: response.statusText,
  };
}

/**
 * API client with all HTTP methods
 */
export const api = {
  get,
  post,
  put,
  delete: del,
};

export default api;
