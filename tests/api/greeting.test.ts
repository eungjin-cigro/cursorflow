import { handleGreeting, generateGreetingMessage } from '../../src/api/greeting';

describe('Greeting API Handler', () => {
  describe('generateGreetingMessage', () => {
    test('should return a greeting message with the provided name', () => {
      expect(generateGreetingMessage('World')).toBe('Hello, World!');
    });
  });

  describe('handleGreeting', () => {
    test('should return a generic greeting when no name is provided', () => {
      const result = handleGreeting();
      expect(result.status).toBe('success');
      expect(result.message).toBe('Hello, Guest!');
      expect(result.timestamp).toBeDefined();
    });

    test('should return a personalized greeting when a name is provided', () => {
      const result = handleGreeting('Eugene');
      expect(result.status).toBe('success');
      expect(result.message).toBe('Hello, Eugene!');
    });

    test('should handle names with leading/trailing whitespace', () => {
      const result = handleGreeting('  John Doe  ');
      expect(result.status).toBe('success');
      expect(result.message).toBe('Hello, John Doe!');
    });

    test('should return an error if the name is too long', () => {
      const longName = 'a'.repeat(101);
      const result = handleGreeting(longName);
      expect(result.status).toBe('error');
      expect(result.error).toBe('Bad Request');
      expect(result.message).toContain('exceeds the maximum allowed length');
    });
  });
});
