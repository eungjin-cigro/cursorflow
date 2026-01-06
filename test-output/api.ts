/**
 * API utility module for test-output integration testing.
 */

export interface ApiResponse<T> {
  data: T;
  status: number;
  message: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

/**
 * Fetches user data from the API.
 * @param userId - The ID of the user to fetch
 * @returns Promise resolving to ApiResponse containing user data
 */
export async function fetchUser(userId: string): Promise<ApiResponse<User>> {
  // Simulated API call
  return {
    data: {
      id: userId,
      name: 'Test User',
      email: 'test@example.com',
    },
    status: 200,
    message: 'Success',
  };
}

/**
 * Creates a new user via the API.
 * @param user - The user data to create
 * @returns Promise resolving to ApiResponse containing created user
 */
export async function createUser(user: Omit<User, 'id'>): Promise<ApiResponse<User>> {
  return {
    data: {
      id: `user-${Date.now()}`,
      ...user,
    },
    status: 201,
    message: 'Created',
  };
}

/**
 * API version constant for tracking.
 */
export const API_VERSION = '1.0.0';
