import { BriefingSummaryValidatorService } from './briefing-summary-validator.service';

describe('BriefingSummaryValidatorService', () => {
  const service = new BriefingSummaryValidatorService();
  const enCtx = { language: 'en' as const };
  const esCtx = { language: 'es' as const };

  // 35-word neutral paragraph used as the happy-path baseline.
  const NEUTRAL_EN =
    'Welcome back, Rodney. The briefing below holds 5 bills, 7 representatives, 5 committees, and 1 proposition that overlap with the signals you shared. Three of the bills have a comment window opening soon — the rest are quieter.';

  describe('happy path', () => {
    it('accepts a neutral descriptive paragraph in the word window', () => {
      expect(service.validate(NEUTRAL_EN, enCtx).valid).toBe(true);
    });
  });

  describe('basic shape', () => {
    it('rejects empty paragraph', () => {
      const result = service.validate('', enCtx);
      expect(result.valid).toBe(false);
      expect(result.rejectionReason).toBe('empty');
    });

    it('rejects under-30-word paragraph', () => {
      const result = service.validate(
        'Hi neighbor. Here is the briefing.',
        enCtx,
      );
      expect(result.valid).toBe(false);
      expect(result.rejectionReason).toBe('word-count');
    });

    it('rejects over-60-word paragraph', () => {
      const tooLong = Array(80).fill('word').join(' ');
      const result = service.validate(tooLong, enCtx);
      expect(result.valid).toBe(false);
      expect(result.rejectionReason).toBe('word-count');
    });
  });

  describe('commitment-4 persuasion vocabulary (EN)', () => {
    // Each variant smuggles ONE forbidden phrase into a 30-60 word
    // paragraph so the word-count gate doesn't preempt the persuasion
    // check.
    const FORBIDDEN = [
      `${NEUTRAL_EN} You should call your rep before they close.`,
      `${NEUTRAL_EN} You need to read the housing card before Friday.`,
      `${NEUTRAL_EN} Make sure to act before the windows close on Friday.`,
      `${NEUTRAL_EN} Don't miss the housing comment window on Friday.`,
      `${NEUTRAL_EN} These are critical for you to track every week.`,
      `${NEUTRAL_EN} We urge you to read these before Friday lands.`,
      `${NEUTRAL_EN} Vote yes on the housing one before Friday lands.`,
      `${NEUTRAL_EN} Support this bill before the Friday window closes.`,
      `${NEUTRAL_EN} Your voice matters in the Friday comment window.`,
    ];
    it.each(FORBIDDEN)('rejects persuasive phrase variant', (input) => {
      const result = service.validate(input, enCtx);
      expect(result.valid).toBe(false);
      expect(result.rejectionReason).toBe('persuasion-language');
    });
  });

  describe('commitment-4 persuasion vocabulary (ES)', () => {
    // 38-word neutral ES baseline so the persuasion-tagged variants
    // stay inside [30, 60].
    const NEUTRAL_ES =
      'Bienvenido. Abajo hay proyectos de ley, representantes, comités y proposiciones alineados con las señales que compartiste. Dos de los proyectos tienen una ventana de comentarios abierta esta semana, y el resto avanzan despacio.';
    const FORBIDDEN = [
      `${NEUTRAL_ES} Debes leer el de vivienda antes del viernes.`,
      `${NEUTRAL_ES} Vota a favor del proyecto de vivienda antes del viernes.`,
      `${NEUTRAL_ES} Apoya esta medida antes del viernes próximo.`,
      `${NEUTRAL_ES} Esto es crucial para ti esta semana entera.`,
      `${NEUTRAL_ES} Tu voz importa en la ventana del viernes.`,
    ];
    it.each(FORBIDDEN)('rejects persuasive Spanish variant', (input) => {
      const result = service.validate(input, esCtx);
      expect(result.valid).toBe(false);
      expect(result.rejectionReason).toBe('persuasion-language');
    });
  });

  describe('commitment-8 surveillance language', () => {
    it('rejects "we noticed you" framing', () => {
      const text =
        'Welcome back, Rodney. We noticed you opened the housing card last week, so the briefing leans into similar bills — three have a comment window opening within the next month or so today.';
      const result = service.validate(text, enCtx);
      expect(result.valid).toBe(false);
      expect(result.rejectionReason).toBe('persuasion-language');
    });
  });

  describe('hallucinated bill citation', () => {
    it('rejects a paragraph that invents a bill number', () => {
      const text =
        'Welcome back, Rodney. The briefing below holds AB 1234, SB 50, and three other bills matched to your signals — the housing one is moving quickly through committee this week today.';
      const result = service.validate(text, enCtx);
      expect(result.valid).toBe(false);
      expect(result.rejectionReason).toBe('fabricated-claim');
    });
  });
});
