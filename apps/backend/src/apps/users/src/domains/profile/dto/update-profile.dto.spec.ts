import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

/**
 * Regression coverage for the empty-string trap on format-validated
 * optional fields. `@IsOptional()` only short-circuits on null/undefined;
 * an unfilled form input that sends `phone: ""` would otherwise fail
 * the E.164 regex with "Phone must be a valid E.164 format" even though
 * the user intended no phone at all. See issue #737 follow-up.
 */
describe('UpdateProfileDto — empty-string handling', () => {
  const validateInput = async (input: Record<string, unknown>) => {
    const dto = plainToInstance(UpdateProfileDto, input);
    return validate(dto);
  };

  it.each([
    ['phone', ''],
    ['dateOfBirth', ''],
    ['timezone', ''],
    ['locale', ''],
    ['preferredLanguage', ''],
    ['avatarUrl', ''],
  ])(
    'accepts an empty string for optional field %s (treated as not provided)',
    async (field, value) => {
      const errors = await validateInput({ [field]: value });
      expect(errors).toHaveLength(0);
    },
  );

  it('still rejects an invalid non-empty phone', async () => {
    const errors = await validateInput({ phone: 'not-a-number' });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual(
      expect.objectContaining({
        matches: 'Phone must be a valid E.164 format',
      }),
    );
  });

  it('accepts a valid E.164 phone', async () => {
    const errors = await validateInput({ phone: '+14155551234' });
    expect(errors).toHaveLength(0);
  });
});
