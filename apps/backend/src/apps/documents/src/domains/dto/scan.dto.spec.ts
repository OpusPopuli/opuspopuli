import { ValidationPipe } from '@nestjs/common';
import { ProcessScanInput } from './scan.dto';

/**
 * #1049: the capture-detection telemetry is a NESTED input, and nested inputs
 * are the ones that silently stop being validated.
 *
 * `@ValidateNested` only does anything when the pipe is configured with
 * `transform: true` AND the property carries `@Type(() => …)`. Drop either and
 * class-validator walks a plain object it does not recognise, finds no
 * constraints, and reports success — the DTO looks validated and is not. That
 * is the same shape of failure as the location DTO regression this file sits
 * next to (see location.dto.spec.ts).
 *
 * So this spec runs the DTO through the SAME pipe configuration as
 * common/bootstrap.ts rather than calling `validate()` directly.
 */
describe('ProcessScanInput through the production ValidationPipe', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const metadata = { type: 'body' as const, metatype: ProcessScanInput };

  const capture = {
    detectionConfidence: 0.9931,
    coverage: 0.8164,
    sharpness: 10472.32,
    cropFired: true,
    frameWidth: 1920,
    frameHeight: 1080,
  };
  const valid = {
    data: Buffer.from('image bytes').toString('base64'),
    mimeType: 'image/jpeg',
    capture,
  };

  const transform = (input: unknown) => pipe.transform(input, metadata);

  it('keeps every capture field through the whitelist', async () => {
    const out = (await transform(valid)) as ProcessScanInput;

    expect(out.capture).toEqual(capture);
  });

  /**
   * The telemetry must never be able to fail a scan. A client that predates
   * these columns, or a non-camera upload, sends no `capture` at all — and the
   * mutation has to succeed exactly as before.
   */
  it('accepts a scan that reports no capture metrics', async () => {
    const out = (await transform({
      data: valid.data,
      mimeType: valid.mimeType,
    })) as ProcessScanInput;

    expect(out.capture).toBeUndefined();
  });

  describe('rejects readings that could only be an attack or a bug', () => {
    const cases: ReadonlyArray<[string, Record<string, unknown>]> = [
      ['confidence above 1', { detectionConfidence: 1.5 }],
      ['negative confidence', { detectionConfidence: -0.1 }],
      ['coverage above 1', { coverage: 2 }],
      ['negative sharpness', { sharpness: -1 }],
      ['absurd sharpness', { sharpness: 1e9 }],
      ['fractional frame width', { frameWidth: 1920.5 }],
      ['negative frame height', { frameHeight: -1 }],
      ['absurd frame width', { frameWidth: 1e6 }],
      ['a string where a number belongs', { coverage: '0.5' }],
      ['a string where a boolean belongs', { cropFired: 'true' }],
    ];

    it.each(cases)('%s', async (_label, override) => {
      await expect(
        transform({ ...valid, capture: { ...capture, ...override } }),
      ).rejects.toThrow();
    });
  });

  /**
   * A partial reading is not a usable one: the fields are interpreted together
   * (coverage explains confidence, both explain whether the crop fired), so a
   * row with three of six columns filled is noise in every aggregate they
   * exist to support. Reject it rather than storing half a measurement.
   */
  it('rejects a partial reading rather than storing half a measurement', async () => {
    await expect(
      transform({ ...valid, capture: { coverage: 0.5 } }),
    ).rejects.toThrow();
  });

  /**
   * Bounds must be generous enough never to fail a real scan. These are the
   * genuine extremes: a detector that found nothing, and the sharpness of a
   * camera-app still measured by the eval harness (detect-probe, 2026-09-13).
   */
  it.each([
    [
      'a detector that found nothing',
      {
        ...capture,
        detectionConfidence: 0,
        coverage: 0,
        sharpness: 0,
        cropFired: false,
      },
    ],
    [
      'a real camera-app still',
      {
        ...capture,
        detectionConfidence: 0.993,
        coverage: 0.816,
        sharpness: 10472.32,
      },
    ],
    ['a 4K frame', { ...capture, frameWidth: 3840, frameHeight: 2160 }],
  ])('accepts %s', async (_label, reading) => {
    const out = (await transform({
      ...valid,
      capture: reading,
    })) as ProcessScanInput;

    expect(out.capture).toEqual(reading);
  });
});
