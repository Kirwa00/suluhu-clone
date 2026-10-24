'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  loginSchema,
  otpCodeSchema,
  UserRole,
  type AuthTokens,
  type AuthUser,
  type LoginInput,
} from '@suluhu/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi, ApiClientError } from '@/lib/auth/auth-api';
import { dashboardPathForRole, useAuth } from '@/lib/auth/auth-context';
import { pendingGoogleSignup } from '@/lib/auth/google-signup';

const mfaFormSchema = z.object({ code: otpCodeSchema });
type MfaForm = z.infer<typeof mfaFormSchema>;

const ADMIN_ROLES: readonly UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

/** Shared sign-in form; `adminOnly` backs the /login-admin page. */
export function LoginForm({ adminOnly = false }: { adminOnly?: boolean }) {
  const router = useRouter();
  const { setSession, logout } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  const loginForm = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const mfaForm = useForm<MfaForm>({ resolver: zodResolver(mfaFormSchema) });

  const completeSignIn = async (user: AuthUser, tokens: AuthTokens) => {
    if (adminOnly && !ADMIN_ROLES.includes(user.role)) {
      setSession(user, tokens);
      await logout();
      setMfaToken(null);
      setFormError('This sign-in is for administrators only. Use the main sign-in page.');
      return;
    }
    setSession(user, tokens);
    router.replace(dashboardPathForRole(user.role));
  };

  const onLogin = loginForm.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await authApi.login(values);
      if (result.status === 'MFA_REQUIRED') {
        setMfaToken(result.mfaToken);
        return;
      }
      if (result.status !== 'AUTHENTICATED') return;
      await completeSignIn(result.user, result.tokens);
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'Unable to sign in. Try again.');
    }
  });

  const onGoogleCredential = async (credential: string) => {
    setFormError(null);
    try {
      const result = await authApi.google(credential);
      if (result.status === 'MFA_REQUIRED') {
        setMfaToken(result.mfaToken);
        return;
      }
      if (result.status === 'SIGNUP_REQUIRED') {
        pendingGoogleSignup.save({ credential, profile: result.profile });
        router.push('/register?google=1');
        return;
      }
      await completeSignIn(result.user, result.tokens);
    } catch (err) {
      setFormError(
        err instanceof ApiClientError ? err.message : 'Google sign-in failed. Try again.',
      );
    }
  };

  const onVerifyMfa = mfaForm.handleSubmit(async ({ code }) => {
    if (!mfaToken) return;
    setFormError(null);
    try {
      const result = await authApi.verifyMfa(mfaToken, code);
      await completeSignIn(result.user, result.tokens);
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'Invalid code. Try again.');
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">
          {mfaToken ? 'Verify it’s you' : adminOnly ? 'Admin sign in' : 'Welcome back'}
        </CardTitle>
        <CardDescription>
          {mfaToken
            ? 'Enter the 6-digit code we sent to your email.'
            : adminOnly
              ? 'For Suluhu administrators only.'
              : 'Sign in to continue your care journey.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        {!mfaToken ? (
          <>
            <form onSubmit={onLogin} className="space-y-4" noValidate>
              <Field
                label="Email"
                htmlFor="email"
                error={loginForm.formState.errors.email?.message}
              >
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={!!loginForm.formState.errors.email}
                  {...loginForm.register('email')}
                />
              </Field>
              <Field
                label="Password"
                htmlFor="password"
                error={loginForm.formState.errors.password?.message}
              >
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={!!loginForm.formState.errors.password}
                  {...loginForm.register('password')}
                />
              </Field>
              <div className="flex justify-end">
                <Link href="/forgot-password" className="text-sm text-secondary hover:underline">
                  Forgot password?
                </Link>
              </div>
              <Button type="submit" className="w-full" disabled={loginForm.formState.isSubmitting}>
                {loginForm.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
            {!adminOnly && <GoogleSignInButton onCredential={onGoogleCredential} />}
          </>
        ) : (
          <form onSubmit={onVerifyMfa} className="space-y-4" noValidate>
            <Field
              label="Verification code"
              htmlFor="code"
              error={mfaForm.formState.errors.code?.message}
            >
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                aria-invalid={!!mfaForm.formState.errors.code}
                {...mfaForm.register('code')}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={mfaForm.formState.isSubmitting}>
              {mfaForm.formState.isSubmitting ? 'Verifying…' : 'Verify & continue'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setMfaToken(null);
                setFormError(null);
              }}
            >
              Back to sign in
            </Button>
          </form>
        )}

        {!mfaToken && !adminOnly && (
          <p className="text-center text-sm text-on-surface-variant">
            New to Suluhu?{' '}
            <Link href="/register" className="font-medium text-secondary hover:underline">
              Create an account
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
