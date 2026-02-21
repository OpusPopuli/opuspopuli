/* eslint-disable @typescript-eslint/no-explicit-any */
import { CreateUserDto } from './users/src/domains/user/dto/create-user.dto';
import { UpdateUserDto } from './users/src/domains/user/dto/update-user.dto';
import { RegisterUserDto } from './users/src/domains/auth/dto/register-user.dto';
import { LoginUserDto } from './users/src/domains/auth/dto/login-user.dto';
import { ChangePasswordDto } from './users/src/domains/auth/dto/change-password.dto';
import { ConfirmForgotPasswordDto } from './users/src/domains/auth/dto/confirm-forgot-password.dto';

import { DocumentStatus } from 'src/common/enums/document.status.enum';

export const config = {
  ai: {
    apiKey: 'myAIApiKey',
    batchSize: 512,
    chunkOverlap: 0,
    chunkSize: 500,
    embeddingModel: 'text-embedding-3-small',
    gptModel: 'gpt-4o-mini',
  },
  apiKeys: {
    mobile: 'myMobileApiKey',
    postman: 'myPostmanApiKey',
    www: 'myWwwApiKey',
  },
  auth: {
    clientId: 'myClientId',
    userPoolId: 'myUserPoolId',
  },
  db: {
    config: {
      database: 'opuspopuli',
      host: 'opuspopuli_db',
      password: 'my_password',
      port: 5432,
      type: 'postgres',
      username: 'postgres',
    },
    connection: 'local',
  },
  file: {
    bucket: 'myBucket',
  },
};

// User Module Test Data
export const users = [
  {
    id: '1',
    email: 'user.one@gmail.com',
    firstName: 'user',
    lastName: 'one',
    created: new Date(),
    updated: new Date(),
  },
  {
    id: '2',
    email: 'user.two@gmail.com',
    firstName: 'user',
    lastName: 'two',
    created: new Date(),
    updated: new Date(),
  },
];

export const createUserDto: CreateUserDto = {
  email: users[0].email,
  username: users[0].email,
  password: 'MyP2$$w0rd!',
  firstName: users[0].firstName,
  lastName: users[0].lastName,
};

export const updateUserDto: UpdateUserDto = {
  email: users[0].email,
  username: users[0].email,
  firstName: users[0].firstName,
  lastName: users[0].lastName,
};

export const loginUserDto: LoginUserDto = {
  email: users[0].email,
  password: 'MyP2$$w0rd!',
};

export const registerUserDto: RegisterUserDto = {
  email: users[0].email,
  username: users[0].email,
  password: 'MyP2$$w0rd!',
  department: 'development',
  clearance: 'confidential',
  admin: true,
  confirm: true,
};

export const changePasswordDto: ChangePasswordDto = {
  accessToken: 'MyAccessToken',
  newPassword: 'MyCurrentP2$$w0rd!',
  currentPassword: 'MyCurrentP2$$w0rd!',
};

export const confirmForgotPasswordDto: ConfirmForgotPasswordDto = {
  email: users[0].email,
  confirmationCode: 'MyConfirmationCode',
  password: 'MyNewP2$$w0rd!',
};

export const documents = [
  {
    userId: 'a',
    key: 'file1-a.pdf',
    size: 12345,
    status: DocumentStatus.PROCESSINGNPENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    userId: 'a',
    key: 'file2-b.pdf',
    size: 54321,
    status: DocumentStatus.PROCESSINGNCOMPLETE,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

export const embeddings = [
  {
    id: '1',
    userId: 'a',
    content: 'Content for file1-a.pdf',
    embedding: '[0.1, 0.2, 0.3]',
    metadata: { source: 'file1-a.pdf' },
  },
  {
    id: '2',
    userId: 'a',
    content: 'Content for file2-a.pdf',
    embedding: '[0.4, 0.5, 0.6]',
    metadata: { source: 'file2-a.pdf' },
  },
];

export const files = documents.map((document: any) => {
  return {
    userId: document.userId,
    filename: document.key,
    size: document.size,
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
});

describe('User Data', () => {
  it('should define all users', async () => {
    expect(users).toBeDefined();
  });
});
