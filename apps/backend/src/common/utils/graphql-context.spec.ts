import { UserInputError } from '@nestjs/apollo';
import { getUserFromContext, GqlContext } from './graphql-context';

describe('getUserFromContext', () => {
  it('should extract user from valid context', () => {
    const mockUser = { id: 'user-123', email: 'test@example.com' };
    const context: GqlContext = {
      req: {
        headers: {
          user: JSON.stringify(mockUser),
        },
      },
    };

    const result = getUserFromContext(context);

    expect(result).toEqual(mockUser);
  });

  it('should throw UserInputError when user header is missing', () => {
    const context: GqlContext = {
      req: {
        headers: {},
      },
    };

    expect(() => getUserFromContext(context)).toThrow(UserInputError);
    expect(() => getUserFromContext(context)).toThrow('User not authenticated');
  });

  it('should throw UserInputError when user header is undefined', () => {
    const context: GqlContext = {
      req: {
        headers: {
          user: undefined,
        },
      },
    };

    expect(() => getUserFromContext(context)).toThrow('User not authenticated');
  });
});
