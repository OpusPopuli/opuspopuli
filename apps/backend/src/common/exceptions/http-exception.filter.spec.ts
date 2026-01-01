import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { Request, Response } from 'express';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockArgumentsHost: Partial<ArgumentsHost>;

  beforeEach(() => {
    filter = new HttpExceptionFilter();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();

    mockRequest = {
      url: '/api/test',
    };

    mockResponse = {
      status: mockStatus,
      json: mockJson,
    };

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('HTTP error responses', () => {
    it('should return formatted error response for HttpException', () => {
      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: HttpStatus.BAD_REQUEST,
          message: 'Test error',
          path: '/api/test',
        }),
      );
    });

    it('should include timestamp in response', () => {
      const exception = new BadRequestException('Invalid input');

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
        }),
      );

      const response = mockJson.mock.calls[0][0];
      expect(() => new Date(response.timestamp)).not.toThrow();
    });

    it('should include request path in response', () => {
      mockRequest.url = '/api/users/123';
      const exception = new NotFoundException('User not found');

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/api/users/123',
        }),
      );
    });
  });

  describe('status code mapping', () => {
    it('should map 400 Bad Request correctly', () => {
      const exception = new BadRequestException('Bad request');

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 400,
        }),
      );
    });

    it('should map 401 Unauthorized correctly', () => {
      const exception = new UnauthorizedException('Invalid credentials');

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 401,
        }),
      );
    });

    it('should map 403 Forbidden correctly', () => {
      const exception = new ForbiddenException('Access denied');

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 403,
        }),
      );
    });

    it('should map 404 Not Found correctly', () => {
      const exception = new NotFoundException('Resource not found');

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 404,
        }),
      );
    });

    it('should map 500 Internal Server Error correctly', () => {
      const exception = new InternalServerErrorException('Server error');

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 500,
        }),
      );
    });

    it('should handle custom status codes', () => {
      const exception = new HttpException('Too Many Requests', 429);

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockStatus).toHaveBeenCalledWith(429);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 429,
        }),
      );
    });
  });

  describe('message extraction', () => {
    it('should extract message from string response', () => {
      const exception = new HttpException('Simple error message', 400);

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Simple error message',
        }),
      );
    });

    it('should extract message from object response with message property', () => {
      const exception = new HttpException(
        { message: 'Error from object', statusCode: 400 },
        400,
      );

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Error from object',
        }),
      );
    });

    it('should extract message array from validation errors', () => {
      const exception = new BadRequestException({
        message: ['email must be valid', 'password is required'],
        error: 'Validation failed',
      });

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          message: ['email must be valid', 'password is required'],
        }),
      );
    });

    it('should fallback to exception message when response has no message', () => {
      const exception = new HttpException(
        { error: 'Something went wrong' },
        500,
      );

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      // When response object has no 'message' property, it falls back to exception.message
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Http Exception',
        }),
      );
    });
  });

  describe('sensitive data not leaked', () => {
    it('should not expose stack traces', () => {
      const exception = new InternalServerErrorException('Database error');

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      const response = mockJson.mock.calls[0][0];
      expect(response.stack).toBeUndefined();
      expect(response.stackTrace).toBeUndefined();
    });

    it('should not expose internal error details', () => {
      const exception = new HttpException(
        {
          message: 'Operation failed',
          internalDetails: 'Connection to db01.internal failed',
          password: 'secret123',
        },
        500,
      );

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      const response = mockJson.mock.calls[0][0];
      expect(response.internalDetails).toBeUndefined();
      expect(response.password).toBeUndefined();
    });

    it('should only include code, timestamp, message, and path', () => {
      const exception = new BadRequestException('Invalid input');

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      const response = mockJson.mock.calls[0][0];
      expect(Object.keys(response).sort()).toEqual(
        ['code', 'message', 'path', 'timestamp'].sort(),
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty message', () => {
      const exception = new HttpException('', 400);

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '',
        }),
      );
    });

    it('should handle undefined URL', () => {
      mockRequest.url = undefined;
      const exception = new BadRequestException('Error');

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          path: undefined,
        }),
      );
    });

    it('should handle complex URL paths', () => {
      mockRequest.url = '/api/v1/users/123/posts?page=1&limit=10';
      const exception = new NotFoundException('Post not found');

      filter.catch(exception, mockArgumentsHost as ArgumentsHost);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/api/v1/users/123/posts?page=1&limit=10',
        }),
      );
    });
  });
});
