import type { Paginated, ReviewDecisionInput } from '@suluhu/shared';
import { apiFetch } from '@/lib/api-client';
import { tokenStore } from '@/lib/auth/token-store';

export interface ApplicationListItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string | null;
  specialties: string[];
  cpbLicenseNumber: string | null;
  cpbCheck: { valid: boolean; status: string } | null;
  verificationStatus: string;
  submittedAt: string | null;
}

export interface ApplicationDetail extends ApplicationListItem {
  gender: string | null;
  bio: string | null;
  languages: string[];
  yearsExperience: number | null;
  sessionRateKsh: number | null;
  cpbExpiry: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  documents: { id: string; type: string; originalName: string | null; uploadedAt: string }[];
  availability: { dayOfWeek: number; startTime: string; endTime: string }[];
}

function auth() {
  return tokenStore.access ?? undefined;
}

export const adminApi = {
  listApplications(params: { status?: string; page?: number; pageSize?: number } = {}) {
    const sp = new URLSearchParams();
    if (params.status) sp.set('status', params.status);
    if (params.page) sp.set('page', String(params.page));
    if (params.pageSize) sp.set('pageSize', String(params.pageSize));
    const qs = sp.toString();
    return apiFetch<Paginated<ApplicationListItem>>(
      `/admin/therapists/applications${qs ? `?${qs}` : ''}`,
      { accessToken: auth() },
    );
  },
  getApplication(id: string) {
    return apiFetch<ApplicationDetail>(`/admin/therapists/applications/${id}`, {
      accessToken: auth(),
    });
  },
  review(id: string, input: ReviewDecisionInput) {
    return apiFetch<{ id: string; verificationStatus: string }>(
      `/admin/therapists/applications/${id}/review`,
      { method: 'POST', body: input, accessToken: auth() },
    );
  },
  updateSessionRate(id: string, sessionRateKsh: number) {
    return apiFetch<{ id: string; sessionRateKsh: number }>(
      `/admin/therapists/applications/${id}/rate`,
      { method: 'PATCH', body: { sessionRateKsh }, accessToken: auth() },
    );
  },

  listAlerts(params: { status?: string; page?: number; pageSize?: number } = {}) {
    const sp = new URLSearchParams();
    if (params.status) sp.set('status', params.status);
    if (params.page) sp.set('page', String(params.page));
    if (params.pageSize) sp.set('pageSize', String(params.pageSize));
    const qs = sp.toString();
    return apiFetch<Paginated<AlertItem>>(`/admin/clinical-alerts${qs ? `?${qs}` : ''}`, {
      accessToken: auth(),
    });
  },
  acknowledgeAlert(id: string) {
    return apiFetch<{ id: string; status: string }>(`/admin/clinical-alerts/${id}/acknowledge`, {
      method: 'POST',
      accessToken: auth(),
    });
  },
  resolveAlert(id: string, note?: string) {
    return apiFetch<{ id: string; status: string }>(`/admin/clinical-alerts/${id}/resolve`, {
      method: 'POST',
      body: { note },
      accessToken: auth(),
    });
  },
};

export interface AlertItem {
  id: string;
  type: string;
  status: string;
  message: string;
  patientName: string;
  patientPhone: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}
