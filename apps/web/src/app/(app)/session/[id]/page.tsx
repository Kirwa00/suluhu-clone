'use client';

import type { DailyCall } from '@daily-co/daily-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2, PhoneOff, Video as VideoIcon } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { sessionsApi, type SessionAccess } from '@/lib/api/sessions-api';
import { formatDateTimeEAT } from '@/lib/format';
import { useT } from '@/i18n/locale-context';

export default function ConsultRoomPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['session', id],
    queryFn: () => sessionsApi.access(id),
    enabled: Boolean(id),
    refetchInterval: (q) => {
      const phase = q.state.data?.phase;
      if (phase === 'WAITING') return 4000;
      if (phase === 'EARLY') return 15000;
      return false;
    },
  });

  const start = useMutation({
    mutationFn: () => sessionsApi.start(id),
    onSuccess: (d) => queryClient.setQueryData(['session', id], d),
  });
  const end = useMutation({
    mutationFn: () => sessionsApi.end(id),
    onSuccess: (d) => {
      queryClient.setQueryData(['session', id], d);
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
      </div>
    );
  }

  if (data.phase === 'IN_SESSION' || (data.phase === 'READY' && data.isOwner && start.isSuccess)) {
    return (
      <ConsultRoom
        data={data}
        onLeave={() => router.push(data.isOwner ? '/therapist/schedule' : '/patient/sessions')}
        onEnd={data.isOwner ? () => end.mutate() : undefined}
        ending={end.isPending}
      />
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <StatusBody data={data} onStart={() => start.mutate()} starting={start.isPending} />
          <Link
            href={data.isOwner ? '/therapist/schedule' : '/patient/sessions'}
            className="text-sm text-secondary hover:underline"
          >
            {t('session.backToSessions')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBody({
  data,
  onStart,
  starting,
}: {
  data: SessionAccess;
  onStart: () => void;
  starting: boolean;
}) {
  const t = useT();
  switch (data.phase) {
    case 'EARLY':
      return (
        <>
          <Clock className="h-12 w-12 text-primary" aria-hidden />
          <div>
            <p className="font-display text-xl font-semibold text-on-surface">
              {t('session.status.notStarted')}
            </p>
            <p className="text-on-surface-variant">
              {t('session.status.beginsAt', {
                name: data.counterpartName,
                time: formatDateTimeEAT(data.scheduledAt),
              })}
              {typeof data.startsInMinutes === 'number' && data.startsInMinutes > 0
                ? t('session.status.startsIn', { mins: data.startsInMinutes })
                : ''}{' '}
              {t('session.status.joinEarly')}
            </p>
          </div>
        </>
      );
    case 'WAITING':
      return (
        <>
          <Loader2 className="h-12 w-12 animate-spin text-primary" aria-hidden />
          <div>
            <p className="font-display text-xl font-semibold text-on-surface">
              {t('session.status.waitingRoom.title')}
            </p>
            <p className="text-on-surface-variant">
              {t('session.status.waitingRoom.body', { name: data.counterpartName })}
            </p>
          </div>
        </>
      );
    case 'READY':
      return (
        <>
          <VideoIcon className="h-12 w-12 text-secondary" aria-hidden />
          <div>
            <p className="font-display text-xl font-semibold text-on-surface">
              {t('session.status.ready.title')}
            </p>
            <p className="text-on-surface-variant">
              {t('session.status.ready.body', { name: data.counterpartName })}
            </p>
          </div>
          <Button size="lg" onClick={onStart} disabled={starting}>
            {starting ? t('session.status.starting') : t('session.status.startSession')}
          </Button>
        </>
      );
    case 'ENDED':
      return (
        <>
          <PhoneOff className="h-12 w-12 text-on-surface-variant" aria-hidden />
          <p className="font-display text-xl font-semibold text-on-surface">
            {t('session.status.ended')}
          </p>
        </>
      );
    case 'EXPIRED':
      return (
        <p className="font-display text-lg font-semibold text-on-surface">
          {t('session.status.expired')}
        </p>
      );
    case 'CANCELLED':
      return (
        <p className="font-display text-lg font-semibold text-on-surface">
          {t('session.status.cancelled')}
        </p>
      );
    case 'UNPAID':
      return (
        <p className="font-display text-lg font-semibold text-on-surface">
          {t('session.status.unpaid')}
        </p>
      );
    default:
      return null;
  }
}

function ConsultRoom({
  data,
  onLeave,
  onEnd,
  ending,
}: {
  data: SessionAccess;
  onLeave: () => void;
  onEnd?: () => void;
  ending: boolean;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [connecting, setConnecting] = useState(true);
  const [joinError, setJoinError] = useState<string | null>(null);
  const { roomUrl, token } = data;

  useEffect(() => {
    if (!containerRef.current || !roomUrl || !token) return;

    let call: DailyCall | undefined;
    let cancelled = false;

    import('@daily-co/daily-js').then(({ default: DailyIframe }) => {
      if (cancelled || !containerRef.current) return;
      call = DailyIframe.createFrame(containerRef.current, {
        iframeStyle: { width: '100%', height: '100%', border: '0' },
        showLeaveButton: true,
        showFullscreenButton: true,
      });
      call.on('left-meeting', onLeave);
      call.on('error', () => setJoinError(t('session.room.joinError')));
      call
        .join({ url: roomUrl, token })
        .then(() => !cancelled && setConnecting(false))
        .catch(() => !cancelled && setJoinError(t('session.room.joinError')));
    });

    return () => {
      cancelled = true;
      call?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomUrl, token]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display text-lg font-semibold text-on-surface">
          {t('session.room.title', { name: data.counterpartName })}
        </p>
        <span className="flex items-center gap-1.5 rounded-full bg-secondary-container/50 px-3 py-1 text-xs font-medium text-on-secondary-container">
          <span className="h-2 w-2 animate-pulse rounded-full bg-success-calm" />{' '}
          {t('session.room.live')}
        </span>
      </div>

      {joinError && (
        <Alert variant="error" className="mb-3">
          {joinError}
        </Alert>
      )}

      <div
        ref={containerRef}
        className="aspect-video w-full overflow-hidden rounded-xl bg-inverse-surface"
      />
      {connecting && !joinError && (
        <p className="mt-2 text-center text-xs text-on-surface-variant">
          {t('session.room.connecting')}
        </p>
      )}

      {onEnd && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="destructive"
            onClick={onEnd}
            disabled={ending}
            className="h-12 rounded-full px-6"
          >
            <PhoneOff className="h-5 w-5" />
            {ending ? t('session.room.ending') : t('session.room.endSession')}
          </Button>
        </div>
      )}
    </div>
  );
}
