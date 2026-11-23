import {
  httpStartOutgoingSpanHook,
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
      '?street=REDACTED&zip=REDACTED&flag',
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
