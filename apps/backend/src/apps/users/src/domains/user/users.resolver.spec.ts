/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { UsersResolver } from './users.resolver';
import { UsersService } from './users.service';

import { users, createUserDto, updateUserDto } from '../../../../data.spec';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

describe('UsersResolver', () => {
  let resolver: UsersResolver;
  let usersService: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersResolver,
        { provide: UsersService, useValue: createMock<UsersService>() },
      ],
    }).compile();

    resolver = module.get<UsersResolver>(UsersResolver);
    usersService = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolver and services should be defined', () => {
    expect(resolver).toBeDefined();
    expect(usersService).toBeDefined();
  });

  it('should create a user', async () => {
    usersService.create = jest
      .fn()
      .mockImplementation((createUserDto: CreateUserDto) => {
        return Promise.resolve(users[0]);
      });

    expect(await resolver.createUser(createUserDto)).toEqual(users[0]);
    expect(usersService.create).toHaveBeenCalledTimes(1);
  });

  it('should fail to create a user', async () => {
    usersService.create = jest
      .fn()
      .mockImplementation((createUserDto: CreateUserDto) => {
        return Promise.reject(new Error('Failed user creation!'));
      });

    try {
      await resolver.createUser(createUserDto);
    } catch (error) {
      expect(error.message).toEqual('Failed user creation!');
      expect(usersService.create).toHaveBeenCalledTimes(1);
    }
  });

  it('should update a user', async () => {
    usersService.update = jest
      .fn()
      .mockImplementation((id: string, updateUserDto: UpdateUserDto) => {
        return Promise.resolve(true);
      });

    expect(await resolver.updateUser(users[0].id, updateUserDto)).toBe(true);
    expect(usersService.update).toHaveBeenCalledTimes(1);
  });

  it('should fail to update a user', async () => {
    usersService.update = jest
      .fn()
      .mockImplementation((id: string, updateUserDto: UpdateUserDto) => {
        return Promise.reject(new Error('Failed user update!'));
      });

    try {
      await resolver.updateUser(users[0].id, updateUserDto);
    } catch (error) {
      expect(error.message).toEqual('Failed user update!');
      expect(usersService.update).toHaveBeenCalledTimes(1);
    }
  });

  it('should delete a user by its id', async () => {
    usersService.delete = jest.fn().mockImplementation((id: string) => {
      return Promise.resolve(true);
    });

    expect(await resolver.deleteUser(users[0].id)).toBe(true);
    expect(usersService.delete).toHaveBeenCalledWith(users[0].id);
  });

  it('should query all users', () => {
    usersService.findAll = jest.fn().mockImplementation(() => {
      return users;
    });

    expect(resolver.getUsers()).toEqual(users);
    expect(usersService.findAll).toHaveBeenCalledTimes(1);
  });

  it('should query a user by its id', () => {
    usersService.findById = jest.fn().mockImplementation((id: string) => {
      return users.find((user) => user.id === id);
    });

    expect(resolver.getUser(users[0].id)).toEqual(users[0]);
    expect(usersService.findById).toHaveBeenCalledWith(users[0].id);
  });

  it('should query a user by its email', () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return users.find((user) => user.email === email);
    });

    expect(resolver.findUser(users[0].email)).toEqual(users[0]);
    expect(usersService.findByEmail).toHaveBeenCalledWith(users[0].email);
  });

  it('should resolve a reference', () => {
    usersService.findById = jest.fn().mockImplementation((id: string) => {
      return users.find((user) => user.id === id);
    });

    expect(
      resolver.resolveReference({ __typename: 'User', id: users[0].id }),
    ).toEqual(users[0]);
    expect(usersService.findById).toHaveBeenCalledWith(users[0].id);
  });

  describe('acknowledgeCommitments (#754)', () => {
    const authedContext = {
      req: {
        headers: {},
        user: {
          id: users[0].id,
          email: users[0].email,
          roles: ['User'],
          department: 'Engineering',
          clearance: 'Secret',
        },
      },
    } as unknown as Parameters<typeof resolver.acknowledgeCommitments>[1];

    it('delegates to the service with the authenticated user id', async () => {
      const updated = { ...users[0], commitmentsVersionAcknowledged: '1.0.0' };
      usersService.acknowledgeCommitments = jest
        .fn()
        .mockResolvedValue(updated);

      const result = await resolver.acknowledgeCommitments(
        '1.0.0',
        authedContext,
      );

      expect(usersService.acknowledgeCommitments).toHaveBeenCalledWith(
        users[0].id,
        '1.0.0',
      );
      expect(result).toEqual(updated);
    });

    it('rejects a mismatched version without touching the service', async () => {
      usersService.acknowledgeCommitments = jest.fn();

      await expect(
        resolver.acknowledgeCommitments('99.0.0', authedContext),
      ).rejects.toThrow('Unsupported commitments version.');
      expect(usersService.acknowledgeCommitments).not.toHaveBeenCalled();
    });

    it('rejects an oversized version string without touching the service', async () => {
      usersService.acknowledgeCommitments = jest.fn();

      await expect(
        resolver.acknowledgeCommitments('x'.repeat(21), authedContext),
      ).rejects.toThrow('Invalid commitments version.');
      expect(usersService.acknowledgeCommitments).not.toHaveBeenCalled();
    });
  });
});
