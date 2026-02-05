/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import { DbErrorCodes } from 'src/db/db.errors';
import {
  createMockDbClient,
  MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';

import { AuthService } from '../auth/auth.service';

import { UsersService } from './users.service';
import { User } from './models/user.model';
import { AuthStrategy } from 'src/common/enums/auth-strategy.enum';

import { users, createUserDto, updateUserDto } from '../../../../data.spec';

// Helper to create database-style user data (with null instead of undefined)
const createDbUser = (user: (typeof users)[0]) => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  authStrategy: null,
  created: user.created,
  updated: user.updated,
  deletedAt: null,
});

describe('UsersService', () => {
  let dbService: MockDbClient;
  let usersService: UsersService;
  let authService: AuthService;

  beforeEach(async () => {
    const mockDb = createMockDbClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DbService, useValue: mockDb },
        { provide: AuthService, useValue: createMock<AuthService>() },
      ],
    }).compile();

    dbService = module.get(DbService);
    usersService = module.get<UsersService>(UsersService);
    authService = module.get<AuthService>(AuthService);
  });

  it('services should be defined', () => {
    expect(dbService).toBeDefined();
    expect(usersService).toBeDefined();
    expect(authService).toBeDefined();
  });

  it('should create a user', async () => {
    const dbUser = createDbUser(users[0]);
    dbService.user.create.mockResolvedValue(dbUser);
    (authService.registerUser as jest.Mock).mockResolvedValue(true);

    const result = await usersService.create(createUserDto);

    expect(result).toEqual(User.fromDb(dbUser));
    expect(dbService.user.create).toHaveBeenCalledTimes(1);
    expect(authService.registerUser).toHaveBeenCalledTimes(1);
  });

  it('should fail to create a user with unique constraint error', async () => {
    const dbError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: DbErrorCodes.UniqueConstraintViolation,
        clientVersion: '5.0.0',
        meta: { target: ['email'] },
      },
    );
    dbService.user.create.mockRejectedValue(dbError);

    try {
      await usersService.create(createUserDto);
    } catch (error) {
      expect((error as Error).message).toContain('Unique constraint violation');
      expect(authService.registerUser).toHaveBeenCalledTimes(0);
    }
  });

  it('should fail to create a user with unknown DB error', async () => {
    dbService.user.create.mockRejectedValue(new Error('Unknown error'));

    try {
      await usersService.create(createUserDto);
    } catch (error) {
      expect((error as Error).message).toEqual('A database error occurred.');
      expect(authService.registerUser).toHaveBeenCalledTimes(0);
    }
  });

  it('should create a passwordless user', async () => {
    const dbUser = {
      id: 'new-user-id',
      email: 'test@example.com',
      firstName: null,
      lastName: null,
      authStrategy: 'magic_link',
      created: new Date(),
      updated: new Date(),
      deletedAt: null,
    };
    dbService.user.create.mockResolvedValue(dbUser);

    const result =
      await usersService.createPasswordlessUser('test@example.com');

    expect(result.id).toEqual('new-user-id');
    expect(result.email).toEqual('test@example.com');
    expect(dbService.user.create).toHaveBeenCalledWith({
      data: { email: 'test@example.com', authStrategy: 'magic_link' },
    });
  });

  it('should fail to create a passwordless user with DB error', async () => {
    const dbError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: DbErrorCodes.UniqueConstraintViolation,
        clientVersion: '5.0.0',
        meta: { target: ['email'] },
      },
    );
    dbService.user.create.mockRejectedValue(dbError);

    try {
      await usersService.createPasswordlessUser('test@example.com');
    } catch (error) {
      expect((error as Error).message).toContain('Unique constraint violation');
    }
  });

  it('should update auth strategy successfully', async () => {
    const dbUser = createDbUser(users[0]);
    dbService.user.update.mockResolvedValue({
      ...dbUser,
      authStrategy: AuthStrategy.PASSKEY,
    });

    const result = await usersService.updateAuthStrategy(
      'user-id',
      AuthStrategy.PASSKEY,
    );

    expect(result).toBe(true);
    expect(dbService.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { authStrategy: AuthStrategy.PASSKEY },
    });
  });

  it('should fail to update auth strategy with DB error', async () => {
    const dbError = new Prisma.PrismaClientKnownRequestError(
      'Record not found',
      {
        code: DbErrorCodes.RecordNotFound,
        clientVersion: '5.0.0',
      },
    );
    dbService.user.update.mockRejectedValue(dbError);

    try {
      await usersService.updateAuthStrategy('user-id', AuthStrategy.PASSKEY);
    } catch (error) {
      expect((error as Error).message).toEqual('Record not found');
    }
  });

  it('should update a user', async () => {
    const dbUser = createDbUser(users[0]);
    dbService.user.update.mockResolvedValue(dbUser);

    expect(await usersService.update(users[0].id, updateUserDto)).toBe(true);
    expect(dbService.user.update).toHaveBeenCalledTimes(1);
  });

  it('should fail to update a user with DB error', async () => {
    const dbError = new Prisma.PrismaClientKnownRequestError(
      'Record not found',
      {
        code: DbErrorCodes.RecordNotFound,
        clientVersion: '5.0.0',
      },
    );
    dbService.user.update.mockRejectedValue(dbError);

    try {
      await usersService.update(users[0].id, updateUserDto);
    } catch (error) {
      expect((error as Error).message).toEqual('Record not found');
      expect(dbService.user.update).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail to register a user after DB creation', async () => {
    const dbUser = createDbUser(users[0]);
    dbService.user.create.mockResolvedValue(dbUser);
    dbService.user.delete.mockResolvedValue(dbUser);
    (authService.registerUser as jest.Mock).mockRejectedValue(
      new Error('Failed user registration!'),
    );

    try {
      await usersService.create(createUserDto);
    } catch (error) {
      expect(dbService.user.create).toHaveBeenCalledTimes(1);
      expect(authService.registerUser).toHaveBeenCalledTimes(1);
      expect((error as Error).message).toEqual('Failed user registration!');
    }
  });

  it('should fetch all users', async () => {
    const dbUsers = users.map(createDbUser);
    dbService.user.findMany.mockResolvedValue(dbUsers);

    const result = await usersService.findAll();

    expect(result).toEqual(User.fromDbArray(dbUsers));
    expect(dbService.user.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
    });
  });

  it('should fetch a user by its id', async () => {
    const dbUser = createDbUser(users[0]);
    dbService.user.findFirst.mockResolvedValue(dbUser);

    const result = await usersService.findById(users[0].id);

    expect(result).toEqual(User.fromDb(dbUser));
    expect(dbService.user.findFirst).toHaveBeenCalledWith({
      where: { id: users[0].id, deletedAt: null },
    });
  });

  it('should fetch a user by its email', async () => {
    const dbUser = createDbUser(users[0]);
    dbService.user.findFirst.mockResolvedValue(dbUser);

    const result = await usersService.findByEmail(users[0].email);

    expect(result).toEqual(User.fromDb(dbUser));
    expect(dbService.user.findFirst).toHaveBeenCalledWith({
      where: { email: users[0].email, deletedAt: null },
    });
  });

  it('should delete a user by its id (soft delete)', async () => {
    const dbUser = createDbUser(users[0]);
    dbService.user.findFirst.mockResolvedValue(dbUser);
    dbService.user.update.mockResolvedValue({
      ...dbUser,
      deletedAt: new Date(),
    });
    (authService.deleteUser as jest.Mock).mockResolvedValue(true);

    expect(await usersService.delete(users[0].id)).toBe(true);
    expect(dbService.user.findFirst).toHaveBeenCalledWith({
      where: { id: users[0].id, deletedAt: null },
    });
    expect(dbService.user.update).toHaveBeenCalledWith({
      where: { id: users[0].id },
      data: { deletedAt: expect.any(Date) },
    });
    expect(authService.deleteUser).toHaveBeenCalledTimes(1);
  });

  it('should fail to delete an unknown user', async () => {
    dbService.user.findFirst.mockResolvedValue(null);

    expect(await usersService.delete(users[0].id)).toBe(false);
    expect(dbService.user.findFirst).toHaveBeenCalledWith({
      where: { id: users[0].id, deletedAt: null },
    });
    expect(dbService.user.update).toHaveBeenCalledTimes(0);
    expect(authService.deleteUser).toHaveBeenCalledTimes(0);
  });

  it('should fail to delete a user due to auth service error', async () => {
    const dbUser = createDbUser(users[0]);
    dbService.user.findFirst.mockResolvedValue(dbUser);
    (authService.deleteUser as jest.Mock).mockRejectedValue(false);

    try {
      await usersService.delete(users[0].id);
    } catch (error) {
      expect(dbService.user.findFirst).toHaveBeenCalledWith({
        where: { id: users[0].id, deletedAt: null },
      });
      expect(dbService.user.update).toHaveBeenCalledTimes(0);
      expect(authService.deleteUser).toHaveBeenCalledTimes(1);
    }
  });
});
