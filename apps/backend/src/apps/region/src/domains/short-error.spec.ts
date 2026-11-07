import { shortError } from './short-error';

describe('shortError', () => {
  it("prefers a Prisma error's code to its message", () => {
    const e = Object.assign(new Error('Invalid `update()` invocation:\n{…}'), {
      code: 'P2002',
    });
    expect(shortError(e)).toBe('P2002');
  });

  it('keeps only the first line of a message, cut short', () => {
    expect(shortError(new Error(`first\n${'quoted call '.repeat(50)}`))).toBe(
      'first',
    );
    expect(shortError(new Error('x'.repeat(500)))).toHaveLength(200);
  });

  it('reads a thrown non-error', () => {
    expect(shortError('plain')).toBe('plain');
    expect(shortError(null)).toBe('null');
  });
});
