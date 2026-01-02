import { validate } from 'class-validator';
import { LoginUserDto } from './login-user.dto';

describe('LoginUserDto', () => {
  const createValidDto = (): LoginUserDto => {
    const dto = new LoginUserDto();
    dto.email = 'test@example.com';
    dto.password = 'Password1!';
    return dto;
  };

  describe('email validation', () => {
    it('should pass with valid email', async () => {
      const dto = createValidDto();
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail with invalid email', async () => {
      const dto = createValidDto();
      dto.email = 'not-an-email';

      const errors = await validate(dto);
      const emailError = errors.find((e) => e.property === 'email');

      expect(emailError).toBeDefined();
    });

    it('should fail with empty email', async () => {
      const dto = createValidDto();
      dto.email = '';

      const errors = await validate(dto);
      const emailError = errors.find((e) => e.property === 'email');

      expect(emailError).toBeDefined();
    });

    it('should fail when email is missing', async () => {
      const dto = new LoginUserDto();
      dto.password = 'Password1!';

      const errors = await validate(dto);
      const emailError = errors.find((e) => e.property === 'email');

      expect(emailError).toBeDefined();
    });
  });

  describe('password validation', () => {
    it('should pass with strong password', async () => {
      const dto = createValidDto();
      dto.password = 'StrongPass1!';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail with password missing uppercase', async () => {
      const dto = createValidDto();
      dto.password = 'password1!';

      const errors = await validate(dto);
      const passwordError = errors.find((e) => e.property === 'password');

      expect(passwordError).toBeDefined();
      expect(passwordError?.constraints?.matches).toContain('invalid password');
    });

    it('should fail with password missing lowercase', async () => {
      const dto = createValidDto();
      dto.password = 'PASSWORD1!';

      const errors = await validate(dto);
      const passwordError = errors.find((e) => e.property === 'password');

      expect(passwordError).toBeDefined();
    });

    it('should fail with password missing number', async () => {
      const dto = createValidDto();
      dto.password = 'Password!';

      const errors = await validate(dto);
      const passwordError = errors.find((e) => e.property === 'password');

      expect(passwordError).toBeDefined();
    });

    it('should fail with password missing special character', async () => {
      const dto = createValidDto();
      dto.password = 'Password1';

      const errors = await validate(dto);
      const passwordError = errors.find((e) => e.property === 'password');

      expect(passwordError).toBeDefined();
    });

    it('should fail with password less than 8 characters', async () => {
      const dto = createValidDto();
      dto.password = 'Pass1!';

      const errors = await validate(dto);
      const passwordError = errors.find((e) => e.property === 'password');

      expect(passwordError).toBeDefined();
    });

    it('should fail when password is missing', async () => {
      const dto = new LoginUserDto();
      dto.email = 'test@example.com';

      const errors = await validate(dto);
      const passwordError = errors.find((e) => e.property === 'password');

      expect(passwordError).toBeDefined();
    });
  });

  describe('max length validation', () => {
    it('should fail when email exceeds 255 characters', async () => {
      const dto = createValidDto();
      dto.email = 'a'.repeat(250) + '@test.com';

      const errors = await validate(dto);
      const emailError = errors.find((e) => e.property === 'email');

      expect(emailError).toBeDefined();
    });

    it('should fail when password exceeds 128 characters', async () => {
      const dto = createValidDto();
      dto.password = 'Aa1!' + 'a'.repeat(125);

      const errors = await validate(dto);
      const passwordError = errors.find((e) => e.property === 'password');

      expect(passwordError).toBeDefined();
    });

    it('should pass with a valid email within max length', async () => {
      const dto = createValidDto();
      // Use a reasonably sized valid email
      dto.email = 'validuser@example.com';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
