import { Logger } from '@nestjs/common';
import type { Counter, Histogram } from 'prom-client';
import { PromMetricsObserver } from './prom-metrics-observer';

describe('PromMetricsObserver (M2)', () => {
  const histogram = { observe: jest.fn() } as unknown as Histogram<string>;
  const counter = { inc: jest.fn() } as unknown as Counter<string>;

  beforeEach(() => jest.clearAllMocks());

  it('observes into the injected histogram, labels first', () => {
    // prom-client takes (labels, value) in that order. Reversed, it throws
    // at runtime on a labelled metric — not at compile time, because both
    // overloads exist.
    const observer = new PromMetricsObserver(histogram, counter);

    observer.observe('llm_request_duration_seconds', 4.5, {
      lane: 'ingestion',
      model: 'm',
      phase: 'prefill',
    });

    expect(histogram.observe).toHaveBeenCalledWith(
      { lane: 'ingestion', model: 'm', phase: 'prefill' },
      4.5,
    );
  });

  it('increments the injected counter', () => {
    const observer = new PromMetricsObserver(histogram, counter);

    observer.increment('llm_tokens_total', 1200, { direction: 'in' });

    expect(counter.inc).toHaveBeenCalledWith({ direction: 'in' }, 1200);
  });

  it('defaults a counter increment to 1', () => {
    const observer = new PromMetricsObserver(histogram, counter);

    observer.increment('llm_tokens_total');

    expect(counter.inc).toHaveBeenCalledWith({}, 1);
  });

  it('drops an unregistered metric with a warning instead of throwing', () => {
    // An observation is not worth an exception on a request path. But a
    // silent drop is how an instrumented system reads as idle, so it is
    // said out loud.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const observer = new PromMetricsObserver(histogram, counter);

    expect(() =>
      observer.observe('pipeline_stage_duration_seconds', 1),
    ).not.toThrow();

    expect(
      warn.mock.calls
        .map(String)
        .some((m) => m.includes('pipeline_stage_duration_seconds')),
    ).toBe(true);
    warn.mockRestore();
  });

  it('warns once per unknown metric, not once per observation', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const observer = new PromMetricsObserver(histogram, counter);

    for (let i = 0; i < 50; i++) observer.observe('nope', 1);

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('does not throw when no metrics are injected at all', () => {
    // A service that declares none of these must still boot and run.
    const observer = new PromMetricsObserver(undefined, undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    expect(() => {
      observer.observe('llm_request_duration_seconds', 1);
      observer.increment('llm_tokens_total', 1);
    }).not.toThrow();
  });
});
