import { z } from 'zod';
import {
  CredentialDocumentType,
  Gender,
  TherapistVerificationStatus,
  THERAPY_SPECIALTIES,
} from '../enums';
import { SESSION_RATE_MAX_KSH, SESSION_RATE_MIN_KSH } from '../constants';
import { paginationQuerySchema } from './common';

/** Languages a therapist may list (free-form allowed, these are suggestions). */
export const SPOKEN_LANGUAGES = [
  'English',
  'Swahili',
  'Kalenjin',
  'Kikuyu',
  'Luo',
  'Luhya',
  'Kamba',
  'Kisii',
] as const;

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm');

const specialtyEnum = z.enum(THERAPY_SPECIALTIES as [string, ...string[]]);

/** Shared by the therapist's own rate field and the admin override below (§13.1 bounds). */
const sessionRateKshField = z.coerce
  .number()
  .int()
  .min(SESSION_RATE_MIN_KSH, `Minimum rate is KES ${SESSION_RATE_MIN_KSH}`)
  .max(SESSION_RATE_MAX_KSH, `Maximum rate is KES ${SESSION_RATE_MAX_KSH}`);

/** Therapist submits / updates their professional credentials & public profile. */
export const submitCredentialsSchema = z.object({
  cpbLicenseNumber: z.string().trim().min(3, 'Enter your CPB license number').max(40),
  cpbExpiry: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
    .refine((d) => new Date(d) > new Date(), 'License expiry must be in the future'),
  title: z.string().trim().min(2).max(80),
  gender: z.nativeEnum(Gender),
  bio: z.string().trim().min(40, 'Tell clients a little about your approach').max(2000),
  specialties: z.array(specialtyEnum).min(1, 'Select at least one specialty').max(8),
  languages: z.array(z.string().trim().min(2)).min(1, 'Select at least one language').max(8),
  yearsExperience: z.coerce.number().int().min(0).max(60),
  sessionRateKsh: sessionRateKshField,
});
export type SubmitCredentialsInput = z.infer<typeof submitCredentialsSchema>;

/**
 * Admin override of a therapist's session rate — the therapist still sets
 * their own rate during onboarding (above); this lets an admin correct or
 * adjust it afterward, same KES bounds either way.
 */
export const adminUpdateSessionRateSchema = z.object({ sessionRateKsh: sessionRateKshField });
export type AdminUpdateSessionRateInput = z.infer<typeof adminUpdateSessionRateSchema>;

/** A single weekly availability window. */
export const availabilitySlotSchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    startTime: timeOfDay,
    endTime: timeOfDay,
    isAvailable: z.boolean().default(true),
  })
  .refine((s) => s.startTime < s.endTime, {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const setAvailabilitySchema = z.object({
  slots: z.array(availabilitySlotSchema).max(50),
});
export type SetAvailabilityInput = z.infer<typeof setAvailabilitySchema>;

/** Public therapist discovery query. */
export const therapistSearchSchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  specialty: specialtyEnum.optional(),
  language: z.string().trim().optional(),
  gender: z.nativeEnum(Gender).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['rating', 'price_asc', 'price_desc', 'experience']).default('rating'),
});
export type TherapistSearchQuery = z.infer<typeof therapistSearchSchema>;

/** Admin verification decision. */
export const reviewDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'SUSPEND']),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.decision === 'APPROVE' || (d.reason && d.reason.length >= 5), {
    message: 'A reason is required when rejecting or suspending',
    path: ['reason'],
  });
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

/** Metadata accompanying a document upload (the file itself travels as multipart). */
export const uploadDocumentSchema = z.object({
  type: z.nativeEnum(CredentialDocumentType),
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export interface TherapistDocumentView {
  id: string;
  type: CredentialDocumentType;
  originalName: string | null;
  uploadedAt: string;
}

export { TherapistVerificationStatus, CredentialDocumentType };
