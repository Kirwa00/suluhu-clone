'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PageHeading } from '@/components/app/stat-card';
import { ApiClientError } from '@/lib/api-client';
import { adminApi } from '@/lib/api/admin-api';
import { formatDate } from '@/lib/format';
import { useT } from '@/i18n/locale-context';

const CALLBACK_URL_HINT = 'https://api.suluhutherapy.com/api/v1/payments/payhero/callback';

export default function AdminPaymentsSettings() {
  const t = useT();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['payment-settings'],
    queryFn: () => adminApi.getPaymentSettings(),
  });

  const [mpesaMode, setMpesaMode] = useState<'mock' | 'live'>('mock');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [channelId, setChannelId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setMpesaMode(settings.mpesaMode);
    setUsername(settings.payheroApiUsername ?? '');
    setChannelId(settings.payheroChannelId != null ? String(settings.payheroChannelId) : '');
    setBaseUrl(settings.payheroBaseUrl ?? '');
    setCallbackUrl(settings.mpesaCallbackUrl ?? '');
  }, [settings]);

  const mutation = useMutation({
    mutationFn: () => {
      const trimmedChannelId = channelId.trim();
      const parsedChannelId = trimmedChannelId ? Number(trimmedChannelId) : undefined;
      return adminApi.updatePaymentSettings({
        mpesaMode,
        payheroApiUsername: username.trim() || undefined,
        payheroApiPassword: password.trim() || undefined,
        // Number("not-a-number") is NaN, which JSON.stringify turns into
        // null — the schema's .optional() only skips undefined, so a null
        // channel id trips validation ("must be positive") instead of being
        // treated as "not provided". Guard it here so a bad entry is simply
        // omitted (and reported by the same missing-field check as blank).
        payheroChannelId: Number.isFinite(parsedChannelId) ? parsedChannelId : undefined,
        payheroBaseUrl: baseUrl.trim() || undefined,
        mpesaCallbackUrl: callbackUrl.trim() || undefined,
      });
    },
    onSuccess: (updated) => {
      setSaved(true);
      setError(null);
      setPassword('');
      queryClient.setQueryData(['payment-settings'], updated);
    },
    onError: (err) => {
      setSaved(false);
      if (!(err instanceof ApiClientError)) {
        setError(t('adminPayments.saveFailed'));
        return;
      }
      // VALIDATION_FAILED's own message is always the generic "Validation
      // failed" — the actual per-field reason lives in `details`, which was
      // previously dropped on the floor here, leaving no way to tell what
      // was wrong with the input.
      if (err.details) {
        const fieldMessages = Object.entries(err.details)
          .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
          .join(' · ');
        setError(fieldMessages || err.message);
      } else {
        setError(err.message);
      }
    },
  });

  const save = () => {
    setError(null);
    setSaved(false);
    mutation.mutate();
  };

  return (
    <div className="max-w-2xl">
      <PageHeading title={t('adminPayments.title')} subtitle={t('adminPayments.subtitle')} />

      {isLoading ? (
        <p className="text-on-surface-variant">{t('common.loading')}</p>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('adminPayments.mode.title')}</CardTitle>
              <CardDescription>
                {mpesaMode === 'live'
                  ? t('adminPayments.mode.liveHint')
                  : t('adminPayments.mode.mockHint')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Field label={t('adminPayments.mode.label')} htmlFor="mpesaMode">
                <Select
                  id="mpesaMode"
                  value={mpesaMode}
                  onChange={(e) => {
                    setMpesaMode(e.target.value as 'mock' | 'live');
                    setSaved(false);
                  }}
                >
                  <option value="mock">{t('adminPayments.mode.mock')}</option>
                  <option value="live">{t('adminPayments.mode.live')}</option>
                </Select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('adminPayments.payhero.title')}</CardTitle>
              <CardDescription>{t('adminPayments.payhero.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <Alert variant="error">{error}</Alert>}
              {saved && !error && <Alert variant="success">{t('adminPayments.saved')}</Alert>}

              <Field label={t('adminPayments.payhero.username')} htmlFor="payheroApiUsername">
                <Input
                  id="payheroApiUsername"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setSaved(false);
                  }}
                  autoComplete="off"
                />
              </Field>

              <Field
                label={t('adminPayments.payhero.password')}
                htmlFor="payheroApiPassword"
                hint={
                  settings?.hasPayheroApiPassword
                    ? t('adminPayments.payhero.passwordSetHint')
                    : t('adminPayments.payhero.passwordUnsetHint')
                }
              >
                <Input
                  id="payheroApiPassword"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setSaved(false);
                  }}
                  autoComplete="new-password"
                  placeholder={
                    settings?.hasPayheroApiPassword
                      ? t('adminPayments.payhero.passwordPlaceholderSet')
                      : t('adminPayments.payhero.passwordPlaceholderUnset')
                  }
                />
              </Field>

              <Field label={t('adminPayments.payhero.channelId')} htmlFor="payheroChannelId">
                <Input
                  id="payheroChannelId"
                  type="number"
                  inputMode="numeric"
                  value={channelId}
                  onChange={(e) => {
                    setChannelId(e.target.value);
                    setSaved(false);
                  }}
                />
              </Field>

              <Field
                label={t('adminPayments.payhero.baseUrl')}
                htmlFor="payheroBaseUrl"
                hint={t('adminPayments.payhero.baseUrlHint')}
              >
                <Input
                  id="payheroBaseUrl"
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="https://backend.payhero.co.ke"
                />
              </Field>

              <Field
                label={t('adminPayments.payhero.callbackUrl')}
                htmlFor="mpesaCallbackUrl"
                hint={t('adminPayments.payhero.callbackUrlHint', { url: CALLBACK_URL_HINT })}
              >
                <Input
                  id="mpesaCallbackUrl"
                  value={callbackUrl}
                  onChange={(e) => {
                    setCallbackUrl(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={CALLBACK_URL_HINT}
                />
              </Field>

              <Button onClick={save} disabled={mutation.isPending} className="w-full">
                {mutation.isPending ? t('adminPayments.saving') : t('adminPayments.save')}
              </Button>

              {settings?.updatedAt && (
                <p className="text-xs text-on-surface-variant">
                  {t('adminPayments.lastUpdated', { date: formatDate(settings.updatedAt) })}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
