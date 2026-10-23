import {
  TherapistVerificationStatus,
  UserStatus,
  type Paginated,
  type TherapistSearchQuery,
} from '@suluhu/shared';
import type { Prisma, PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';

export interface TherapistCard {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  gender: string | null;
  specialties: string[];
  languages: string[];
  yearsExperience: number | null;
  sessionRateKsh: number | null;
  ratingAvg: number;
  ratingCount: number;
  bioSnippet: string | null;
  profilePhotoUrl: string | null;
}

export interface TherapistDetail extends TherapistCard {
  bio: string | null;
  sessionsCompleted: number;
  availability: { dayOfWeek: number; startTime: string; endTime: string }[];
}

/** Public therapist discovery (search + detail) — port of apps/api's DiscoveryService. */
export class DiscoveryService {
  constructor(private readonly prisma: PrismaClient) {}

  async search(query: TherapistSearchQuery): Promise<Paginated<TherapistCard>> {
    const where: Prisma.TherapistProfileWhereInput = {
      deletedAt: null,
      verificationStatus: TherapistVerificationStatus.APPROVED,
      user: { is: { status: UserStatus.ACTIVE, deletedAt: null } },
    };

    if (query.specialty) where.specialties = { has: query.specialty };
    if (query.language) where.languages = { has: query.language };
    if (query.gender) where.gender = query.gender;
    if (query.minPrice != null || query.maxPrice != null) {
      where.sessionRateKsh = {
        ...(query.minPrice != null ? { gte: query.minPrice } : {}),
        ...(query.maxPrice != null ? { lte: query.maxPrice } : {}),
      };
    }
    if (query.q) {
      const q = query.q;
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { bio: { contains: q, mode: 'insensitive' } },
        { user: { is: { firstName: { contains: q, mode: 'insensitive' } } } },
        { user: { is: { lastName: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const orderBy = this.orderBy(query.sort);
    const skip = (query.page - 1) * query.pageSize;

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.therapistProfile.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.therapistProfile.count({ where }),
    ]);

    const items = rows.map((r) => this.toCard(r));
    const totalPages = Math.max(1, Math.ceil(totalItems / query.pageSize));
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  }

  async getPublicProfile(id: string): Promise<TherapistDetail> {
    const row = await this.prisma.therapistProfile.findFirst({
      where: {
        id,
        deletedAt: null,
        verificationStatus: TherapistVerificationStatus.APPROVED,
        user: { is: { status: UserStatus.ACTIVE } },
      },
      include: {
        user: { select: { firstName: true, lastName: true } },
        availability: {
          where: { isAvailable: true },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        },
      },
    });
    if (!row) throw AppException.notFound('Therapist not found');

    return {
      ...this.toCard(row),
      bio: row.bio,
      sessionsCompleted: row.sessionsCompleted,
      availability: row.availability.map((a) => ({
        dayOfWeek: a.dayOfWeek,
        startTime: a.startTime,
        endTime: a.endTime,
      })),
    };
  }

  private orderBy(
    sort: TherapistSearchQuery['sort'],
  ): Prisma.TherapistProfileOrderByWithRelationInput {
    switch (sort) {
      case 'price_asc':
        return { sessionRateKsh: 'asc' };
      case 'price_desc':
        return { sessionRateKsh: 'desc' };
      case 'experience':
        return { yearsExperience: 'desc' };
      default:
        return { ratingAvg: 'desc' };
    }
  }

  private toCard(row: {
    id: string;
    title: string | null;
    gender: string | null;
    specialties: string[];
    languages: string[];
    yearsExperience: number | null;
    sessionRateKsh: number | null;
    ratingAvg: number;
    ratingCount: number;
    bio: string | null;
    profilePhotoUrl: string | null;
    user: { firstName: string; lastName: string };
  }): TherapistCard {
    return {
      id: row.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      title: row.title,
      gender: row.gender,
      specialties: row.specialties,
      languages: row.languages,
      yearsExperience: row.yearsExperience,
      sessionRateKsh: row.sessionRateKsh,
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
      bioSnippet: row.bio ? row.bio.slice(0, 160) : null,
      profilePhotoUrl: row.profilePhotoUrl,
    };
  }
}
