import { rateLimitKey, resolveClientIp } from './client-ip';

describe('resolveClientIp (#1456)', () => {
  it("takes Cloudflare's connecting IP over everything else", () => {
    expect(
      resolveClientIp(
        {
          'cf-connecting-ip': '198.51.100.20',
          'x-forwarded-for': '203.0.113.1, 198.51.100.20',
        },
        '172.18.0.5',
      ),
    ).toBe('198.51.100.20');
  });

  it('takes the last x-forwarded-for hop, never the client-chosen first', () => {
    // The client sent "203.0.113.1"; our proxy appended the real address.
    expect(
      resolveClientIp(
        { 'x-forwarded-for': '203.0.113.1, 198.51.100.20' },
        '172.18.0.5',
      ),
    ).toBe('198.51.100.20');
  });

  it('gives a spoofing client the same key whatever it puts first', () => {
    const keys = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((spoofed) =>
      resolveClientIp({ 'x-forwarded-for': `${spoofed}, 198.51.100.20` }),
    );
    expect(new Set(keys)).toEqual(new Set(['198.51.100.20']));
  });

  it('reads a header that arrives as an array', () => {
    expect(
      resolveClientIp({
        'x-forwarded-for': [
          '203.0.113.1',
          '198.51.100.20',
        ] as unknown as string,
      }),
    ).toBe('198.51.100.20');
  });

  it('uses the single value the gateway forwards to a subgraph', () => {
    expect(resolveClientIp({ 'x-forwarded-for': '198.51.100.20' })).toBe(
      '198.51.100.20',
    );
  });

  it('falls back to the socket address with no proxy headers', () => {
    expect(resolveClientIp({}, '127.0.0.1')).toBe('127.0.0.1');
    expect(resolveClientIp(undefined, '::1')).toBe('::1');
  });

  it('ignores empty and implausible header values', () => {
    expect(
      resolveClientIp(
        { 'cf-connecting-ip': '  ', 'x-forwarded-for': `x, ${'9'.repeat(65)}` },
        '127.0.0.1',
      ),
    ).toBe('127.0.0.1');
    expect(resolveClientIp({})).toBeUndefined();
  });

  it('ignores x-real-ip, which a client can also set', () => {
    expect(resolveClientIp({ 'x-real-ip': '203.0.113.1' }, '10.0.0.2')).toBe(
      '10.0.0.2',
    );
  });
});

describe('resolveClientIp trust (#1456)', () => {
  it('ignores forwarding headers from a peer that is not our proxy', () => {
    // Reached us directly from the internet: its headers are its own.
    expect(
      resolveClientIp(
        { 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': '1.2.3.4' },
        '203.0.113.50',
      ),
    ).toBe('203.0.113.50');
  });

  it.each([
    '10.0.0.2',
    '172.18.0.5',
    '192.168.65.1',
    '127.0.0.1',
    '::1',
    '::ffff:172.18.0.5',
    'fd00::5',
  ])('believes them from a private or loopback peer (%s)', (peer) => {
    expect(resolveClientIp({ 'cf-connecting-ip': '198.51.100.20' }, peer)).toBe(
      '198.51.100.20',
    );
  });

  it('accepts only real IP addresses from headers', () => {
    expect(
      resolveClientIp({ 'cf-connecting-ip': 'not-an-ip' }, '10.0.0.2'),
    ).toBe('10.0.0.2');
  });

  it('reports an IPv4-mapped socket address as plain IPv4', () => {
    expect(resolveClientIp({}, '::ffff:203.0.113.50')).toBe('203.0.113.50');
  });
});

describe('rateLimitKey (#1456)', () => {
  it('keys IPv4 on the address', () => {
    expect(rateLimitKey('198.51.100.20')).toBe('198.51.100.20');
  });

  it('keys IPv6 on its /64, so one line cannot mint budgets', () => {
    const a = rateLimitKey('2001:db8:abcd:12:1::1');
    const b = rateLimitKey('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff');
    expect(a).toBe('2001:db8:abcd:12::/64');
    expect(b).toBe(a);
    expect(rateLimitKey('2001:db8:abcd:13::1')).not.toBe(a);
  });

  it('expands :: wherever it falls', () => {
    expect(rateLimitKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitKey('::1')).toBe('0:0:0:0::/64');
  });

  it('puts anything that is not an IP in one shared bucket', () => {
    expect(rateLimitKey(undefined)).toBe('unknown');
    expect(rateLimitKey('nonsense')).toBe('unknown');
  });
});

describe('rateLimitKey /48 (#1456)', () => {
  it('groups a whole subscriber allocation when asked', () => {
    expect(rateLimitKey('2001:db8:abcd:12::1', 48)).toBe('2001:db8:abcd::/48');
    expect(rateLimitKey('2001:db8:abcd:ff00::9', 48)).toBe(
      rateLimitKey('2001:db8:abcd:12::1', 48),
    );
    expect(rateLimitKey('198.51.100.20', 48)).toBe('198.51.100.20');
  });
});
