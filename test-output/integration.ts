/**
 * Integration module that combines API and UI components
 * 
 * This file imports from both api.ts and Button.tsx to demonstrate
 * cross-lane integration in CursorFlow.
 */

// Import from backend API module
import { hello } from './api';

// Import from frontend UI component
import { Button } from './Button';

/**
 * Re-export all imports for unified access
 */
export { hello, Button };

/**
 * Integration test function that uses both modules
 */
export const testIntegration = () => {
  const apiResult = hello();
  console.log(`API says: ${apiResult}`);
  console.log('Button component imported successfully');
  return {
    apiMessage: apiResult,
    buttonAvailable: typeof Button === 'function',
  };
};

export default {
  hello,
  Button,
  testIntegration,
};
