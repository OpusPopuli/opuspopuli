/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository, TypeORMError } from 'typeorm';
import { PostgresErrorCodes } from 'src/db/db.errors';

import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';

import { UsersService } from './users.service';
import { User } from './models/user.model';
import { UserEntity } from 'src/db/entities/user.entity';

import { users, createUserDto, updateUserDto } from '../../../../data.spec';

describe('UsersService', () => {
  let userRepo: Repository<UserEntity>;
  let usersService: UsersService;
  let authService: AuthService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: createMock<Repository<UserEntity>>({}),
        },
        { provide: AuthService, useValue: createMock<AuthService>() },
        { provide: ConfigService, useValue: createMock<ConfigService>() },
      ],
    }).compile();

    userRepo = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    usersService = module.get<UsersService>(UsersService);
    authService = module.get<AuthService>(AuthService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('services should be defined', () => {
    expect(userRepo).toBeDefined();
    expect(usersService).toBeDefined();
    expect(authService).toBeDefined();
    expect(configService).toBeDefined();
  });

  it('should create a user', async () => {
    userRepo.save = jest.fn().mockImplementation((user: User) => {
      return Promise.resolve(users[0]);
    });
    authService.registerUser = jest.fn().mockImplementation((user: User) => {
      return Promise.resolve(true);
    });

    expect(await usersService.create(createUserDto)).toEqual(users[0]);
    expect(userRepo.save).toHaveBeenCalledTimes(1);
    expect(authService.registerUser).toHaveBeenCalledTimes(1);
  });

  it('should fail to create a user with generic DB error', async () => {
    userRepo.save = jest.fn().mockImplementation((user: User) => {
      return Promise.reject(
        new QueryFailedError(
          'Failed user creation!',
          undefined,
          new TypeORMError('ORM Error'),
        ),
      );
    });

    try {
      await usersService.create(createUserDto);
    } catch (error) {
      expect(error.message).toEqual('TypeORMError: ORM Error');
      expect(authService.registerUser).toHaveBeenCalledTimes(0);
    }
  });

  it('should fail to create a user with postgres DB error', async () => {
    userRepo.save = jest.fn().mockImplementation((user: User) => {
      return Promise.reject(
        new QueryFailedError('Failed user creation!', undefined, {
          code: PostgresErrorCodes.UniqueViolation,
          detail: 'Postgres Error',
        } as any),
      );
    });

    try {
      await usersService.create(createUserDto);
    } catch (error) {
      expect(error.message).toEqual('Postgres Error');
      expect(authService.registerUser).toHaveBeenCalledTimes(0);
    }
  });

  it('should fail to create a user with unknown DB error', async () => {
    userRepo.save = jest.fn().mockImplementation((user: User) => {
      return Promise.reject(new Error('Failed user creation!'));
    });

    try {
      await usersService.create(createUserDto);
    } catch (error) {
      expect(error.message).toEqual('Failed user creation!');
      expect(authService.registerUser).toHaveBeenCalledTimes(0);
    }
  });

  it('should create a passwordless user', async () => {
    userRepo.create = jest.fn().mockReturnValue({ email: 'test@example.com' });
    userRepo.save = jest.fn().mockResolvedValue({
      id: 'new-user-id',
      email: 'test@example.com',
    });

    const result =
      await usersService.createPasswordlessUser('test@example.com');

    expect(result).toEqual({ id: 'new-user-id', email: 'test@example.com' });
    expect(userRepo.create).toHaveBeenCalledWith({
      email: 'test@example.com',
      authStrategy: 'magic_link',
    });
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });

  it('should fail to create a passwordless user with DB error', async () => {
    userRepo.create = jest.fn().mockReturnValue({
      email: 'test@example.com',
      authStrategy: 'magic_link',
    });
    userRepo.save = jest.fn().mockRejectedValue(
      new QueryFailedError('Failed user creation!', undefined, {
        code: PostgresErrorCodes.UniqueViolation,
        detail: 'Email already exists',
      } as any),
    );

    try {
      await usersService.createPasswordlessUser('test@example.com');
    } catch (error) {
      expect(error.message).toEqual('Email already exists');
    }
  });

  it('should update a user', async () => {
    userRepo.update = jest
      .fn()
      .mockImplementation((criteria: any, user: User) => {
        return Promise.resolve(true);
      });

    expect(await usersService.update(users[0].id, updateUserDto)).toBe(true);
    expect(userRepo.update).toHaveBeenCalledTimes(1);
  });

  it('should fail to update a user with generic DB error', async () => {
    userRepo.update = jest
      .fn()
      .mockImplementation((criteria: any, user: User) => {
        return Promise.reject(
          new QueryFailedError(
            'Failed user update!',
            undefined,
            new TypeORMError('ORM Error'),
          ),
        );
      });

    try {
      await usersService.update(users[0].id, updateUserDto);
    } catch (error) {
      expect(error.message).toEqual('TypeORMError: ORM Error');
      expect(userRepo.update).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail to register a user after DB creation', async () => {
    userRepo.save = jest.fn().mockImplementation((user: User) => {
      return Promise.resolve(users[0]);
    });
    userRepo.createQueryBuilder().delete().from(User).where({}).execute = jest
      .fn()
      .mockImplementation(() => {
        return Promise.resolve(true);
      });
    authService.registerUser = jest.fn().mockImplementation((user: User) => {
      return Promise.reject(new Error('Failed user registration!'));
    });

    try {
      await usersService.create(createUserDto);
    } catch (error) {
      expect(userRepo.create).toHaveBeenCalledTimes(1);
      expect(authService.registerUser).toHaveBeenCalledTimes(1);
      expect(error.message).toEqual('Failed user registration!');
    }
  });

  it('should fail to register a user and DB rollback after DB creation', async () => {
    userRepo.save = jest.fn().mockImplementation((user: User) => {
      return Promise.resolve(users[0]);
    });
    userRepo.createQueryBuilder().delete().from(User).where({}).execute = jest
      .fn()
      .mockImplementation(() => {
        return Promise.reject(new Error('Failed user db rollback!'));
      });
    authService.registerUser = jest.fn().mockImplementation((user: User) => {
      return Promise.reject(new Error('Failed user registration!'));
    });

    try {
      await usersService.create(createUserDto);
    } catch (error) {
      expect(userRepo.create).toHaveBeenCalledTimes(1);
      expect(authService.registerUser).toHaveBeenCalledTimes(1);
      expect(error.message).toEqual('Failed user registration!');
    }
  });

  it('should fetch all users', () => {
    userRepo.find = jest.fn().mockImplementation((options: any) => {
      return users;
    });

    expect(usersService.findAll()).toEqual(users);
    expect(userRepo.find).toHaveBeenCalledTimes(1);
  });

  it('should fetch a user by its id', () => {
    userRepo.findOne = jest.fn().mockImplementation((options: any) => {
      return users.find((user) => user.id === options.where.id);
    });

    expect(usersService.findById(users[0].id)).toEqual(users[0]);
    expect(userRepo.findOne).toHaveBeenCalledWith({
      where: { id: users[0].id },
    });
  });

  it('should fetch a user by its email', () => {
    userRepo.findOne = jest.fn().mockImplementation((options: any) => {
      return users.find((user) => user.email === options.where.email);
    });

    expect(usersService.findByEmail(users[0].email)).toEqual(users[0]);
    expect(userRepo.findOne).toHaveBeenCalledWith({
      where: { email: users[0].email },
    });
  });

  it('should delete a user by its id', async () => {
    userRepo.findOne = jest.fn().mockImplementation((options: any) => {
      return users.find((user) => user.id === options.where.id);
    });
    userRepo.delete = jest.fn().mockImplementation((options: any) => {
      return Promise.resolve(true);
    });
    authService.deleteUser = jest.fn().mockImplementation((email: string) => {
      return Promise.resolve(true);
    });

    expect(await usersService.delete(users[0].id)).toBe(true);
    expect(userRepo.findOne).toHaveBeenCalledWith({
      where: { id: users[0].id },
    });
    expect(userRepo.delete).toHaveBeenCalledWith({ id: users[0].id });
    expect(authService.deleteUser).toHaveBeenCalledTimes(1);
  });

  it('should fail to delete an unknown user', async () => {
    userRepo.findOne = jest.fn().mockImplementation((options: any) => {
      return null;
    });

    expect(await usersService.delete(users[0].id)).toBe(false);
    expect(userRepo.findOne).toHaveBeenCalledWith({
      where: { id: users[0].id },
    });
    expect(userRepo.delete).toHaveBeenCalledTimes(0);
    expect(authService.deleteUser).toHaveBeenCalledTimes(0);
  });

  it('should fail to delete a user due to AWS Cognito error', async () => {
    userRepo.findOne = jest.fn().mockImplementation((options: any) => {
      return users.find((user) => user.id === options.where.id);
    });
    authService.deleteUser = jest.fn().mockImplementation((email: string) => {
      return Promise.reject(false);
    });

    try {
      await usersService.delete(users[0].id);
    } catch (error) {
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: users[0].id },
      });
      expect(userRepo.delete).toHaveBeenCalledTimes(0);
      expect(authService.deleteUser).toHaveBeenCalledTimes(1);
    }
  });
});
