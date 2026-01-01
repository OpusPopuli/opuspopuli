import { UserInputError } from '@nestjs/apollo';
import { getUserFromContext, GqlContext } from './graphql-context';

describe('getUserFromContext', () => {
  it('should extract user from valid context', () => {
    const mockUser = { id: 'user-123', email: 'test@example.com' };
    const context: GqlContext = {
      req: {
        user: mockUser,
      },
    };

    const result = getUserFromContext(context);

    expect(result).toEqual(mockUser);
  });

  it('should throw UserInputError when user is missing', () => {
    const context: GqlContext = {
      req: {},
    };

    expect(() => getUserFromContext(context)).toThrow(UserInputError);
    expect(() => getUserFromContext(context)).toThrow('User not authenticated');
  });

  it('should throw UserInputError when user is undefined', () => {
    const context: GqlContext = {
      req: {
        user: undefined,
      },
    };

    expect(() => getUserFromContext(context)).toThrow('User not authenticated');
  });
});
