import {
  EDGE_READ_MAX_SKEW_MS,
  signEdgeRead,
  verifyEdgeRead,
} from './edge-read-signature';

// Shared with the frontend's lib/server/edge-read test: the Worker signs with
// WebCrypto and the gateway verifies with node:crypto, so both must agree on
// this exact value.
const SECRET = 'opuspopuli-edge-read-test-secret-0001';
const PATH = '/api?query=%7B+regionInfo+%7B+name+%7D+%7D';
const NOW = 1_700_000_000_000;
const VECTOR =
  '1700000000.b3c6ea6a3cbad10bd2fbf4ab1d8a48e4871d13f46dcc7fb4e2256334b7e96ce3';

describe('edge read signature (#1456)', () => {
  it('signs to the shared vector', () => {
    expect(signEdgeRead(SECRET, PATH, NOW)).toBe(VECTOR);
  });

  it('accepts a fresh signature of this exact path and query', () => {
    expect(verifyEdgeRead(VECTOR, SECRET, PATH, NOW)).toBe(true);
    expect(
      verifyEdgeRead(VECTOR, SECRET, PATH, NOW + EDGE_READ_MAX_SKEW_MS),
    ).toBe(true);
  });

  it('refuses a signature for any other read', () => {
    expect(
      verifyEdgeRead(VECTOR, SECRET, '/api?query=%7B+bills+%7D', NOW),
    ).toBe(false);
  });

  it('refuses a stale or future signature', () => {
    expect(
      verifyEdgeRead(VECTOR, SECRET, PATH, NOW + EDGE_READ_MAX_SKEW_MS + 1000),
    ).toBe(false);
    expect(
      verifyEdgeRead(VECTOR, SECRET, PATH, NOW - EDGE_READ_MAX_SKEW_MS - 1000),
    ).toBe(false);
  });

  it('refuses another secret, and anything malformed', () => {
    expect(verifyEdgeRead(VECTOR, `${SECRET}-other`, PATH, NOW)).toBe(false);
    for (const header of [
      undefined,
      ['a', 'b'],
      '',
      'nonsense',
      '1700000000.',
      `1700000000.${'z'.repeat(64)}`,
      `1700000000.${'a'.repeat(63)}`,
    ]) {
      expect(verifyEdgeRead(header, SECRET, PATH, NOW)).toBe(false);
    }
  });

  it('trusts nothing when no usable secret is configured', () => {
    expect(verifyEdgeRead(VECTOR, undefined, PATH, NOW)).toBe(false);
    expect(verifyEdgeRead(VECTOR, '', PATH, NOW)).toBe(false);
    const short = 'too-short';
    expect(
      verifyEdgeRead(signEdgeRead(short, PATH, NOW), short, PATH, NOW),
    ).toBe(false);
  });
});
