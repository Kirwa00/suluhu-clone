import type { Paginated } from '@suluhu/shared';
import { apiFetch } from '@/lib/api-client';
import { tokenStore } from '@/lib/auth/token-store';

export interface AdminMetrics {
  activeTherapists: number;
  patients: number;
  pendingVerifications: number;
  openAlerts: number;
  revenue: {
    grossMtdKsh: number;
    grossAllTimeKsh: number;
    platformNetMtdKsh: number;
    therapistEarningsMtdKsh: number;
    paidSessionsMtd: number;
    commissionRate: number;
  };
}

export interface RevenueRow {
  therapistId: string;
  name: string;
  grossKsh: number;
  netKsh: number;
  sessions: number;
}

export interface PayoutRow extends RevenueRow {
  paidOutKsh: number;
  pendingKsh: number;
}

export interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  phiAccessed: boolean;
  actor: string;
  actorRole: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface TherapistEarnings {
  grossKsh: number;
  netKsh: number;
  paidOutKsh: number;
  pendingKsh: number;
  sessions: number;
  commissionRate: number;
  transactions: {
    id: string;
    amountKsh: number;
    netKsh: number;
    patientName: string;
    paidAt: string | null;
  }[];
  payouts: {
    id: string;
    amountKsh: number;
    status: string;
    reference: string | null;
    createdAt: string;
  }[];
}

export interface PlatformCommissionSettings {
  platformCommissionRate: number;
  updatedAt: string | null;
}

function auth() {
  return tokenStore.access ?? undefined;
}

export const analyticsApi = {
  adminMetrics() {
    return apiFetch<AdminMetrics>('/admin/metrics', { accessToken: auth() });
  },
  revenue() {
    return apiFetch<RevenueRow[]>('/admin/revenue', { accessToken: auth() });
  },
  payouts() {
    return apiFetch<PayoutRow[]>('/admin/payouts', { accessToken: auth() });
  },
  pay(therapistId: string) {
    return apiFetch<{ id: string; amountKsh: number; reference: string | null }>(
      `/admin/payouts/${therapistId}/pay`,
      { method: 'POST', accessToken: auth() },
    );
  },
  auditLog(params: { action?: string; page?: number } = {}) {
    const sp = new URLSearchParams();
    if (params.action) sp.set('action', params.action);
    if (params.page) sp.set('page', String(params.page));
    sp.set('pageSize', '30');
    return apiFetch<Paginated<AuditRow>>(`/admin/audit-log?${sp.toString()}`, {
      accessToken: auth(),
    });
  },
  therapistEarnings() {
    return apiFetch<TherapistEarnings>('/therapist/earnings', { accessToken: auth() });
  },

  getPlatformCommission() {
    return apiFetch<PlatformCommissionSettings>('/admin/settings/commission', {
      accessToken: auth(),
    });
  },
  updatePlatformCommission(platformCommissionRate: number) {
    return apiFetch<PlatformCommissionSettings>('/admin/settings/commission', {
      method: 'PATCH',
      body: { platformCommissionRate },
      accessToken: auth(),
    });
  },
};
