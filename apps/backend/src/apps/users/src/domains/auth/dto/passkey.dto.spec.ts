import { ValidationPipe } from '@nestjs/common';
import {
  VerifyPasskeyRegistrationDto,
  VerifyPasskeyAuthenticationDto,
} from './passkey.dto';

/**
 * Regression guard for the whitelist-strip bug class (see
 * location.dto.spec.ts for the full story): the WebAuthn `response`
 * payloads carried no class-validator metadata, so the global
 * `whitelist: true` ValidationPipe removed them before the resolver —
 * the credential never reached @simplewebauthn verification.
 */
describe('Passkey verify DTOs through the production ValidationPipe', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });

  const webauthnResponse = {
    id: 'cred-1',
    rawId: 'cred-1',
    type: 'public-key',
    response: { clientDataJSON: 'x', attestationObject: 'y' },
  };

  it('registration response payload survives the whitelist', async () => {
    const out = (await pipe.transform(
      { email: 'user@example.com', response: webauthnResponse },
      { type: 'body', metatype: VerifyPasskeyRegistrationDto },
    )) as VerifyPasskeyRegistrationDto;

    expect(out.response).toBeDefined();
    expect((out.response as unknown as { id: string }).id).toBe('cred-1');
  });

  it('authentication response payload survives the whitelist', async () => {
    const out = (await pipe.transform(
      { identifier: 'user@example.com', response: webauthnResponse },
      { type: 'body', metatype: VerifyPasskeyAuthenticationDto },
    )) as VerifyPasskeyAuthenticationDto;

    expect(out.response).toBeDefined();
  });
});
