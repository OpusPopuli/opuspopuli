import { HmacRemoteGraphQLDataSource } from './hmac-data-source';
import { HmacSignerService } from 'src/common/services/hmac-signer.service';
import * as otelApi from '@opentelemetry/api';

describe('HmacRemoteGraphQLDataSource', () => {
  let dataSource: HmacRemoteGraphQLDataSource;
  let mockHmacSigner: jest.Mocked<HmacSignerService>;

  beforeEach(() => {
    mockHmacSigner = {
      isEnabled: jest.fn().mockReturnValue(false),
      signGraphQLRequest: jest.fn(),
    } as unknown as jest.Mocked<HmacSignerService>;

    dataSource = new HmacRemoteGraphQLDataSource(
      { url: 'http://localhost:4001/graphql' },
      mockHmacSigner,
    );
  });

  describe('willSendRequest', () => {
    it('should propagate W3C trace context headers to subgraph requests', () => {
      const mockHeaders = new Map<string, string>();
      const mockRequest = {
        http: {
          url: 'http://localhost:4001/graphql',
          headers: {
            set: (key: string, value: string) => mockHeaders.set(key, value),
          },
        },
      };

      // Mock OTel propagation to inject a traceparent header
      jest
        .spyOn(otelApi.propagation, 'inject')
        .mockImplementation((_context, carrier: Record<string, string>) => {
          carrier['traceparent'] =
            '00-abcdef1234567890abcdef1234567890-1234567890abcdef-01';
        });

      dataSource.willSendRequest({
        request: mockRequest,
        context: {},
      } as unknown as Parameters<typeof dataSource.willSendRequest>[0]);

      expect(otelApi.propagation.inject).toHaveBeenCalled();
      expect(mockHeaders.get('traceparent')).toBe(
        '00-abcdef1234567890abcdef1234567890-1234567890abcdef-01',
      );

      jest.restoreAllMocks();
    });
  });
});
