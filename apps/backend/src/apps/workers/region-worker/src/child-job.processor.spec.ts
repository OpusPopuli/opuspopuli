import { Logger } from '@nestjs/common';
import { createWorker } from '@opuspopuli/queue-provider';
import { ChildJobProcessor } from './child-job.processor';

jest.mock('@opuspopuli/queue-provider', () => ({
  ...jest.requireActual('@opuspopuli/queue-provider'),
  createWorker: jest.fn(),
}));

class Probe extends ChildJobProcessor<{ id: string }, string> {
  protected readonly logger = new Logger('Probe');
  protected readonly queueName = 'probe';
  constructor() {
    super({} as never, { get: () => undefined } as never);
  }
  protected run(): Promise<string> {
    return Promise.resolve('ok');
  }
  protected describe(job: { id: string }): string {
    return job.id;
  }
}

describe('ChildJobProcessor', () => {
  const started = (autorun: boolean) => {
    (createWorker as jest.Mock).mockReturnValue({
      opts: { autorun },
      close: jest.fn(),
    });
    const probe = new Probe();
    const log = jest
      .spyOn((probe as unknown as { logger: Logger }).logger, 'log')
      .mockImplementation(() => undefined);
    probe.onApplicationBootstrap();
    return log;
  };

  it('says the worker started when this process consumes the queue', () => {
    expect(started(true)).toHaveBeenCalledWith('probe worker started');
  });

  it('says nothing more when it does not — the factory already said why (WORKER_QUEUES)', () => {
    expect(started(false)).not.toHaveBeenCalled();
  });
});
