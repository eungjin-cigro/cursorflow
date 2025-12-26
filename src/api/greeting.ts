/**
 * Greeting API Response interface
 */
export interface GreetingResponse {
  message: string;
  timestamp: string;
  status: 'success' | 'error';
  error?: string;
}

/**
 * Generates a greeting message
 * 
 * @param name The name to greet
 * @returns A greeting string
 */
export function generateGreetingMessage(name: string): string {
  return `Hello, ${name}!`;
}

/**
 * Handles the greeting logic
 * 
 * @param name The name to greet (defaults to 'Guest')
 * @returns A GreetingResponse object
 */
export function handleGreeting(name?: string): GreetingResponse {
  const finalName = name?.trim() || 'Guest';
  
  // Example validation
  if (finalName.length > 100) {
    return {
      status: 'error',
      error: 'Bad Request',
      message: "The 'name' parameter exceeds the maximum allowed length.",
      timestamp: new Date().toISOString()
    };
  }

  return {
    message: generateGreetingMessage(finalName),
    timestamp: new Date().toISOString(),
    status: 'success'
  };
}
