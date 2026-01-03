import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { UserEntity } from 'src/db/entities/user.entity';
import { User } from './models/user.model';
import { CreateUserDto } from './dto/create-user.dto';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import evaluateDBError from 'src/db/db.errors';
import { AuthService } from '../auth/auth.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthStrategy } from 'src/common/enums/auth-strategy.enum';
import { SecureLogger } from 'src/common/services/secure-logger.service';

@Injectable()
export class UsersService {
  // Use SecureLogger to automatically redact PII (emails, passwords) from log messages
  // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/192
  private readonly logger = new SecureLogger(UsersService.name);

  constructor(
    @InjectRepository(UserEntity) private userRepo: Repository<UserEntity>,
    @Inject(forwardRef(() => AuthService)) private authService: AuthService,
    private configService: ConfigService,
  ) {}

  /**
   * Creates a user
   *
   * @param {CreateUserDto} createUserDto username, email, and password. Username and email must be
   * unique, will throw an email with a description if either are duplicates
   * @returns {Promise<User>} or throws an error
   * @memberof UsersService
   */
  async create(createUserDto: CreateUserDto): Promise<User | null> {
    const { password, ...rest } = createUserDto;

    const userEntity = this.userRepo.create();

    const saveEntity = {
      ...userEntity,
      ...rest,
    };

    let user: User | null = null;
    try {
      user = await this.userRepo.save(saveEntity);
      await this.authService.registerUser({
        email: createUserDto.email,
        username: createUserDto.username,
        password,
      });
    } catch (error) {
      if (user === null) {
        /** We hit a userRepo Error, just report back */
        const dbError = evaluateDBError(error);

        this.logger.warn(
          `userRepo error creating (${JSON.stringify(createUserDto)}): ${dbError.message}`,
        );

        throw dbError;
      } else {
        /** We hit an authService Error, clean up the user db entry */
        this.logger.warn(
          `authService error registering (${JSON.stringify(createUserDto)}): ${error.message}`,
        );

        this.userRepo
          .createQueryBuilder()
          .delete()
          .from(UserEntity)
          .where('id = :id', { id: user.id })
          .execute()
          .catch((error) => {
            this.logger.error(
              `Error deleting user after authService error: ${error.message}`,
            );
          });

        throw error;
      }
    }

    return user;
  }

  /**
   * Creates a passwordless user (for magic link registration)
   * Only requires email - no password or auth provider registration
   *
   * @param {string} email - User's email address
   * @param {AuthStrategy} authStrategy - The authentication strategy used
   * @returns {Promise<User>} The created user
   */
  async createPasswordlessUser(
    email: string,
    authStrategy: AuthStrategy = AuthStrategy.MAGIC_LINK,
  ): Promise<User> {
    const userEntity = this.userRepo.create({ email, authStrategy });

    try {
      return await this.userRepo.save(userEntity);
    } catch (error) {
      const dbError = evaluateDBError(error);
      this.logger.warn(
        `userRepo error creating passwordless user (${email}): ${dbError.message}`,
      );
      throw dbError;
    }
  }

  /**
   * Updates a user's authentication strategy
   *
   * @param {string} id - User ID
   * @param {AuthStrategy} authStrategy - The new authentication strategy
   * @returns {Promise<boolean>} Success status
   */
  async updateAuthStrategy(
    id: string,
    authStrategy: AuthStrategy,
  ): Promise<boolean> {
    try {
      await this.userRepo.update({ id }, { authStrategy });
      return true;
    } catch (error) {
      const dbError = evaluateDBError(error);
      this.logger.warn(
        `userRepo error updating auth strategy for user ${id}: ${dbError.message}`,
      );
      throw dbError;
    }
  }

  findAll(): Promise<User[] | null> {
    return this.userRepo.find({});
  }

  findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  async update(
    id: string,
    user: Partial<User> | UpdateUserDto,
  ): Promise<boolean> {
    try {
      await this.userRepo.update({ id }, user);
    } catch (error) {
      const dbError = evaluateDBError(error);

      this.logger.warn(
        `userRepo error updating (${JSON.stringify(user)}): ${dbError.message}`,
      );

      throw dbError;
    }

    return true;
  }

  async delete(id: string): Promise<boolean> {
    const user = await this.userRepo.findOne({ where: { id } });

    if (user === null) {
      return false;
    }

    try {
      await this.authService.deleteUser(user.email);
      await this.userRepo.delete({ id: user.id });
    } catch (error) {
      this.logger.warn(
        `userRepo error deleting (${JSON.stringify(user)}): `,
        error,
      );

      throw error;
    }

    return true;
  }
}
