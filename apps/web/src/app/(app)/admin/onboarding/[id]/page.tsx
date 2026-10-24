'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReviewDecisionInput } from '@suluhu/shared';
import { SESSION_RATE_MAX_KSH, SESSION_RATE_MIN_KSH } from '@suluhu/shared';
import { ArrowLeft, Download, FileText } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiClientError } from '@/lib/api-client';
import { adminApi } from '@/lib/api/admin-api';
import { therapistsApi } from '@/lib/api/therapists-api';
import { saveBlob } from '@/lib/download-blob';
import { dayName, formatDate, formatKsh, humanizeEnum } from '@/lib/format';
import { useT } from '@/i18n/locale-context';

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-outline-variant py-2 text-sm last:border-0">
      <span className="text-on-surface-variant">{label}</span>
      <span className="font-medium text-on-surface">{value}</span>
    </div>
  );
}

export default function AdminApplicationReview() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState('');
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateSaved, setRateSaved] = useState(false);

  const { data: app, isLoading } = useQuery({
    queryKey: ['application', id],
    queryFn: () => adminApi.getApplication(id),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (app) setRateInput(app.sessionRateKsh != null ? String(app.sessionRateKsh) : '');
  }, [app]);

  const mutation = useMutation({
    mutationFn: (input: ReviewDecisionInput) => adminApi.review(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['application', id] });
      router.push('/admin/onboarding');
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : t('adminReview.actionFailed')),
  });

  const rateMutation = useMutation({
    mutationFn: (sessionRateKsh: number) => adminApi.updateSessionRate(id, sessionRateKsh),
    onSuccess: () => {
      setRateSaved(true);
      queryClient.invalidateQueries({ queryKey: ['application', id] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
    onError: (err) =>
      setRateError(err instanceof ApiClientError ? err.message : t('adminReview.actionFailed')),
  });

  const saveRate = () => {
    setRateError(null);
    setRateSaved(false);
    const parsed = Number(rateInput);
    if (
      !Number.isInteger(parsed) ||
      parsed < SESSION_RATE_MIN_KSH ||
      parsed > SESSION_RATE_MAX_KSH
    ) {
      setRateError(
        t('adminReview.detail.sessionRateBounds', {
          min: SESSION_RATE_MIN_KSH,
          max: SESSION_RATE_MAX_KSH,
        }),
      );
      return;
    }
    rateMutation.mutate(parsed);
  };

  const decide = (decision: ReviewDecisionInput['decision']) => {
    setError(null);
    if (decision !== 'APPROVE' && reason.trim().length < 5) {
      setError(t('adminReview.reasonRequired'));
      return;
    }
    mutation.mutate({ decision, reason: reason.trim() || undefined });
  };

  const download = useMutation({
    mutationFn: (documentId: string) => therapistsApi.downloadDocument(documentId),
    onSuccess: ({ blob, filename }) => saveBlob(blob, filename ?? 'document'),
  });

  if (isLoading) return <p className="text-on-surface-variant">{t('common.loading')}</p>;
  if (!app)
    return (
      <Card className="p-10 text-center text-on-surface-variant">{t('adminReview.notFound')}</Card>
    );

  const cpb = app.cpbCheck;

  return (
    <div className="max-w-4xl">
      <Link
        href="/admin/onboarding"
        className="inline-flex items-center gap-1.5 text-sm text-secondary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t('adminReview.backToQueue')}
      </Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{app.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <Detail label={t('adminReview.detail.title')} value={app.title ?? '—'} />
              <Detail label={t('adminReview.detail.email')} value={app.email} />
              <Detail label={t('adminReview.detail.phone')} value={app.phone} />
              <Detail
                label={t('adminReview.detail.gender')}
                value={app.gender ? humanizeEnum(app.gender) : '—'}
              />
              <Detail
                label={t('adminReview.detail.experience')}
                value={
                  app.yearsExperience != null
                    ? t('adminReview.detail.experienceYears', { years: app.yearsExperience })
                    : '—'
                }
              />
              <Detail
                label={t('adminReview.detail.languages')}
                value={app.languages.join(', ') || '—'}
              />
              <Detail
                label={t('adminReview.detail.specialties')}
                value={app.specialties.map(humanizeEnum).join(', ') || '—'}
              />
              <Detail
                label={t('adminReview.detail.submitted')}
                value={formatDate(app.submittedAt)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('adminReview.detail.sessionRate')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-on-surface-variant">
                {t('adminReview.rate.current', { rate: formatKsh(app.sessionRateKsh) })}
              </p>
              {rateError && <Alert variant="error">{rateError}</Alert>}
              {rateSaved && !rateError && (
                <Alert variant="success">{t('adminReview.rate.saved')}</Alert>
              )}
              <div className="flex items-end gap-3">
                <Field
                  label={t('adminReview.rate.inputLabel')}
                  htmlFor="sessionRateKsh"
                  className="flex-1"
                >
                  <Input
                    id="sessionRateKsh"
                    type="number"
                    inputMode="numeric"
                    min={SESSION_RATE_MIN_KSH}
                    max={SESSION_RATE_MAX_KSH}
                    value={rateInput}
                    onChange={(e) => {
                      setRateInput(e.target.value);
                      setRateSaved(false);
                    }}
                  />
                </Field>
                <Button onClick={saveRate} disabled={rateMutation.isPending}>
                  {rateMutation.isPending
                    ? t('adminReview.rate.saving')
                    : t('adminReview.rate.save')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {app.bio && (
            <Card>
              <CardHeader>
                <CardTitle>{t('adminReview.about.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-on-surface-variant">{app.bio}</p>
              </CardContent>
            </Card>
          )}

          {app.availability.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('adminReview.availability.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {app.availability.map((a, i) => (
                    <li key={i} className="flex justify-between">
                      <span className="text-on-surface">{dayName(a.dayOfWeek)}</span>
                      <span className="text-on-surface-variant">
                        {a.startTime}–{a.endTime}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('adminReview.cpb.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Detail label={t('adminReview.cpb.license')} value={app.cpbLicenseNumber ?? '—'} />
              <Detail label={t('adminReview.cpb.expiry')} value={formatDate(app.cpbExpiry)} />
              {cpb ? (
                <Alert variant={cpb.valid ? 'success' : 'error'}>
                  {t('adminReview.cpb.automatedCheck', {
                    result: cpb.valid ? t('adminReview.cpb.valid') : t('adminReview.cpb.notValid'),
                    status: cpb.status,
                  })}
                </Alert>
              ) : (
                <Alert variant="info">{t('adminReview.cpb.none')}</Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('adminReview.documents.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {app.documents.length === 0 ? (
                <p className="text-sm text-on-surface-variant">
                  {t('adminReview.documents.empty')}
                </p>
              ) : (
                <ul className="divide-y divide-outline-variant">
                  {app.documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-on-surface-variant" aria-hidden />
                        <span>
                          <span className="block font-medium text-on-surface">
                            {humanizeEnum(d.type)}
                          </span>
                          <span className="text-xs text-on-surface-variant">
                            {d.originalName} · {formatDate(d.uploadedAt)}
                          </span>
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => download.mutate(d.id)}
                        disabled={download.isPending}
                      >
                        <Download className="h-4 w-4" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('adminReview.decision.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {error && <Alert variant="error">{error}</Alert>}
              <Textarea
                placeholder={t('adminReview.decision.reasonPlaceholder')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
              <Button
                className="w-full"
                onClick={() => decide('APPROVE')}
                disabled={mutation.isPending}
              >
                {t('adminReview.decision.approve')}
              </Button>
              <Button
                className="w-full"
                variant="secondary"
                onClick={() => decide('REJECT')}
                disabled={mutation.isPending}
              >
                {t('adminReview.decision.reject')}
              </Button>
              <Button
                className="w-full"
                variant="destructive"
                onClick={() => decide('SUSPEND')}
                disabled={mutation.isPending}
              >
                {t('adminReview.decision.suspend')}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
