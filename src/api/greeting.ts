/**
 * Greeting API Endpoint Design
 * 
 * Path: /api/greeting
 * Method: GET
 * Description: Returns a friendly greeting message.
 * 
 * Query Parameters:
 *   - name (optional): The name of the person to greet. Defaults to 'Guest'.
 * 
 * Response Format: JSON
 * Response Body:
 *   {
 *     "message": string,
 *     "timestamp": string (ISO 8601)
 *   }
 */

export interface GreetingResponse {
  message: string;
  timestamp: string;
}

/**
 * Handles the greeting request
 * @param name - The name to greet
 * @returns A GreetingResponse object
 */
export function handleGreeting(name: string = 'Guest'): GreetingResponse {
  return {
    message: `Hello, ${name}!`,
    timestamp: new Date().toISOString(),
  };
}
