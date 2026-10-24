'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeading } from '@/components/app/stat-card';
import { clinicalApi } from '@/lib/api/clinical-api';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDateTimeEAT, humanizeEnum } from '@/lib/format';
import { useT } from '@/i18n/locale-context';

export default function PatientRecordPage() {
  const t = useT();
  const { user } = useAuth();
  const patientId = user?.id;

  const { data: record } = useQuery({
    queryKey: ['record', patientId],
    queryFn: () => clinicalApi.healthRecord(patientId as string),
    enabled: Boolean(patientId),
  });

  if (!record) return <p className="text-on-surface-variant">{t('patientRecord.loading')}</p>;

  return (
    <div className="max-w-3xl">
      <PageHeading title={t('patientRecord.title')} subtitle={t('patientRecord.subtitle')} />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('patientRecord.checkin.title')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {record.latestIntake ? (
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  ['PHQ-9', record.latestIntake.phq9Score, 27],
                  ['GAD-7', record.latestIntake.gad7Score, 21],
                  ['CAGE', record.latestIntake.cageScore, 4],
                ].map(([l, s, m]) => (
                  <div key={l as string} className="rounded-md bg-surface-soothing p-3">
                    <p className="font-display text-xl font-bold text-on-surface">
                      {s as number}
                      <span className="text-sm font-normal text-on-surface-variant">
                        /{m as number}
                      </span>
                    </p>
                    <p className="text-xs text-on-surface-variant">{l as string}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-on-surface-variant">{t('patientRecord.checkin.empty')}</p>
            )}
          </CardContent>
        </Card>

        {record.treatmentPlan && (
          <Card>
            <CardHeader>
              <CardTitle>{t('patientRecord.plan.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium text-on-surface">{t('patientRecord.plan.goals')}</p>
              <ul className="list-inside list-disc text-on-surface-variant">
                {record.treatmentPlan.goals.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t('patientRecord.sessions.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {record.appointments.length === 0 ? (
              <p className="text-sm text-on-surface-variant">{t('patientRecord.sessions.empty')}</p>
            ) : (
              <ul className="divide-y divide-outline-variant text-sm">
                {record.appointments.map((a) => (
                  <li key={a.id} className="flex justify-between py-2">
                    <span className="text-on-surface">{formatDateTimeEAT(a.scheduledAt)}</span>
                    <span className="text-on-surface-variant">
                      {a.therapistName} · {humanizeEnum(a.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
