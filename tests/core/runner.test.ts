import { extractDependencyRequest, wrapPromptForDependencyPolicy } from '../../src/core/runner';

describe('Runner Core', () => {
  test('extractDependencyRequest should find marker and JSON', () => {
    const text = 'Blah blah DEPENDENCY_CHANGE_REQUIRED {"reason": "need lodash", "changes": [], "commands": []}';
    const result = extractDependencyRequest(text);
    
    expect(result.required).toBe(true);
    expect(result.plan!.reason).toBe('need lodash');
  });

  test('extractDependencyRequest should return required: false when no marker', () => {
    const text = 'Everything is fine.';
    const result = extractDependencyRequest(text);
    
    expect(result.required).toBe(false);
  });

  test('wrapPromptForDependencyPolicy should add policy text when restricted', () => {
    const prompt = 'Add a feature';
    const policy = { allowDependencyChange: false, lockfileReadOnly: true };
    
    const wrapped = wrapPromptForDependencyPolicy(prompt, policy);
    
    expect(wrapped).toContain('Dependency Policy');
    expect(wrapped).toContain('allowDependencyChange: false');
    expect(wrapped).toContain('Add a feature');
  });

  test('wrapPromptForDependencyPolicy should return original when fully allowed', () => {
    const prompt = 'Add a feature';
    const policy = { allowDependencyChange: true, lockfileReadOnly: false };
    
    const wrapped = wrapPromptForDependencyPolicy(prompt, policy);
    
    expect(wrapped).toBe(prompt);
  });
});
