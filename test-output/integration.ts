/**
 * Integration module that combines API and Button components.
 * This file imports from both api.ts and Button.tsx to demonstrate integration.
 */

// Import from api.ts
import { fetchUser, createUser, API_VERSION } from './api';
import type { ApiResponse, User } from './api';

// Import from Button.tsx
import { Button, BUTTON_VERSION } from './Button';
import type { ButtonProps } from './Button';

/**
 * Combined version information from integrated modules.
 */
export const INTEGRATION_VERSION = {
  api: API_VERSION,
  button: BUTTON_VERSION,
  integration: '1.0.0',
};

/**
 * Re-export API utilities for convenience.
 */
export { fetchUser, createUser, API_VERSION };
export type { ApiResponse, User };

/**
 * Re-export Button component for convenience.
 */
export { Button, BUTTON_VERSION };
export type { ButtonProps };

/**
 * Integration-specific types combining API and UI concerns.
 */
export interface UserButtonAction {
  user: User;
  buttonProps: ButtonProps;
  action: 'view' | 'edit' | 'delete';
}

/**
 * Creates a button configuration for a specific user action.
 * @param user - The user to create action for
 * @param action - The action type
 * @returns UserButtonAction configuration
 */
export function createUserAction(
  user: User,
  action: 'view' | 'edit' | 'delete'
): UserButtonAction {
  const labelMap = {
    view: `View ${user.name}`,
    edit: `Edit ${user.name}`,
    delete: `Delete ${user.name}`,
  };

  const variantMap: Record<string, ButtonProps['variant']> = {
    view: 'primary',
    edit: 'secondary',
    delete: 'danger',
  };

  return {
    user,
    buttonProps: {
      label: labelMap[action],
      variant: variantMap[action],
    },
    action,
  };
}

/**
 * Fetches a user and creates action buttons for them.
 * @param userId - The ID of the user to fetch
 * @returns Promise resolving to array of UserButtonAction
 */
export async function fetchUserWithActions(
  userId: string
): Promise<UserButtonAction[]> {
  const response = await fetchUser(userId);
  const user = response.data;

  return [
    createUserAction(user, 'view'),
    createUserAction(user, 'edit'),
    createUserAction(user, 'delete'),
  ];
}

/**
 * Integration test helper to verify all modules are properly connected.
 */
export function verifyIntegration(): {
  apiConnected: boolean;
  buttonConnected: boolean;
  versions: typeof INTEGRATION_VERSION;
} {
  return {
    apiConnected: typeof fetchUser === 'function' && typeof createUser === 'function',
    buttonConnected: typeof Button === 'function',
    versions: INTEGRATION_VERSION,
  };
}
