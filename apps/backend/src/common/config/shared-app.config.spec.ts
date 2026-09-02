/**
 * Log level resolution (#1094).
 *
 * Production was pinned to INFO by `NODE_ENV` with no override, so any
 * diagnostic written at `debug` was unreachable in the only environment where
 * the failure happens. #1085 sat undiagnosed for months on exactly that: the
 * reason a proposition analysis was refused WAS being written, at `debug`, and
 * 12 hours of production logs contained none of it. Fixing it required
 * shipping code to move one log call.
 */
import { LogLevel } from '@opuspopuli/logging-provider';
import { resolveLogLevel } from './shared-app.config';

describe('resolveLogLevel (#1094)', () => {
  const silent = () => undefined;

  describe('with no LOG_LEVEL set', () => {
    it('keeps the existing production default', () => {
      expect(resolveLogLevel(undefined, 'production', silent)).toBe(
        LogLevel.INFO,
      );
    });

    it('keeps the existing non-production default', () => {
      expect(resolveLogLevel(undefined, 'development', silent)).toBe(
        LogLevel.DEBUG,
      );
    });

    it('treats an empty string as unset', () => {
      // A compose file with `LOG_LEVEL: ${LOG_LEVEL:-}` produces "", not
      // undefined. Reading that as a level would silently break every node.
      expect(resolveLogLevel('', 'production', silent)).toBe(LogLevel.INFO);
    });
  });

  describe('with LOG_LEVEL set', () => {
    it.each([
      ['debug', LogLevel.DEBUG],
      ['info', LogLevel.INFO],
      ['warn', LogLevel.WARN],
      ['error', LogLevel.ERROR],
    ])('honours %s', (raw, expected) => {
      expect(resolveLogLevel(raw, 'production', silent)).toBe(expected);
    });

    it('raises verbosity in production — the entire point of the issue', () => {
      expect(resolveLogLevel('debug', 'production', silent)).toBe(
        LogLevel.DEBUG,
      );
    });

    it('accepts case and whitespace variation', () => {
      // `LOG_LEVEL=DEBUG ` is what someone types at 2am during an incident.
      expect(resolveLogLevel('DEBUG', 'production', silent)).toBe(
        LogLevel.DEBUG,
      );
      expect(resolveLogLevel('  warn  ', 'production', silent)).toBe(
        LogLevel.WARN,
      );
    });
  });

  describe('with an invalid LOG_LEVEL', () => {
    it('falls back to the default rather than selecting nothing', () => {
      expect(resolveLogLevel('verbose', 'production', silent)).toBe(
        LogLevel.INFO,
      );
      expect(resolveLogLevel('trace', 'development', silent)).toBe(
        LogLevel.DEBUG,
      );
    });

    it('says so, naming the value and the fallback', () => {
      // Silence here would be the same failure mode the issue is about: a
      // typo during an incident making the logs quietly worse.
      const warnings: string[] = [];
      resolveLogLevel('verbse', 'production', (m) => warnings.push(m));

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('verbse');
      expect(warnings[0]).toContain('info');
    });
  });
});
