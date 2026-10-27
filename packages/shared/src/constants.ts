/** Platform-wide constants derived from the SDLC document. */

import { RiskLevel } from './enums';

/** Befrienders Kenya crisis hotline (SDLC §8.3, §12.1). */
export const BEFRIENDERS_KENYA_HOTLINE = '0800723253';

/** Marker emitted by the intake AI when suicidal ideation is detected (§15.1). */
export const CRISIS_ALERT_TOKEN = 'CRISIS_ALERT';

/** All scheduling is East Africa Time (§18.1). */
export const PLATFORM_TIMEZONE = 'Africa/Nairobi';

/** Supported session durations in minutes. */
export const SESSION_DURATIONS_MINS = [30, 45, 60, 90] as const;

/** A new patient's first 30-minute session is free (§13.2 Free tier). */
export const FREE_SESSION_DURATION_MINS = 30;
export const FREE_SESSIONS_PER_PATIENT = 1;

/** Platform commission band on each paid session (§13.1). */
export const PLATFORM_COMMISSION_MIN = 0.2;
export const PLATFORM_COMMISSION_MAX = 0.6;
export const PLATFORM_COMMISSION_DEFAULT = 0.25;

/** Therapist session-rate bounds in KES (§13.1). */
export const SESSION_RATE_MIN_KSH = 1000;
export const SESSION_RATE_MAX_KSH = 5000;

/** Appointment reminder offsets before start time (§3.4 step 5). */
export const REMINDER_OFFSETS_MINUTES = [24 * 60, 60, 15] as const;

/** Rate limits (§3.2 Layer 2). */
export const RATE_LIMIT_PER_USER_PER_MIN = 100;
export const RATE_LIMIT_PER_THERAPIST_PER_MIN = 1000;

/** Stricter per-route limits on security-sensitive auth endpoints (anti-bruteforce). */
export const AUTH_LOGIN_RATE_LIMIT = 5;
export const AUTH_OTP_REQUEST_RATE_LIMIT = 3;
export const AUTH_PASSWORD_FORGOT_RATE_LIMIT = 3;
export const AUTH_MFA_VERIFY_RATE_LIMIT = 5;
export const AUTH_OTP_VERIFY_RATE_LIMIT = 5;
export const AUTH_RATE_LIMIT_TTL_MS = 60_000;

/** Token lifetimes (§7.2). */
export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL = '7d';

/** OTP configuration. */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;

/** Right-to-erasure SLA in days (Kenya DPA 2019, §7.3). */
export const ERASURE_SLA_DAYS = 30;

/** Audit-log retention in years (§2.3). */
export const AUDIT_RETENTION_YEARS = 7;

/** Risk-level → operational action mapping (§12.1). */
export const RISK_LEVEL_ACTIONS: Record<
  RiskLevel,
  { bookingWindow: string; adminAlert: boolean; showCrisisHotline: boolean }
> = {
  MINIMAL: { bookingWindow: 'optional', adminAlert: false, showCrisisHotline: false },
  MILD: { bookingWindow: '1-week', adminAlert: false, showCrisisHotline: false },
  MODERATE: { bookingWindow: '48-hours', adminAlert: false, showCrisisHotline: false },
  MODERATELY_SEVERE: { bookingWindow: 'same-day', adminAlert: true, showCrisisHotline: false },
  SEVERE: { bookingWindow: 'same-day', adminAlert: true, showCrisisHotline: true },
};

/** Kenya counties (subset relevant to launch + national list head). */
export const KENYA_COUNTIES = [
  'Uasin Gishu',
  'Nakuru',
  'Kisumu',
  'Nairobi',
  'Trans Nzoia',
  'Elgeyo-Marakwet',
  'Nandi',
  'Bungoma',
  'Kakamega',
  'Baringo',
] as const;
