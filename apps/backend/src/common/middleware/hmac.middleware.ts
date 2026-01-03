import {
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Request, Response, NextFunction } from 'express';

import crypto from 'crypto-js';
import { safeCompare } from '../utils/crypto.utils';

@Injectable()
export class HMACMiddleware implements NestMiddleware {
  private readonly apiKeys: Map<string, string>;
  private readonly logger = new Logger(HMACMiddleware.name, {
    timestamp: true,
  });

  constructor(private readonly configService: ConfigService) {
    this.apiKeys =
      this.configService.get<Map<string, string>>('apiKeys') ||
      new Map<string, string>();
    this.logger.log(
      `Loaded API keys for clients: ${Array.from(this.apiKeys.keys()).join(', ') || 'NONE'}`,
    );
  }

  private async validateRequest(
    req: Request,
    _res: Response,
    next: NextFunction,
  ) {
    // Use X-HMAC-Auth header (Proxy-Authorization is stripped by browsers)
    const headerValue = req.headers['x-hmac-auth'];
    const proxyAuth = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    const hmac = proxyAuth?.split(' ');

    if (hmac?.length === 2 && hmac[0].toLowerCase() === 'hmac') {
      const credentials = JSON.parse(hmac[1]);

      const headers = credentials.headers?.split(',');
      const signatureString = headers
        ?.map((key: string) => {
          if (key.toLowerCase() === '@request-target') {
            return `${req.method.toLocaleLowerCase()} ${req.path}`;
          } else {
            return `${key.toLowerCase()}: ${req.headers[key]}`;
          }
        })
        .join('\n');

      let signatureHash = '';
      const apiKey = this.apiKeys.get(credentials.username) || '';

      switch (credentials.algorithm) {
        case 'hmac-sha1':
          signatureHash = crypto.enc.Base64.stringify(
            crypto.HmacSHA1(signatureString, apiKey),
          );
          break;
        case 'hmac-sha256':
          signatureHash = crypto.enc.Base64.stringify(
            crypto.HmacSHA256(signatureString, apiKey),
          );
          break;
        case 'hmac-sha512':
          signatureHash = crypto.enc.Base64.stringify(
            crypto.HmacSHA512(signatureString, apiKey),
          );
          break;
      }

      // Use constant-time comparison to prevent timing attacks
      // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/195
      if (signatureHash && safeCompare(signatureHash, credentials.signature)) {
        return next();
      }
    }

    throw new UnauthorizedException('Invalid X-HMAC-Auth', {
      cause: new Error('HMAC validation failed'),
      description: 'HMAC authentication is invalid or missing.',
    });
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Skip HMAC validation for OPTIONS preflight requests
    if (req.method === 'OPTIONS') {
      return next();
    }

    return this.validateRequest(req, res, next);
  }
}
