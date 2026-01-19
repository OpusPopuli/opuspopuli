/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { Prisma } from '@prisma/client';

import { PrismaService } from 'src/db/prisma.service';
import { PrismaErrorCodes } from 'src/db/db.prisma-errors';
import {
  createMockPrismaService,
  MockPrismaService,
} from 'src/test/prisma-mock';

import { AuthService } from '../auth/auth.service';

import { UsersService } from './users.service';
import { User } from './models/user.model';
import { AuthStrategy } from 'src/common/enums/auth-strategy.enum';

import { users, createUserDto, updateUserDto } from '../../../../data.spec';

// Helper to create Prisma-style user data (with null instead of undefined)
const createPrismaUser = (user: (typeof users)[0]) => ({
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
  let prismaService: MockPrismaService;
  let usersService: UsersService;
  let authService: AuthService;

  beforeEach(async () => {
    const mockPrisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthService, useValue: createMock<AuthService>() },
      ],
    }).compile();

    prismaService = module.get(PrismaService);
    usersService = module.get<UsersService>(UsersService);
    authService = module.get<AuthService>(AuthService);
  });

  it('services should be defined', () => {
    expect(prismaService).toBeDefined();
    expect(usersService).toBeDefined();
    expect(authService).toBeDefined();
  });

  it('should create a user', async () => {
    const prismaUser = createPrismaUser(users[0]);
    prismaService.user.create.mockResolvedValue(prismaUser);
    (authService.registerUser as jest.Mock).mockResolvedValue(true);

    const result = await usersService.create(createUserDto);

    expect(result).toEqual(User.fromPrisma(prismaUser));
    expect(prismaService.user.create).toHaveBeenCalledTimes(1);
    expect(authService.registerUser).toHaveBeenCalledTimes(1);
  });

  it('should fail to create a user with unique constraint error', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: PrismaErrorCodes.UniqueConstraintViolation,
        clientVersion: '5.0.0',
        meta: { target: ['email'] },
      },
    );
    prismaService.user.create.mockRejectedValue(prismaError);

    try {
      await usersService.create(createUserDto);
    } catch (error) {
      expect((error as Error).message).toContain('Unique constraint violation');
      expect(authService.registerUser).toHaveBeenCalledTimes(0);
    }
  });

  it('should fail to create a user with unknown DB error', async () => {
    prismaService.user.create.mockRejectedValue(new Error('Unknown error'));

    try {
      await usersService.create(createUserDto);
    } catch (error) {
      expect((error as Error).message).toEqual('A database error occurred.');
      expect(authService.registerUser).toHaveBeenCalledTimes(0);
    }
  });

  it('should create a passwordless user', async () => {
    const prismaUser = {
      id: 'new-user-id',
      email: 'test@example.com',
      firstName: null,
      lastName: null,
      authStrategy: 'magic_link',
      created: new Date(),
      updated: new Date(),
      deletedAt: null,
    };
    prismaService.user.create.mockResolvedValue(prismaUser);

    const result =
      await usersService.createPasswordlessUser('test@example.com');

    expect(result.id).toEqual('new-user-id');
    expect(result.email).toEqual('test@example.com');
    expect(prismaService.user.create).toHaveBeenCalledWith({
      data: { email: 'test@example.com', authStrategy: 'magic_link' },
    });
  });

  it('should fail to create a passwordless user with DB error', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: PrismaErrorCodes.UniqueConstraintViolation,
        clientVersion: '5.0.0',
        meta: { target: ['email'] },
      },
    );
    prismaService.user.create.mockRejectedValue(prismaError);

    try {
      await usersService.createPasswordlessUser('test@example.com');
    } catch (error) {
      expect((error as Error).message).toContain('Unique constraint violation');
    }
  });

  it('should update auth strategy successfully', async () => {
    const prismaUser = createPrismaUser(users[0]);
    prismaService.user.update.mockResolvedValue({
      ...prismaUser,
      authStrategy: AuthStrategy.PASSKEY,
    });

    const result = await usersService.updateAuthStrategy(
      'user-id',
      AuthStrategy.PASSKEY,
    );

    expect(result).toBe(true);
    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { authStrategy: AuthStrategy.PASSKEY },
    });
  });

  it('should fail to update auth strategy with DB error', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Record not found',
      {
        code: PrismaErrorCodes.RecordNotFound,
        clientVersion: '5.0.0',
      },
    );
    prismaService.user.update.mockRejectedValue(prismaError);

    try {
      await usersService.updateAuthStrategy('user-id', AuthStrategy.PASSKEY);
    } catch (error) {
      expect((error as Error).message).toEqual('Record not found');
    }
  });

  it('should update a user', async () => {
    const prismaUser = createPrismaUser(users[0]);
    prismaService.user.update.mockResolvedValue(prismaUser);

    expect(await usersService.update(users[0].id, updateUserDto)).toBe(true);
    expect(prismaService.user.update).toHaveBeenCalledTimes(1);
  });

  it('should fail to update a user with DB error', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Record not found',
      {
        code: PrismaErrorCodes.RecordNotFound,
        clientVersion: '5.0.0',
      },
    );
    prismaService.user.update.mockRejectedValue(prismaError);

    try {
      await usersService.update(users[0].id, updateUserDto);
    } catch (error) {
      expect((error as Error).message).toEqual('Record not found');
      expect(prismaService.user.update).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail to register a user after DB creation', async () => {
    const prismaUser = createPrismaUser(users[0]);
    prismaService.user.create.mockResolvedValue(prismaUser);
    prismaService.user.delete.mockResolvedValue(prismaUser);
    (authService.registerUser as jest.Mock).mockRejectedValue(
      new Error('Failed user registration!'),
    );

    try {
      await usersService.create(createUserDto);
    } catch (error) {
      expect(prismaService.user.create).toHaveBeenCalledTimes(1);
      expect(authService.registerUser).toHaveBeenCalledTimes(1);
      expect((error as Error).message).toEqual('Failed user registration!');
    }
  });

  it('should fetch all users', async () => {
    const prismaUsers = users.map(createPrismaUser);
    prismaService.user.findMany.mockResolvedValue(prismaUsers);

    const result = await usersService.findAll();

    expect(result).toEqual(User.fromPrismaArray(prismaUsers));
    expect(prismaService.user.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
    });
  });

  it('should fetch a user by its id', async () => {
    const prismaUser = createPrismaUser(users[0]);
    prismaService.user.findFirst.mockResolvedValue(prismaUser);

    const result = await usersService.findById(users[0].id);

    expect(result).toEqual(User.fromPrisma(prismaUser));
    expect(prismaService.user.findFirst).toHaveBeenCalledWith({
      where: { id: users[0].id, deletedAt: null },
    });
  });

  it('should fetch a user by its email', async () => {
    const prismaUser = createPrismaUser(users[0]);
    prismaService.user.findFirst.mockResolvedValue(prismaUser);

    const result = await usersService.findByEmail(users[0].email);

    expect(result).toEqual(User.fromPrisma(prismaUser));
    expect(prismaService.user.findFirst).toHaveBeenCalledWith({
      where: { email: users[0].email, deletedAt: null },
    });
  });

  it('should delete a user by its id (soft delete)', async () => {
    const prismaUser = createPrismaUser(users[0]);
    prismaService.user.findFirst.mockResolvedValue(prismaUser);
    prismaService.user.update.mockResolvedValue({
      ...prismaUser,
      deletedAt: new Date(),
    });
    (authService.deleteUser as jest.Mock).mockResolvedValue(true);

    expect(await usersService.delete(users[0].id)).toBe(true);
    expect(prismaService.user.findFirst).toHaveBeenCalledWith({
      where: { id: users[0].id, deletedAt: null },
    });
    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: users[0].id },
      data: { deletedAt: expect.any(Date) },
    });
    expect(authService.deleteUser).toHaveBeenCalledTimes(1);
  });

  it('should fail to delete an unknown user', async () => {
    prismaService.user.findFirst.mockResolvedValue(null);

    expect(await usersService.delete(users[0].id)).toBe(false);
    expect(prismaService.user.findFirst).toHaveBeenCalledWith({
      where: { id: users[0].id, deletedAt: null },
    });
    expect(prismaService.user.update).toHaveBeenCalledTimes(0);
    expect(authService.deleteUser).toHaveBeenCalledTimes(0);
  });

  it('should fail to delete a user due to auth service error', async () => {
    const prismaUser = createPrismaUser(users[0]);
    prismaService.user.findFirst.mockResolvedValue(prismaUser);
    (authService.deleteUser as jest.Mock).mockRejectedValue(false);

    try {
      await usersService.delete(users[0].id);
    } catch (error) {
      expect(prismaService.user.findFirst).toHaveBeenCalledWith({
        where: { id: users[0].id, deletedAt: null },
      });
      expect(prismaService.user.update).toHaveBeenCalledTimes(0);
      expect(authService.deleteUser).toHaveBeenCalledTimes(1);
    }
  });
});
