/**
 * API utilities for test-output integration
 */

export interface ApiResponse<T> {
  data: T;
  status: number;
  message: string;
}

export interface ApiError {
  code: string;
  message: string;
}

/**
 * Fetch data from API endpoint
 */
export async function fetchData<T>(endpoint: string): Promise<ApiResponse<T>> {
  const response = await fetch(endpoint);
  const data = await response.json();
  return {
    data: data as T,
    status: response.status,
    message: response.ok ? 'Success' : 'Error',
  };
}

/**
 * Post data to API endpoint
 */
export async function postData<T, R>(
  endpoint: string,
  payload: T
): Promise<ApiResponse<R>> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  return {
    data: data as R,
    status: response.status,
    message: response.ok ? 'Success' : 'Error',
  };
}

/**
 * API base URL configuration
 */
export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

/**
 * Create API endpoint URL
 */
export function createEndpoint(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
