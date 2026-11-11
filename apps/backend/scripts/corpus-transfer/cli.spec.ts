import { argValue, hasFlag } from './cli';

describe('argValue', () => {
  const argv = ['node', 'x.ts', '--target-db', 'postgres', '--apply'];

  it('reads the value after a flag', () => {
    expect(argValue('target-db', argv)).toBe('postgres');
    expect(argValue('manifest', argv)).toBeUndefined();
  });

  it.each([
    ['a flag in its place', ['--container', '--local']],
    ['nothing after it', ['--container']],
  ])('refuses %s', (_label, args) => {
    expect(() => argValue('container', ['node', 'x.ts', ...args])).toThrow(
      /--container needs a value/,
    );
  });
});

describe('hasFlag', () => {
  it('matches the whole flag only', () => {
    expect(hasFlag('apply', ['--apply'])).toBe(true);
    expect(hasFlag('apply', ['--applyx'])).toBe(false);
  });
});
