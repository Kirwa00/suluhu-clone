'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { otpCodeSchema, VerificationPurpose } from '@suluhu/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi, ApiClientError } from '@/lib/auth/auth-api';
import { dashboardPathForRole, useAuth } from '@/lib/auth/auth-context';

const schema = z.object({ code: otpCodeSchema });
type FormValues = z.infer<typeof schema>;

export default function VerifyEmailPage() {
  const router = useRouter();
  const { user, status, refreshUser } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  const onSubmit = form.handleSubmit(async ({ code }) => {
    setFormError(null);
    try {
      await authApi.verifyOtp(VerificationPurpose.EMAIL_VERIFICATION, code);
      await refreshUser();
      router.replace(user ? dashboardPathForRole(user.role) : '/patient');
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'Invalid code. Try again.');
    }
  });

  const resend = async () => {
    setFormError(null);
    try {
      await authApi.requestOtp(VerificationPurpose.EMAIL_VERIFICATION);
      setResent(true);
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'Could not resend the code.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Verify your email</CardTitle>
        <CardDescription>
          We sent a 6-digit code to your email. Enter it below to activate your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}
        {resent && <Alert variant="success">A new code is on its way.</Alert>}
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field
            label="Verification code"
            htmlFor="code"
            error={form.formState.errors.code?.message}
          >
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              {...form.register('code')}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Verifying…' : 'Verify'}
          </Button>
        </form>
        <Button type="button" variant="ghost" className="w-full" onClick={resend}>
          Resend code
        </Button>
      </CardContent>
    </Card>
  );
}
