import { wrapPromptForDependencyPolicy, wrapPrompt } from '../../src/core/runner';

describe('Runner Core', () => {
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

  test('wrapPrompt should include dependency results if provided', () => {
    const prompt = 'Test task';
    const config: any = { 
      dependencyPolicy: { allowDependencyChange: true, lockfileReadOnly: false } 
    };
    const dependencyResults = [
      { taskId: 'lane-1:task-1', resultText: 'Completed setup' }
    ];
    
    const wrapped = wrapPrompt(prompt, config, { dependencyResults });
    
    expect(wrapped).toContain('### 📋 의존 태스크 결과');
    expect(wrapped).toContain('lane-1:task-1');
    expect(wrapped).toContain('Completed setup');
    expect(wrapped).toContain(prompt);
  });
});
