import { Logger } from '@nestjs/common';
import type { Counter, Histogram } from 'prom-client';
import { PromMetricsObserver } from './prom-metrics-observer';

describe('PromMetricsObserver (M2)', () => {
  // `enableExemplars: false` deliberately. Without the property these
  // fixtures traversed the "prom-client renamed the flag" degradation branch
  // instead of the ordinary no-exemplar path, so the baseline tests were
  // quietly exercising the wrong case (and emitting a warning while doing it).
  const histogram = {
    observe: jest.fn(),
    enableExemplars: false,
  } as unknown as Histogram<string>;
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
    // Restored: `clearAllMocks` clears calls, not the spy itself, and neither
    // this package's jest config nor the root sets `restoreMocks` — so an
    // unrestored spy leaves Logger.warn patched for the rest of the file.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    expect(() => {
      observer.observe('llm_request_duration_seconds', 1);
      observer.increment('llm_tokens_total', 1);
    }).not.toThrow();
    warn.mockRestore();
  });
  describe('exemplars (M1)', () => {
    /** A histogram that reports exemplar support, as prom-client's does. */
    const exemplarHistogram = (enabled: boolean) =>
      ({
        observe: jest.fn(),
        enableExemplars: enabled,
      }) as unknown as Histogram<string> & { enableExemplars: boolean };

    const traceLabels = { trace_id: 'abcdef0123456789abcdef0123456789' };

    it('uses the object overload when the histogram supports exemplars', () => {
      const stage = exemplarHistogram(true);
      const observer = new PromMetricsObserver(
        undefined,
        undefined,
        stage,
        counter,
      );

      observer.observe(
        'pipeline_stage_duration_seconds',
        42.5,
        { stage: 'llm' },
        traceLabels,
      );

      expect(stage.observe).toHaveBeenCalledWith({
        labels: { stage: 'llm' },
        value: 42.5,
        exemplarLabels: traceLabels,
      });
    });

    it('falls back to the positional overload when it does not', () => {
      // The trap this dispatch exists for. `enableExemplars` rebinds
      // `observe` at construction, so the object form on a histogram without
      // it is read as a LABEL SET: prom-client throws `Added label "labels"
      // is not included in initial labelset`, or silently records garbage on
      // a metric that does declare labels. A caller cannot know how a metric
      // was declared, and withStage sends a trace id to every histogram.
      const stage = exemplarHistogram(false);
      const observer = new PromMetricsObserver(
        undefined,
        undefined,
        stage,
        counter,
      );

      observer.observe(
        'pipeline_stage_duration_seconds',
        42.5,
        { stage: 'llm' },
        traceLabels,
      );

      expect(stage.observe).toHaveBeenCalledWith({ stage: 'llm' }, 42.5);
    });

    it('keeps the object overload when there is no exemplar to attach', () => {
      // The bug this replaces: `withStage` attaches no exemplar when no
      // tracing SDK is registered — the common case — and an
      // exemplar-enabled histogram has NO positional overload left. Calling
      // it positionally made prom-client read the label object as its
      // argument bag, so `value` arrived `undefined` and the observation
      // silently never landed. An empty exemplar set is prom-client's own
      // no-op, so the sample is still recorded.
      const stage = exemplarHistogram(true);
      const observer = new PromMetricsObserver(
        undefined,
        undefined,
        stage,
        counter,
      );

      observer.observe('pipeline_stage_duration_seconds', 1, { stage: 'ocr' });
      observer.observe(
        'pipeline_stage_duration_seconds',
        2,
        { stage: 'ocr' },
        {},
      );

      expect(stage.observe).toHaveBeenNthCalledWith(1, {
        labels: { stage: 'ocr' },
        value: 1,
        exemplarLabels: {},
      });
      expect(stage.observe).toHaveBeenNthCalledWith(2, {
        labels: { stage: 'ocr' },
        value: 2,
        exemplarLabels: {},
      });
    });

    it('warns instead of throwing when prom-client rejects an observation', () => {
      // An exemplar label set over 128 chars is a RangeError from
      // prom-client. Instrumentation must never be why a sync fails.
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const stage = exemplarHistogram(true);
      (stage.observe as jest.Mock).mockImplementation(() => {
        throw new RangeError(
          'Label set size must be smaller than 128 UTF-8 chars',
        );
      });
      const observer = new PromMetricsObserver(
        undefined,
        undefined,
        stage,
        counter,
      );

      expect(() =>
        observer.observe(
          'pipeline_stage_duration_seconds',
          1,
          { stage: 'llm' },
          traceLabels,
        ),
      ).not.toThrow();

      expect(warn.mock.calls.map(String).join()).toContain('128 UTF-8 chars');
      warn.mockRestore();
    });

    it('warns instead of throwing when a counter rejects an increment', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const items = { inc: jest.fn() } as unknown as Counter<string>;
      (items.inc as jest.Mock).mockImplementation(() => {
        throw new Error(
          'Added label "nope" is not included in initial labelset',
        );
      });
      const observer = new PromMetricsObserver(
        undefined,
        undefined,
        undefined,
        items,
      );

      expect(() =>
        observer.increment('pipeline_items_total', 1, { nope: 'x' }),
      ).not.toThrow();

      expect(warn.mock.calls.map(String).join()).toContain('initial labelset');
      warn.mockRestore();
    });

    it('warns, and stays safe, if prom-client stops exposing the flag', () => {
      // A dependency bump that renames `enableExemplars` would otherwise make
      // every exemplar vanish while the panel kept drawing — dots with
      // nothing behind them, and no error anywhere.
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const stage = { observe: jest.fn() } as unknown as Histogram<string>;
      const observer = new PromMetricsObserver(
        undefined,
        undefined,
        stage,
        counter,
      );

      observer.observe(
        'pipeline_stage_duration_seconds',
        1,
        { stage: 'llm' },
        traceLabels,
      );

      expect(stage.observe).toHaveBeenCalledWith({ stage: 'llm' }, 1);
      expect(warn.mock.calls.map(String).join()).toContain('enableExemplars');
      warn.mockRestore();
    });

    it('keeps each metric on its own instrument', () => {
      // Four injected metrics keyed by name: a mix-up here would record
      // pipeline durations onto the llm histogram, where the labels differ
      // and nothing would error.
      const llm = { observe: jest.fn() } as unknown as Histogram<string>;
      const stage = exemplarHistogram(true);
      const observer = new PromMetricsObserver(llm, counter, stage, counter);

      observer.observe('llm_request_duration_seconds', 1, { phase: 'decode' });
      observer.observe('pipeline_stage_duration_seconds', 2, { stage: 'llm' });

      // Different overloads, because the two metrics are declared
      // differently — which is the point of dispatching on the instance.
      expect(llm.observe).toHaveBeenCalledWith({ phase: 'decode' }, 1);
      expect(stage.observe).toHaveBeenCalledWith({
        labels: { stage: 'llm' },
        value: 2,
        exemplarLabels: {},
      });
      expect(llm.observe).toHaveBeenCalledTimes(1);
      expect(stage.observe).toHaveBeenCalledTimes(1);
    });
  });
});
