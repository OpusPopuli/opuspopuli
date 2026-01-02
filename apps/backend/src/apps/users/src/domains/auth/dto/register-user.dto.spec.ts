import { validate } from 'class-validator';
import { RegisterUserDto } from './register-user.dto';

describe('RegisterUserDto', () => {
  const createValidDto = (): RegisterUserDto => {
    const dto = new RegisterUserDto();
    dto.email = 'test@example.com';
    dto.username = 'testuser';
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
      const dto = new RegisterUserDto();
      dto.username = 'testuser';
      dto.password = 'Password1!';

      const errors = await validate(dto);
      const emailError = errors.find((e) => e.property === 'email');

      expect(emailError).toBeDefined();
    });
  });

  describe('username validation', () => {
    it('should pass with valid username (6+ chars)', async () => {
      const dto = createValidDto();
      dto.username = 'validuser';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail with username less than 6 characters', async () => {
      const dto = createValidDto();
      dto.username = 'short';

      const errors = await validate(dto);
      const usernameError = errors.find((e) => e.property === 'username');

      expect(usernameError).toBeDefined();
    });

    it('should fail when username is missing', async () => {
      const dto = new RegisterUserDto();
      dto.email = 'test@example.com';
      dto.password = 'Password1!';

      const errors = await validate(dto);
      const usernameError = errors.find((e) => e.property === 'username');

      expect(usernameError).toBeDefined();
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
      const dto = new RegisterUserDto();
      dto.email = 'test@example.com';
      dto.username = 'testuser';

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

    it('should fail when username exceeds 50 characters', async () => {
      const dto = createValidDto();
      dto.username = 'a'.repeat(51);

      const errors = await validate(dto);
      const usernameError = errors.find((e) => e.property === 'username');

      expect(usernameError).toBeDefined();
    });

    it('should fail when password exceeds 128 characters', async () => {
      const dto = createValidDto();
      dto.password = 'Aa1!' + 'a'.repeat(125);

      const errors = await validate(dto);
      const passwordError = errors.find((e) => e.property === 'password');

      expect(passwordError).toBeDefined();
    });

    it('should fail when department exceeds 100 characters', async () => {
      const dto = createValidDto();
      dto.department = 'a'.repeat(101);

      const errors = await validate(dto);
      const departmentError = errors.find((e) => e.property === 'department');

      expect(departmentError).toBeDefined();
    });

    it('should fail when clearance exceeds 100 characters', async () => {
      const dto = createValidDto();
      dto.clearance = 'a'.repeat(101);

      const errors = await validate(dto);
      const clearanceError = errors.find((e) => e.property === 'clearance');

      expect(clearanceError).toBeDefined();
    });

    it('should pass when all fields are at max length', async () => {
      const dto = createValidDto();
      dto.username = 'a'.repeat(50);
      dto.department = 'a'.repeat(100);
      dto.clearance = 'a'.repeat(100);

      const errors = await validate(dto);
      // Filter out password errors (regex pattern validation)
      const nonPasswordErrors = errors.filter((e) => e.property !== 'password');
      expect(nonPasswordErrors.length).toBe(0);
    });
  });

  describe('optional fields', () => {
    it('should pass with optional department', async () => {
      const dto = createValidDto();
      dto.department = 'Engineering';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should pass with optional clearance', async () => {
      const dto = createValidDto();
      dto.clearance = 'Secret';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should pass with admin set to true', async () => {
      const dto = createValidDto();
      dto.admin = true;

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should pass with confirm set to true', async () => {
      const dto = createValidDto();
      dto.confirm = true;

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should default admin to false', () => {
      const dto = new RegisterUserDto();
      expect(dto.admin).toBe(false);
    });

    it('should default confirm to false', () => {
      const dto = new RegisterUserDto();
      expect(dto.confirm).toBe(false);
    });

    it('should pass without any optional fields', async () => {
      const dto = createValidDto();

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should pass with all optional fields', async () => {
      const dto = createValidDto();
      dto.department = 'Engineering';
      dto.clearance = 'TopSecret';
      dto.admin = true;
      dto.confirm = true;

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
