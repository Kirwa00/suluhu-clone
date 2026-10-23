import {
  PLATFORM_COMMISSION_DEFAULT,
  PaymentStatus,
  TherapistVerificationStatus,
  UserRole,
  UserStatus,
  type Paginated,
} from '@suluhu/shared';
import type { Prisma, PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import type { AuditService } from './audit';
import type { RequestContext } from './types';

const COMMISSION = PLATFORM_COMMISSION_DEFAULT;

function startOfMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Admin/therapist analytics, revenue, payouts, and audit-log viewer — port of apps/api's AnalyticsService. */
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  /** Platform KPIs for the admin dashboard. */
  async adminMetrics() {
    const monthStart = startOfMonth();
    const [activeTherapists, patients, pendingVerifications, openAlerts, mtd, allTime] =
      await Promise.all([
        this.prisma.therapistProfile.count({
          where: {
            verificationStatus: TherapistVerificationStatus.APPROVED,
            user: { is: { status: UserStatus.ACTIVE } },
          },
        }),
        this.prisma.user.count({ where: { role: UserRole.PATIENT, deletedAt: null } }),
        this.prisma.therapistProfile.count({
          where: { verificationStatus: TherapistVerificationStatus.IN_REVIEW },
        }),
        this.prisma.clinicalAlert.count({ where: { status: 'OPEN' } }),
        this.prisma.payment.aggregate({
          _sum: { amountKsh: true },
          _count: true,
          where: { status: PaymentStatus.SUCCEEDED, paidAt: { gte: monthStart } },
        }),
        this.prisma.payment.aggregate({
          _sum: { amountKsh: true },
          where: { status: PaymentStatus.SUCCEEDED },
        }),
      ]);

    const grossMtd = mtd._sum.amountKsh ?? 0;
    const grossAllTime = allTime._sum.amountKsh ?? 0;
    return {
      activeTherapists,
      patients,
      pendingVerifications,
      openAlerts,
      revenue: {
        grossMtdKsh: grossMtd,
        grossAllTimeKsh: grossAllTime,
        platformNetMtdKsh: Math.round(grossMtd * COMMISSION),
        therapistEarningsMtdKsh: grossMtd - Math.round(grossMtd * COMMISSION),
        paidSessionsMtd: mtd._count,
        commissionRate: COMMISSION,
      },
    };
  }

  /** Per-therapist revenue breakdown for the admin revenue view. */
  async revenueByTherapist() {
    const therapists = await this.prisma.therapistProfile.findMany({
      where: { verificationStatus: TherapistVerificationStatus.APPROVED },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    const rows = [];
    for (const t of therapists) {
      const earned = await this.grossForTherapist(t.userId);
      rows.push({
        therapistId: t.userId,
        name: `${t.user.firstName} ${t.user.lastName}`.trim(),
        grossKsh: earned.gross,
        netKsh: earned.net,
        sessions: earned.sessions,
      });
    }
    return rows.sort((a, b) => b.grossKsh - a.grossKsh);
  }

  /** Earnings summary for a single therapist (their own view). */
  async therapistEarnings(therapistUserId: string) {
    const { gross, net, sessions } = await this.grossForTherapist(therapistUserId);
    const paidAgg = await this.prisma.payout.aggregate({
      _sum: { amountKsh: true },
      where: { therapistId: therapistUserId, status: 'PAID' },
    });
    const paidOut = paidAgg._sum.amountKsh ?? 0;
    const pending = Math.max(0, net - paidOut);

    const [recent, payouts] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.SUCCEEDED, appointment: { therapistId: therapistUserId } },
        orderBy: { paidAt: 'desc' },
        take: 10,
        include: {
          appointment: { include: { patient: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.payout.findMany({
        where: { therapistId: therapistUserId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      grossKsh: gross,
      netKsh: net,
      paidOutKsh: paidOut,
      pendingKsh: pending,
      sessions,
      commissionRate: COMMISSION,
      transactions: recent.map((p) => ({
        id: p.id,
        amountKsh: p.amountKsh,
        netKsh: Math.round(p.amountKsh * (1 - COMMISSION)),
        patientName: `${p.appointment.patient.firstName} ${p.appointment.patient.lastName}`.trim(),
        paidAt: p.paidAt?.toISOString() ?? null,
      })),
      payouts: payouts.map((p) => ({
        id: p.id,
        amountKsh: p.amountKsh,
        status: p.status,
        reference: p.reference,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  /** Admin payout queue: therapists with pending balances. */
  async payoutQueue() {
    const rows = await this.revenueByTherapist();
    const result = [];
    for (const r of rows) {
      const paidAgg = await this.prisma.payout.aggregate({
        _sum: { amountKsh: true },
        where: { therapistId: r.therapistId, status: 'PAID' },
      });
      const paidOut = paidAgg._sum.amountKsh ?? 0;
      const pending = Math.max(0, r.netKsh - paidOut);
      result.push({ ...r, paidOutKsh: paidOut, pendingKsh: pending });
    }
    return result;
  }

  /** Mock M-Pesa B2C payout of a therapist's pending balance. */
  async payTherapist(adminId: string, therapistUserId: string, ctx: RequestContext) {
    const { net, sessions } = await this.grossForTherapist(therapistUserId);
    const paidAgg = await this.prisma.payout.aggregate({
      _sum: { amountKsh: true },
      where: { therapistId: therapistUserId, status: 'PAID' },
    });
    const pending = net - (paidAgg._sum.amountKsh ?? 0);
    if (pending <= 0) throw AppException.conflict('No pending balance to pay out');

    const payout = await this.prisma.payout.create({
      data: {
        therapistId: therapistUserId,
        amountKsh: pending,
        sessionsCount: sessions,
        status: 'PAID',
        method: 'MPESA_B2C',
        reference: `B2C-${Date.now().toString().slice(-10)}`,
        periodEnd: new Date(),
        createdById: adminId,
      },
    });
    await this.audit.record({
      userId: adminId,
      action: 'payout.pay',
      resourceType: 'payout',
      resourceId: payout.id,
      ...ctx,
      metadata: { therapistUserId, amountKsh: pending },
    });
    return { id: payout.id, amountKsh: pending, reference: payout.reference };
  }

  /** Immutable audit-log viewer (admin). */
  async auditLog(params: {
    action?: string;
    page: number;
    pageSize: number;
  }): Promise<Paginated<unknown>> {
    const where: Prisma.AuditLogWhereInput = params.action
      ? { action: { contains: params.action, mode: 'insensitive' } }
      : {};
    const skip = (params.page - 1) * params.pageSize;
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.pageSize,
        include: { user: { select: { email: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      phiAccessed: r.phiAccessed,
      actor: r.user?.email ?? 'system',
      actorRole: r.user?.role ?? null,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
    }));
    const totalPages = Math.max(1, Math.ceil(totalItems / params.pageSize));
    return {
      items,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        totalItems,
        totalPages,
        hasNextPage: params.page < totalPages,
        hasPreviousPage: params.page > 1,
      },
    };
  }

  private async grossForTherapist(therapistUserId: string) {
    const agg = await this.prisma.payment.aggregate({
      _sum: { amountKsh: true },
      _count: true,
      where: { status: PaymentStatus.SUCCEEDED, appointment: { therapistId: therapistUserId } },
    });
    const gross = agg._sum.amountKsh ?? 0;
    return { gross, net: Math.round(gross * (1 - COMMISSION)), sessions: agg._count };
  }
}
