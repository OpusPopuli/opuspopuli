import { ident, literal, parseRows, sanitizeStderr } from './pg';

describe('sanitizeStderr', () => {
  it('drops the lines that quote row values', () => {
    const stderr = [
      'ERROR:  duplicate key value violates unique constraint "users_email_key"',
      'DETAIL:  Key (email)=(someone@example.org) already exists.',
      'CONTEXT:  COPY users, line 3',
    ].join('\n');
    const clean = sanitizeStderr(stderr);
    expect(clean).toContain('users_email_key');
    expect(clean).not.toContain('someone@example.org');
    expect(clean).not.toContain('COPY users, line');
  });

  it('drops every line of a multi-line DETAIL, not just the first', () => {
    const stderr = [
      'psql:<stdin>:12: ERROR:  new row violates check constraint "x"',
      'DETAIL:  Failing row contains (dst-e1, Dear office,',
      'my address is 1 Real Street',
      'and my phone is 555-0100).',
    ].join('\n');
    const clean = sanitizeStderr(stderr);
    expect(clean).toBe(
      'psql:<stdin>:12: ERROR:  new row violates check constraint "x"',
    );
  });

  it("drops pg_restore's echo of the failing command", () => {
    const stderr = [
      'pg_restore: error: could not execute query: ERROR:  relation exists',
      'Command was: CREATE TABLE corpus_staging.bills (',
      '    id text NOT NULL',
      ');',
    ].join('\n');
    expect(sanitizeStderr(stderr)).toBe(
      'pg_restore: error: could not execute query: ERROR:  relation exists',
    );
  });

  it('drops the echoed statement and its caret', () => {
    const stderr = [
      'ERROR:  syntax error at or near "x"',
      "LINE 1: SELECT 'secret' x",
      '                        ^',
    ].join('\n');
    expect(sanitizeStderr(stderr)).toBe('ERROR:  syntax error at or near "x"');
  });
});

describe('parseRows', () => {
  it('splits rows and unit-separated fields, skipping blank lines', () => {
    expect(parseRows('a\x1f1\nb\x1f2\n\n')).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
  });
});

describe('ident / literal', () => {
  it('quotes plain lower-case names', () => {
    expect(ident('cvr2_filings')).toBe('"cvr2_filings"');
    expect(ident('_prisma_migrations')).toBe('"_prisma_migrations"');
  });

  it.each(['Users', 'a"b', 'x; DROP TABLE users', '', 'a'.repeat(64)])(
    'refuses %j',
    (name) => {
      expect(() => ident(name)).toThrow(/unexpected identifier/);
    },
  );

  it('escapes single quotes in literals', () => {
    expect(literal("o'brien")).toBe("'o''brien'");
  });
});
