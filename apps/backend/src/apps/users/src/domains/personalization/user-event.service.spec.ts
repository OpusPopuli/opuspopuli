import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  createMockDbService,
  type MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';
import { UserEventService } from './user-event.service';

describe('UserEventService', () => {
  let service: UserEventService;
  let db: MockDbClient;

  beforeEach(async () => {
    db = createMockDbService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserEventService, { provide: DbService, useValue: db }],
    }).compile();
    service = module.get(UserEventService);
  });

  it('record creates a row with the user.connect relation form', async () => {
    db.userEvent.create.mockResolvedValue({ id: 'e-1' } as never);

    await service.record('u-1', {
      verb: 'open',
      objectType: 'bill',
      objectId: 'bill-1',
    });

    const call = db.userEvent.create.mock.calls[0][0];
    expect(call.data).toMatchObject({
      user: { connect: { id: 'u-1' } },
      verb: 'open',
      objectType: 'bill',
      objectId: 'bill-1',
    });
    // Critical: omits `context` entirely when not provided — Prisma JSON
    // columns reject explicit null from the typed API.
    expect((call.data as { context?: unknown }).context).toBeUndefined();
  });

  it('record passes the context object through when provided', async () => {
    db.userEvent.create.mockResolvedValue({ id: 'e-1' } as never);

    await service.record('u-1', {
      verb: 'dwell',
      objectType: 'bill',
      objectId: 'bill-1',
      context: { dwellMs: 4200, sessionId: 's-9' },
    });

    const call = db.userEvent.create.mock.calls[0][0];
    expect((call.data as { context: unknown }).context).toEqual({
      dwellMs: 4200,
      sessionId: 's-9',
    });
  });

  it('listForUser queries by user with descending occurredAt and default take=100', async () => {
    db.userEvent.findMany.mockResolvedValue([] as never);
    await service.listForUser('u-1');

    expect(db.userEvent.findMany).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
  });

  it('listForUser filters by objectType when provided', async () => {
    db.userEvent.findMany.mockResolvedValue([] as never);
    await service.listForUser('u-1', { take: 25, objectType: 'bill' });

    expect(db.userEvent.findMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', objectType: 'bill' },
      orderBy: { occurredAt: 'desc' },
      take: 25,
    });
  });

  it('resetForUser deletes all events for the user and returns the count', async () => {
    db.userEvent.deleteMany.mockResolvedValue({ count: 42 } as never);

    const removed = await service.resetForUser('u-1');

    expect(db.userEvent.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
    });
    expect(removed).toBe(42);
  });

  it('service exposes no update method (append-only invariant)', () => {
    // Append-only invariant: events are immutable once written. Verify
    // statically that no update-style method exists on the service.
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('updateMany');
    expect(methods).not.toContain('upsert');
  });
});
