import { handleGreeting } from '../../src/api/greeting';

describe('Greeting API', () => {
  it('should return a default greeting when no name is provided', () => {
    const response = handleGreeting();
    expect(response.message).toBe('Hello, Guest!');
    expect(response.timestamp).toBeDefined();
    expect(new Date(response.timestamp).getTime()).not.toBeNaN();
  });

  it('should return a personalized greeting when a name is provided', () => {
    const response = handleGreeting('Alice');
    expect(response.message).toBe('Hello, Alice!');
    expect(response.timestamp).toBeDefined();
  });

  it('should use "Guest" when an empty or blank name is provided', () => {
    const response1 = handleGreeting('');
    expect(response1.message).toBe('Hello, Guest!');

    const response2 = handleGreeting('   ');
    expect(response2.message).toBe('Hello, Guest!');
  });

  it('should return a valid ISO 8601 timestamp', () => {
    const response = handleGreeting();
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
    expect(response.timestamp).toMatch(isoRegex);
  });
});
