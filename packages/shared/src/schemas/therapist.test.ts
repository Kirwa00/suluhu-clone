import { describe, expect, it } from 'vitest';
import { Gender, TherapySpecialty } from '../enums';
import { SESSION_RATE_MAX_KSH, SESSION_RATE_MIN_KSH } from '../constants';
import {
  adminUpdateSessionRateSchema,
  availabilitySlotSchema,
  reviewDecisionSchema,
  setAvailabilitySchema,
  submitCredentialsSchema,
  therapistSearchSchema,
} from './therapist';

const VALID_CREDENTIALS = {
  cpbLicenseNumber: ' CPB/2024/0187 ',
  cpbExpiry: '2031-12-31',
  title: 'Clinical Psychologist',
  gender: Gender.FEMALE,
  bio: 'I work with adults using CBT and trauma-informed care across the Rift Valley region.',
  specialties: [TherapySpecialty.ANXIETY, TherapySpecialty.TRAUMA_PTSD],
  languages: ['English', 'Swahili'],
  yearsExperience: 8,
  sessionRateKsh: 2500,
};

describe('submitCredentialsSchema', () => {
  it('trims the license number and coerces numeric strings', () => {
    const parsed = submitCredentialsSchema.parse({
      ...VALID_CREDENTIALS,
      yearsExperience: '8',
      sessionRateKsh: '2500',
    });
    expect(parsed.cpbLicenseNumber).toBe('CPB/2024/0187');
    expect(parsed.yearsExperience).toBe(8);
    expect(parsed.sessionRateKsh).toBe(2500);
  });

  it('rejects an expired license', () => {
    const result = submitCredentialsSchema.safeParse({
      ...VALID_CREDENTIALS,
      cpbExpiry: '2020-01-01',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('License expiry must be in the future');
    }
  });

  it('accepts the session-rate bounds and rejects rates outside them', () => {
    for (const sessionRateKsh of [SESSION_RATE_MIN_KSH, SESSION_RATE_MAX_KSH]) {
      expect(
        submitCredentialsSchema.safeParse({ ...VALID_CREDENTIALS, sessionRateKsh }).success,
      ).toBe(true);
    }
    for (const sessionRateKsh of [SESSION_RATE_MIN_KSH - 1, SESSION_RATE_MAX_KSH + 1]) {
      expect(
        submitCredentialsSchema.safeParse({ ...VALID_CREDENTIALS, sessionRateKsh }).success,
      ).toBe(false);
    }
  });

  it.each([
    [{ cpbLicenseNumber: 'CP' }, 'license too short'],
    [{ cpbExpiry: '31-12-2031' }, 'non-ISO expiry'],
    [{ bio: 'Too short a bio.' }, 'bio under 40 characters'],
    [{ specialties: [] }, 'no specialty selected'],
    [{ specialties: ['ASTROLOGY'] }, 'unknown specialty'],
    [{ languages: [] }, 'no language selected'],
    [{ yearsExperience: -1 }, 'negative experience'],
    [{ yearsExperience: 61 }, 'implausible experience'],
    [{ gender: 'UNKNOWN' }, 'unknown gender'],
  ])('rejects %o (%s)', (overrides) => {
    expect(submitCredentialsSchema.safeParse({ ...VALID_CREDENTIALS, ...overrides }).success).toBe(
      false,
    );
  });
});

describe('adminUpdateSessionRateSchema', () => {
  it('accepts the same bounds as submitCredentialsSchema and coerces numeric strings', () => {
    for (const sessionRateKsh of [SESSION_RATE_MIN_KSH, SESSION_RATE_MAX_KSH]) {
      const parsed = adminUpdateSessionRateSchema.parse({ sessionRateKsh: String(sessionRateKsh) });
      expect(parsed.sessionRateKsh).toBe(sessionRateKsh);
    }
  });

  it('rejects rates outside the bounds', () => {
    for (const sessionRateKsh of [SESSION_RATE_MIN_KSH - 1, SESSION_RATE_MAX_KSH + 1]) {
      expect(adminUpdateSessionRateSchema.safeParse({ sessionRateKsh }).success).toBe(false);
    }
  });
});

describe('availabilitySlotSchema', () => {
  it('defaults a slot to available and coerces the weekday', () => {
    expect(
      availabilitySlotSchema.parse({ dayOfWeek: '2', startTime: '09:00', endTime: '12:00' }),
    ).toEqual({ dayOfWeek: 2, startTime: '09:00', endTime: '12:00', isAvailable: true });
  });

  it('rejects an end time at or before the start time', () => {
    const result = availabilitySlotSchema.safeParse({
      dayOfWeek: 2,
      startTime: '12:00',
      endTime: '09:00',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['endTime']);
    }
    expect(
      availabilitySlotSchema.safeParse({ dayOfWeek: 2, startTime: '09:00', endTime: '09:00' })
        .success,
    ).toBe(false);
  });

  it.each([
    [{ dayOfWeek: 7 }, 'weekday out of range'],
    [{ startTime: '9:00' }, 'unpadded hour'],
    [{ endTime: '24:00' }, 'hour out of range'],
    [{ endTime: '12:60' }, 'minute out of range'],
  ])('rejects %o (%s)', (overrides) => {
    expect(
      availabilitySlotSchema.safeParse({
        dayOfWeek: 2,
        startTime: '09:00',
        endTime: '12:00',
        ...overrides,
      }).success,
    ).toBe(false);
  });
});

describe('setAvailabilitySchema', () => {
  const slot = { dayOfWeek: 1, startTime: '08:00', endTime: '17:00' };

  it('accepts a weekly schedule', () => {
    expect(setAvailabilitySchema.parse({ slots: [slot] }).slots).toHaveLength(1);
  });

  it('rejects more than 50 windows', () => {
    expect(setAvailabilitySchema.safeParse({ slots: Array(51).fill(slot) }).success).toBe(false);
  });
});

describe('therapistSearchSchema', () => {
  it('defaults to rating sort with the shared pagination defaults', () => {
    expect(therapistSearchSchema.parse({})).toEqual({ page: 1, pageSize: 20, sort: 'rating' });
  });

  it('coerces price filters from the query string', () => {
    const parsed = therapistSearchSchema.parse({
      q: '  trauma  ',
      specialty: TherapySpecialty.TRAUMA_PTSD,
      minPrice: '1000',
      maxPrice: '3000',
      sort: 'price_asc',
    });
    expect(parsed).toMatchObject({
      q: 'trauma',
      minPrice: 1000,
      maxPrice: 3000,
      sort: 'price_asc',
    });
  });

  it.each([
    [{ sort: 'cheapest' }, 'unknown sort'],
    [{ specialty: 'ASTROLOGY' }, 'unknown specialty'],
    [{ minPrice: -1 }, 'negative price'],
  ])('rejects %o (%s)', (input) => {
    expect(therapistSearchSchema.safeParse(input).success).toBe(false);
  });
});

describe('reviewDecisionSchema', () => {
  it('approves without a reason', () => {
    expect(reviewDecisionSchema.parse({ decision: 'APPROVE' })).toEqual({ decision: 'APPROVE' });
  });

  it.each([['REJECT'], ['SUSPEND']])('requires a reason to %s', (decision) => {
    const result = reviewDecisionSchema.safeParse({ decision });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['reason']);
    }
    expect(reviewDecisionSchema.safeParse({ decision, reason: 'four' }).success).toBe(false);
    expect(
      reviewDecisionSchema.safeParse({ decision, reason: 'License could not be verified' }).success,
    ).toBe(true);
  });

  it('rejects an unknown decision', () => {
    expect(reviewDecisionSchema.safeParse({ decision: 'MAYBE' }).success).toBe(false);
  });
});
