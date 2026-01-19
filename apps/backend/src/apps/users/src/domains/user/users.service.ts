import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { User } from './models/user.model';
import { CreateUserDto } from './dto/create-user.dto';

import { PrismaService } from 'src/db/prisma.service';
import evaluatePrismaError from 'src/db/db.prisma-errors';
import { AuthService } from '../auth/auth.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthStrategy } from 'src/common/enums/auth-strategy.enum';
import { SecureLogger } from 'src/common/services/secure-logger.service';
import { softDeleteWhere, softDeleteData } from 'src/db/prisma.extensions';

@Injectable()
export class UsersService {
  // Use SecureLogger to automatically redact PII (emails, passwords) from log messages
  // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/192
  private readonly logger = new SecureLogger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
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

    let prismaUser: Awaited<ReturnType<typeof this.prisma.user.create>> | null =
      null;
    try {
      prismaUser = await this.prisma.user.create({
        data: {
          email: rest.email,
          firstName: rest.firstName,
          lastName: rest.lastName,
        },
      });
      await this.authService.registerUser({
        email: createUserDto.email,
        username: createUserDto.username,
        password,
      });
    } catch (error) {
      if (prismaUser === null) {
        /** We hit a Prisma Error, just report back */
        const dbError = evaluatePrismaError(error);

        this.logger.warn(
          `prisma error creating (${JSON.stringify(createUserDto)}): ${dbError.message}`,
        );

        throw dbError;
      } else {
        /** We hit an authService Error, clean up the user db entry */
        this.logger.warn(
          `authService error registering (${JSON.stringify(createUserDto)}): ${error instanceof Error ? error.message : String(error)}`,
        );

        this.prisma.user
          .delete({ where: { id: prismaUser.id } })
          .catch((deleteError: Error) => {
            this.logger.error(
              `Error deleting user after authService error: ${deleteError.message}`,
            );
          });

        throw error;
      }
    }

    return User.fromPrisma(prismaUser);
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
    try {
      const prismaUser = await this.prisma.user.create({
        data: { email, authStrategy },
      });
      return User.fromPrisma(prismaUser);
    } catch (error) {
      const dbError = evaluatePrismaError(error);
      this.logger.warn(
        `prisma error creating passwordless user (${email}): ${dbError.message}`,
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
      await this.prisma.user.update({
        where: { id },
        data: { authStrategy },
      });
      return true;
    } catch (error) {
      const dbError = evaluatePrismaError(error);
      this.logger.warn(
        `prisma error updating auth strategy for user ${id}: ${dbError.message}`,
      );
      throw dbError;
    }
  }

  async findAll(): Promise<User[]> {
    const prismaUsers = await this.prisma.user.findMany({
      where: softDeleteWhere,
    });
    return User.fromPrismaArray(prismaUsers);
  }

  async findById(id: string): Promise<User | null> {
    const prismaUser = await this.prisma.user.findFirst({
      where: { id, ...softDeleteWhere },
    });
    return prismaUser ? User.fromPrisma(prismaUser) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const prismaUser = await this.prisma.user.findFirst({
      where: { email, ...softDeleteWhere },
    });
    return prismaUser ? User.fromPrisma(prismaUser) : null;
  }

  async update(
    id: string,
    user: Partial<User> | UpdateUserDto,
  ): Promise<boolean> {
    try {
      await this.prisma.user.update({
        where: { id },
        data: user,
      });
    } catch (error) {
      const dbError = evaluatePrismaError(error);

      this.logger.warn(
        `prisma error updating (${JSON.stringify(user)}): ${dbError.message}`,
      );

      throw dbError;
    }

    return true;
  }

  async delete(id: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id, ...softDeleteWhere },
    });

    if (user === null) {
      return false;
    }

    try {
      await this.authService.deleteUser(user.email);
      // Soft delete instead of hard delete
      await this.prisma.user.update({
        where: { id: user.id },
        data: softDeleteData(),
      });
    } catch (error) {
      this.logger.warn(
        `prisma error deleting (${JSON.stringify(user)}): `,
        error,
      );

      throw error;
    }

    return true;
  }
}
