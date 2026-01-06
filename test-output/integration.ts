/**
 * Integration module that combines API and UI components
 * 
 * This file demonstrates the integration of backend API functions
 * with frontend UI components.
 */

// Import from backend API
import { hello } from './api';

// Import from frontend component
import { Button } from './Button';

// Re-export for unified access
export { hello, Button };

/**
 * Integration function that uses both API and Button
 * Returns a greeting message from the API
 */
export function getGreeting(): string {
  return hello();
}

/**
 * Configuration for the integrated application
 */
export const IntegrationConfig = {
  apiVersion: '1.0.0',
  componentVersion: '1.0.0',
  features: {
    api: true,
    ui: true,
  },
};

/**
 * Type definitions for integration layer
 */
export interface IntegrationModule {
  greeting: string;
  ButtonComponent: typeof Button;
}

/**
 * Create an integrated module instance
 */
export function createIntegration(): IntegrationModule {
  return {
    greeting: getGreeting(),
    ButtonComponent: Button,
  };
}

export default {
  hello,
  Button,
  getGreeting,
  createIntegration,
  IntegrationConfig,
};
