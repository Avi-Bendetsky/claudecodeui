import { describe, it, expect } from 'vitest';

import { classifyToolError, errorSummary } from './errorClassifier';

describe('classifyToolError', () => {
  it('classifies permission denied errors', () => {
    const result = classifyToolError('Bash', 'EACCES: permission denied, open /etc/shadow');
    expect(result.category).toBe('permission_denied');
    expect(result.isRetryable).toBe(false);
  });

  it('classifies user-denied tool use', () => {
    const result = classifyToolError('Edit', 'user denied tool use');
    expect(result.category).toBe('permission_denied');
  });

  it('classifies file not found errors', () => {
    const result = classifyToolError('Read', 'ENOENT: no such file or directory');
    expect(result.category).toBe('file_not_found');
    expect(result.isRetryable).toBe(false);
  });

  it('classifies timeout errors', () => {
    const result = classifyToolError('Bash', 'ETIMEDOUT: connection timed out');
    expect(result.category).toBe('timeout');
    expect(result.isRetryable).toBe(true);
  });

  it('classifies network errors', () => {
    const result = classifyToolError('WebFetch', 'ECONNREFUSED: connection refused');
    expect(result.category).toBe('network');
    expect(result.isRetryable).toBe(true);
  });

  it('classifies syntax errors', () => {
    const result = classifyToolError('Bash', 'SyntaxError: unexpected token }');
    expect(result.category).toBe('syntax_error');
    expect(result.isRetryable).toBe(false);
  });

  it('returns unknown for unrecognized errors', () => {
    const result = classifyToolError('Bash', 'something totally unexpected happened');
    expect(result.category).toBe('unknown');
    expect(result.isRetryable).toBe(false);
    expect(result.suggestion).toBe('An unexpected error occurred.');
  });

  it('preserves the original message', () => {
    const msg = 'ENOENT: no such file or directory, open /foo/bar.txt';
    const result = classifyToolError('Read', msg);
    expect(result.message).toBe(msg);
  });

  it('handles empty input gracefully', () => {
    const result = classifyToolError('Bash', '');
    expect(result.category).toBe('unknown');
    expect(result.message).toBe('');
  });

  it('first matching category wins', () => {
    // "permission denied" matches before "file not found"
    const result = classifyToolError('Bash', 'permission denied: no such file');
    expect(result.category).toBe('permission_denied');
  });
});

describe('errorSummary', () => {
  it('returns first non-empty line', () => {
    expect(errorSummary('Error: something\ndetails here')).toBe('Error: something');
  });

  it('skips leading blank lines', () => {
    expect(errorSummary('\n\n  \nActual error')).toBe('Actual error');
  });

  it('truncates long messages', () => {
    const long = 'x'.repeat(200);
    const result = errorSummary(long, 50);
    expect(result).toHaveLength(50);
    expect(result).toMatch(/\.\.\.$/);
  });

  it('returns full message when short enough', () => {
    expect(errorSummary('short error')).toBe('short error');
  });

  it('returns original message when all lines are blank', () => {
    expect(errorSummary('   ')).toBe('   ');
  });
});
