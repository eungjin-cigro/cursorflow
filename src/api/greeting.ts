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
      message: 'Greeting failed',
      timestamp: new Date().toISOString(),
      status: 'error',
      error: "The 'name' parameter exceeds the maximum allowed length."
    };
  }

  return {
    message: `Hello, ${finalName}!`,
    timestamp: new Date().toISOString(),
    status: 'success'
  };
}
