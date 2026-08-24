import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { SetDocumentLocationInput } from './location.dto';

/**
 * Regression guard for the whitelist-strip bug class: the global
 * ValidationPipe runs `whitelist: true`, which silently REMOVES any
 * property carrying no class-validator metadata — `@Field` alone
 * contributes none. `location` had only `@Field`, so every
 * setDocumentLocation call reached the resolver with `location`
 * undefined (TypeError reading 'latitude'), and every scan-location
 * save failed in production.
 *
 * This spec runs the DTO through the SAME pipe configuration as
 * common/bootstrap.ts, so a future decorator removal fails here rather
 * than in production.
 */
describe('SetDocumentLocationInput through the production ValidationPipe', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const metadata = {
    type: 'body' as const,
    metatype: SetDocumentLocationInput,
  };

  const valid = {
    documentId: 'b3b25aa8-64ab-4b7e-97a5-a4a1c8f6f9e1',
    location: { latitude: 37.77, longitude: -122.42 },
  };

  it('location survives the whitelist and keeps its coordinates', async () => {
    const out = (await pipe.transform(
      valid,
      metadata,
    )) as SetDocumentLocationInput;

    expect(out.location).toBeDefined();
    expect(out.location.latitude).toBe(37.77);
    expect(out.location.longitude).toBe(-122.42);
  });

  it('rejects a missing location instead of silently stripping it', async () => {
    await expect(
      pipe.transform({ documentId: valid.documentId }, metadata),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects out-of-range coordinates (nested validation actually runs)', async () => {
    await expect(
      pipe.transform(
        {
          documentId: valid.documentId,
          location: { latitude: 999, longitude: 0 },
        },
        metadata,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('strips unknown properties without touching declared ones', async () => {
    const out = (await pipe.transform(
      { ...valid, evil: 'x' },
      metadata,
    )) as SetDocumentLocationInput & { evil?: string };

    expect(out.evil).toBeUndefined();
    expect(out.location.latitude).toBe(37.77);
  });
});
