/**
 * Integration module that combines API utilities and Button component
 * 
 * This file demonstrates integration between the API layer (api.ts)
 * and the UI layer (Button.tsx) for test-output purposes.
 */

// Import from api.ts
import {
  fetchData,
  postData,
  createEndpoint,
  API_BASE_URL,
  type ApiResponse,
  type ApiError,
} from './api';

// Import from Button.tsx
import {
  Button,
  type ButtonProps,
  type ButtonVariant,
} from './Button';

/**
 * Integrated data fetching with UI state management
 */
export interface IntegrationState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Create an integrated fetch handler for Button onClick
 */
export function createFetchHandler<T>(
  endpoint: string,
  onSuccess: (response: ApiResponse<T>) => void,
  onError: (error: ApiError) => void
): () => Promise<void> {
  return async () => {
    try {
      const fullUrl = createEndpoint(endpoint);
      const response = await fetchData<T>(fullUrl);
      
      if (response.status >= 200 && response.status < 300) {
        onSuccess(response);
      } else {
        onError({
          code: `HTTP_${response.status}`,
          message: response.message,
        });
      }
    } catch (err) {
      onError({
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };
}

/**
 * Create an integrated submit handler for Button onClick with POST
 */
export function createSubmitHandler<T, R>(
  endpoint: string,
  getPayload: () => T,
  onSuccess: (response: ApiResponse<R>) => void,
  onError: (error: ApiError) => void
): () => Promise<void> {
  return async () => {
    try {
      const fullUrl = createEndpoint(endpoint);
      const payload = getPayload();
      const response = await postData<T, R>(fullUrl, payload);
      
      if (response.status >= 200 && response.status < 300) {
        onSuccess(response);
      } else {
        onError({
          code: `HTTP_${response.status}`,
          message: response.message,
        });
      }
    } catch (err) {
      onError({
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };
}

/**
 * Button props factory for common API action patterns
 */
export function createApiButtonProps(
  label: string,
  variant: ButtonVariant,
  handler: () => Promise<void>,
  loading: boolean
): ButtonProps {
  return {
    label,
    variant,
    onClick: handler,
    loading,
    disabled: loading,
  };
}

// Re-export all imports for convenience
export {
  // From api.ts
  fetchData,
  postData,
  createEndpoint,
  API_BASE_URL,
  type ApiResponse,
  type ApiError,
  // From Button.tsx
  Button,
  type ButtonProps,
  type ButtonVariant,
};

/**
 * Integration module version
 */
export const INTEGRATION_VERSION = '1.0.0';
