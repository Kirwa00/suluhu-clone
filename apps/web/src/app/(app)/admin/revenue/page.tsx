'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLATFORM_COMMISSION_MAX, PLATFORM_COMMISSION_MIN } from '@suluhu/shared';
import { CreditCard, Percent, Users, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeading, StatCard } from '@/components/app/stat-card';
import { ApiClientError } from '@/lib/api-client';
import { analyticsApi } from '@/lib/api/analytics-api';
import { formatKsh } from '@/lib/format';
import { useT } from '@/i18n/locale-context';

export default function AdminRevenuePage() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: metrics } = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: () => analyticsApi.adminMetrics(),
  });
  const { data: rows } = useQuery({
    queryKey: ['admin-revenue'],
    queryFn: () => analyticsApi.revenue(),
  });
  const { data: commission } = useQuery({
    queryKey: ['platform-commission'],
    queryFn: () => analyticsApi.getPlatformCommission(),
  });

  const [commissionPercent, setCommissionPercent] = useState('');
  const [commissionError, setCommissionError] = useState<string | null>(null);
  const [commissionSaved, setCommissionSaved] = useState(false);

  useEffect(() => {
    if (commission)
      setCommissionPercent(String(Math.round(commission.platformCommissionRate * 100)));
  }, [commission]);

  const commissionMutation = useMutation({
    mutationFn: () => {
      const percent = Number(commissionPercent.trim());
      return analyticsApi.updatePlatformCommission(percent / 100);
    },
    onSuccess: (updated) => {
      setCommissionSaved(true);
      setCommissionError(null);
      queryClient.setQueryData(['platform-commission'], updated);
      queryClient.invalidateQueries({ queryKey: ['admin-metrics'] });
    },
    onError: (err) => {
      setCommissionSaved(false);
      if (!(err instanceof ApiClientError)) {
        setCommissionError(t('revenue.commission.saveFailed'));
        return;
      }
      if (err.details) {
        setCommissionError(
          Object.entries(err.details)
            .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
            .join(' · ') || err.message,
        );
      } else {
        setCommissionError(err.message);
      }
    },
  });

  const saveCommission = () => {
    setCommissionError(null);
    setCommissionSaved(false);
    const percent = Number(commissionPercent.trim());
    if (!Number.isFinite(percent)) {
      setCommissionError(t('revenue.commission.invalid'));
      return;
    }
    commissionMutation.mutate();
  };

  return (
    <div>
      <PageHeading title={t('revenue.title')} subtitle={t('revenue.subtitle')} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('revenue.commission.title')}</CardTitle>
          <CardDescription>
            {t('revenue.commission.subtitle', {
              min: PLATFORM_COMMISSION_MIN * 100,
              max: PLATFORM_COMMISSION_MAX * 100,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {commissionError && <Alert variant="error">{commissionError}</Alert>}
          {commissionSaved && !commissionError && (
            <Alert variant="success">{t('revenue.commission.saved')}</Alert>
          )}
          <div className="flex items-end gap-3">
            <Field
              label={t('revenue.commission.inputLabel')}
              htmlFor="platformCommissionRate"
              className="max-w-xs"
            >
              <Input
                id="platformCommissionRate"
                type="number"
                inputMode="numeric"
                min={PLATFORM_COMMISSION_MIN * 100}
                max={PLATFORM_COMMISSION_MAX * 100}
                value={commissionPercent}
                onChange={(e) => {
                  setCommissionPercent(e.target.value);
                  setCommissionSaved(false);
                }}
              />
            </Field>
            <Button onClick={saveCommission} disabled={commissionMutation.isPending}>
              {commissionMutation.isPending
                ? t('revenue.commission.saving')
                : t('revenue.commission.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('revenue.stat.grossMtd')}
          value={formatKsh(metrics?.revenue.grossMtdKsh ?? 0)}
          icon={CreditCard}
          tone="positive"
        />
        <StatCard
          label={t('revenue.stat.platformNetMtd')}
          value={formatKsh(metrics?.revenue.platformNetMtdKsh ?? 0)}
          icon={Wallet}
        />
        <StatCard
          label={t('revenue.stat.therapistEarningsMtd')}
          value={formatKsh(metrics?.revenue.therapistEarningsMtdKsh ?? 0)}
          icon={Users}
        />
        <StatCard
          label={t('revenue.stat.commission')}
          value={metrics ? `${Math.round(metrics.revenue.commissionRate * 100)}%` : '—'}
          hint={t('revenue.stat.paidSessionsMtd', { count: metrics?.revenue.paidSessionsMtd ?? 0 })}
          icon={Percent}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('revenue.byTherapist.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!rows || rows.length === 0 ? (
            <p className="text-sm text-on-surface-variant">{t('revenue.byTherapist.empty')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant text-left text-on-surface-variant">
                  <th className="py-2 font-medium">{t('revenue.table.therapist')}</th>
                  <th className="py-2 text-right font-medium">{t('revenue.table.sessions')}</th>
                  <th className="py-2 text-right font-medium">{t('revenue.table.gross')}</th>
                  <th className="py-2 text-right font-medium">{t('revenue.table.therapistNet')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.therapistId} className="border-b border-outline-variant last:border-0">
                    <td className="py-2 text-on-surface">{r.name}</td>
                    <td className="py-2 text-right text-on-surface-variant">{r.sessions}</td>
                    <td className="py-2 text-right text-on-surface">{formatKsh(r.grossKsh)}</td>
                    <td className="py-2 text-right text-on-surface-variant">
                      {formatKsh(r.netKsh)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
