/**
 * AI SOAP-note drafting assistant — port of
 * apps/api/src/modules/clinical/providers/ai-soap.provider.ts. Production
 * uses OpenAI (GPT-4o); no live adapter exists on either backend yet. The
 * mock returns a structured DRAFT skeleton with explicit
 * [THERAPIST TO CONFIRM] placeholders — it never fabricates clinical
 * content. The therapist always reviews and finalizes.
 */

export interface SoapDraftContext {
  patientFirstName: string;
  primaryConcern?: string | null;
  phq9Score?: number | null;
  gad7Score?: number | null;
  durationMins: number;
  therapistModality?: string;
}

export interface SoapDraft {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  riskAssessment: string;
  nextSessionGoals: string[];
}

export interface AiSoapProvider {
  readonly mode: 'mock' | 'live';
  draft(context: SoapDraftContext): Promise<SoapDraft>;
}

export class MockAiSoapProvider implements AiSoapProvider {
  readonly mode = 'mock' as const;

  async draft(ctx: SoapDraftContext): Promise<SoapDraft> {
    const modality = ctx.therapistModality ?? 'CBT';
    const concern = ctx.primaryConcern?.trim() || 'presenting concerns discussed in session';

    return {
      subjective: `${ctx.patientFirstName} attended a ${ctx.durationMins}-minute session and reported ${concern}. [THERAPIST TO CONFIRM client's own words and current symptoms.]`,
      objective: `Client was engaged and oriented. [THERAPIST TO CONFIRM observed affect, mood, and presentation.]${
        ctx.phq9Score != null ? ` Intake PHQ-9 was ${ctx.phq9Score}` : ''
      }${ctx.gad7Score != null ? `, GAD-7 ${ctx.gad7Score}.` : '.'}`,
      assessment: `Working impression consistent with intake screening. [THERAPIST TO CONFIRM clinical formulation using ${modality} framework — this is a draft only.]`,
      plan: `Continue ${modality}-informed sessions. [THERAPIST TO CONFIRM interventions, homework, and frequency.] Review treatment plan goals.`,
      riskAssessment: `[THERAPIST TO CONFIRM risk assessment. Escalate via crisis protocol if any risk to self or others is identified.]`,
      nextSessionGoals: [
        'Review progress on agreed coping strategies',
        '[THERAPIST TO CONFIRM next-session focus]',
      ],
    };
  }
}
