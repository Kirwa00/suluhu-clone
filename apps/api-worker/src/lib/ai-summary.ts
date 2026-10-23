import type { RiskLevel } from '@suluhu/shared';

/**
 * AI intake-summary provider — port of
 * apps/api/src/modules/intake/providers/ai-summary.provider.ts. No live
 * OpenAI adapter exists on either backend yet; the mock produces the same
 * deterministic, empathetic, non-diagnostic summary.
 */

export interface AiSummaryRequest {
  riskLevel: RiskLevel;
  phq9Score: number;
  gad7Score: number;
  cageScore: number;
  crisisFlag: boolean;
  primaryConcern?: string | null;
}

export interface AiSummaryProvider {
  readonly mode: 'mock' | 'live';
  summarize(request: AiSummaryRequest): Promise<string>;
}

const TONE: Record<RiskLevel, string> = {
  MINIMAL:
    'Your responses suggest your mood and stress are in a manageable range right now. That’s good to hear.',
  MILD: 'Your responses suggest you’ve been carrying some mild difficulty lately. Talking to someone can help you feel steadier.',
  MODERATE:
    'Your responses suggest a moderate level of distress. Connecting with a therapist soon would be a supportive next step.',
  MODERATELY_SEVERE:
    'Your responses suggest you’ve been going through quite a lot. We’d encourage you to speak with a therapist within the next day or so.',
  SEVERE:
    'Thank you for being honest — your responses suggest you’re carrying a heavy load right now. You deserve support, and we’re here to help you find it quickly.',
};

export class MockAiSummaryProvider implements AiSummaryProvider {
  readonly mode = 'mock' as const;

  async summarize(req: AiSummaryRequest): Promise<string> {
    const parts: string[] = ['Thank you for taking the time to check in with yourself today.'];
    parts.push(TONE[req.riskLevel]);

    if (req.gad7Score >= 10) {
      parts.push(
        'You mentioned anxiety has been present — that’s something therapy can really help with.',
      );
    }
    if (req.cageScore >= 2) {
      parts.push(
        'You also shared some concerns around alcohol; a counsellor can explore this with you without judgement.',
      );
    }
    if (req.primaryConcern) {
      parts.push(`You told us a little about what’s on your mind, and we’ll keep that in focus.`);
    }
    if (req.crisisFlag) {
      parts.push(
        'Because some of what you shared is serious, please know support is available right now — you are not alone.',
      );
    } else {
      parts.push(
        'We’ve suggested a few therapists who fit what you’re looking for. Take your time.',
      );
    }
    return parts.join(' ');
  }
}
