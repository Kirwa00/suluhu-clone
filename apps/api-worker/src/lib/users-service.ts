import type { UserRole } from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import type { PhiCryptoService } from './phi-crypto';

export interface UserProfileView {
  id: string;
  email: string;
  phone: string;
  role: UserRole;
  status: string;
  firstName: string;
  lastName: string;
  locale: string;
  mfaEnabled: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  patient?: { county: string | null; gender: string | null; freeSessionsUsed: number };
  therapist?: {
    cpbLicenseNumber: string | null;
    verificationStatus: string;
    specialties: string[];
    languages: string[];
    sessionRateKsh: number | null;
    bio: string | null;
  };
}

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  locale?: 'en' | 'sw';
  county?: string;
  gender?: 'FEMALE' | 'MALE' | 'NON_BINARY' | 'PREFER_NOT_TO_SAY';
  dateOfBirth?: string;
  bio?: string;
}

/** Port of apps/api/src/modules/users/users.service.ts. */
export class UsersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly phi: PhiCryptoService,
  ) {}

  async getProfile(userId: string): Promise<UserProfileView> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { patientProfile: true, therapistProfile: true },
    });
    if (!user) throw AppException.notFound('Account not found');

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role as UserRole,
      status: user.status,
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      mfaEnabled: user.mfaEnabled,
      emailVerified: Boolean(user.emailVerifiedAt),
      phoneVerified: Boolean(user.phoneVerifiedAt),
      patient: user.patientProfile
        ? {
            county: user.patientProfile.county,
            gender: user.patientProfile.gender,
            freeSessionsUsed: user.patientProfile.freeSessionsUsed,
          }
        : undefined,
      therapist: user.therapistProfile
        ? {
            cpbLicenseNumber: user.therapistProfile.cpbLicenseNumber,
            verificationStatus: user.therapistProfile.verificationStatus,
            specialties: user.therapistProfile.specialties,
            languages: user.therapistProfile.languages,
            sessionRateKsh: user.therapistProfile.sessionRateKsh,
            bio: user.therapistProfile.bio,
          }
        : undefined,
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserProfileView> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { patientProfile: true, therapistProfile: true },
    });
    if (!user) throw AppException.notFound('Account not found');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: input.firstName ?? undefined,
        lastName: input.lastName ?? undefined,
        locale: input.locale ?? undefined,
      },
    });

    if (user.patientProfile) {
      await this.prisma.patientProfile.update({
        where: { userId },
        data: {
          county: input.county ?? undefined,
          gender: input.gender ?? undefined,
          // Date of birth is PHI — encrypt before persisting.
          dateOfBirthEnc: input.dateOfBirth ? await this.phi.encrypt(input.dateOfBirth) : undefined,
        },
      });
    }

    if (user.therapistProfile && input.bio !== undefined) {
      await this.prisma.therapistProfile.update({
        where: { userId },
        data: { bio: input.bio },
      });
    }

    return this.getProfile(userId);
  }
}
