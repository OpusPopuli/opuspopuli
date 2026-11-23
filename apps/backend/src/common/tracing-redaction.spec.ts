import { maskIpAddress } from './utils/pii-masker';
import {
  httpStartIncomingSpanHook,
  httpStartOutgoingSpanHook,
  maskClientIp,
  redactQueryString,
  redactUrl,
  undiciStartSpanHook,
} from './tracing-redaction';

/** The geocoder's request, as the undici instrumentation sees it. */
const GEOCODER = {
  origin: 'https://geocoding.geo.census.gov',
  path: '/geocoder/geographies/address?street=1315+10th+St&city=Sacramento&state=CA&zip=95814&format=json',
};
const SECRETS = ['1315', '10th', 'Sacramento', '95814'];

describe('tracing redaction (#1456)', () => {
  it('keeps parameter names and drops every value', () => {
    expect(redactQueryString('?street=1+Main&zip=95814&flag')).toBe(
      '?street=REDACTED&zip=REDACTED&REDACTED',
    );
  });

  it('leaves a URL without a query alone, and drops any fragment', () => {
    expect(redactUrl('https://x.test/a/b')).toBe('https://x.test/a/b');
    expect(redactUrl('https://x.test/a?q=1#frag')).toBe(
      'https://x.test/a?q=REDACTED',
    );
  });

  it('records no part of an address on a geocoder fetch span', () => {
    const attributes = undiciStartSpanHook(GEOCODER);
    const text = JSON.stringify(attributes);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(attributes['url.full']).toBe(
      'https://geocoding.geo.census.gov/geocoder/geographies/address?street=REDACTED&city=REDACTED&state=REDACTED&zip=REDACTED&format=REDACTED',
    );
  });

  it('records no part of an address on a node:http span either', () => {
    const attributes = httpStartOutgoingSpanHook({
      protocol: 'https:',
      hostname: 'geocoding.geo.census.gov',
      path: GEOCODER.path,
    });
    const text = JSON.stringify(attributes);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(Object.keys(attributes).sort()).toEqual([
      'http.target',
      'http.url',
      'url.full',
    ]);
    expect(attributes['http.target']).toBe(
      '/geocoder/geographies/address?street=REDACTED&city=REDACTED&state=REDACTED&zip=REDACTED&format=REDACTED',
    );
  });
});

describe('incoming span redaction (#1460)', () => {
  /** A GET of the lookup with coordinates inline, as it reached prod. */
  const GET_LOOKUP = {
    url: '/api?query=mutation%7B+locateJurisdictions%28input%3A%7Bpoint%3A%7Blat%3A38.5767%2Clng%3A-121.4934%7D%7D%29%7B+name+%7D+%7D',
    headers: {
      host: 'api-us-ca.opuspopuli.org',
      'x-forwarded-for': '24.5.22.43, 172.18.0.9',
    },
  };

  it('redacts the query values in every URL attribute', () => {
    const attributes = httpStartIncomingSpanHook(GET_LOOKUP);
    expect(attributes['http.target']).toBe('/api?query=REDACTED');
    expect(attributes['http.url']).toBe(
      'http://api-us-ca.opuspopuli.org/api?query=REDACTED',
    );
    expect(attributes['url.query']).toBe('query=REDACTED');
    expect(JSON.stringify(attributes)).not.toMatch(/38\.5767|121\.4934/);
  });

  it('masks the visitor IP, the first forwarded hop the span records', () => {
    const attributes = httpStartIncomingSpanHook(GET_LOOKUP);
    expect(attributes['http.client_ip']).toBe('24.x.x.x');
    expect(attributes['client.address']).toBe('24.x.x.x');
  });

  it('masks an IPv6 visitor entirely', () => {
    const attributes = httpStartIncomingSpanHook({
      url: '/api',
      headers: { 'x-forwarded-for': '2601:646:8f00::1' },
    });
    expect(attributes['http.client_ip']).toBe('[REDACTED_IP]');
  });

  it('uses https when the socket is TLS', () => {
    const attributes = httpStartIncomingSpanHook({
      ...GET_LOOKUP,
      socket: { encrypted: true },
    });
    expect(attributes['http.url']).toMatch(/^https:\/\//);
  });

  it('leaves a span with no query string and no forwarded IP untouched', () => {
    expect(
      httpStartIncomingSpanHook({ url: '/health', headers: { host: 'api' } }),
    ).toEqual({});
  });

  it('redacts a bare query token, a value with no name', () => {
    const attributes = httpStartIncomingSpanHook({
      url: '/api?38.5767,-121.4934',
      headers: { host: 'api' },
    });
    expect(attributes['http.target']).toBe('/api?REDACTED');
    expect(attributes['url.query']).toBe('REDACTED');
  });

  it('masks client.address from a Forwarded header, read before X-Forwarded-For', () => {
    const attributes = httpStartIncomingSpanHook({
      url: '/api',
      headers: {
        forwarded: 'for="198.51.100.9:4711";proto=https',
        'x-forwarded-for': '24.5.22.43',
      },
    });
    expect(attributes['client.address']).toBe('198.x.x.x');
    expect(attributes['http.client_ip']).toBe('24.x.x.x');
  });

  it('masks client.address from Forwarded alone, with no X-Forwarded-For', () => {
    const attributes = httpStartIncomingSpanHook({
      url: '/api',
      headers: { forwarded: 'for="[2001:db8::7]"' },
    });
    expect(attributes['client.address']).toBe('[REDACTED_IP]');
    expect(attributes['http.client_ip']).toBeUndefined();
  });

  it('leaves http.url path-only when the request has no Host', () => {
    expect(
      httpStartIncomingSpanHook({ url: '/api?q=1', headers: {} })['http.url'],
    ).toBe('/api?q=REDACTED');
  });

  it('masks exactly as the log masker does', () => {
    for (const ip of [
      '24.5.22.43',
      '2601:646:8f00::1',
      'not-an-ip',
      ' 24.5.22.43',
    ]) {
      expect(maskClientIp(ip)).toBe(maskIpAddress(ip));
    }
  });
});
