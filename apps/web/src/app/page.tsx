import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Bird,
  CalendarCheck,
  ClipboardList,
  CloudRain,
  HeartCrack,
  Languages,
  Lock,
  Menu,
  Phone,
  Smartphone,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand-logo';
import { getDictionary } from '@/i18n/dictionaries';
import {
  FREE_SESSION_DURATION_MINS,
  SESSION_RATE_MAX_KSH,
  SESSION_RATE_MIN_KSH,
} from '@suluhu/shared';

const ksh = (n: number) => `KES ${n.toLocaleString('en-KE')}`;

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#help', label: 'What we help with' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
  { href: '#therapists', label: 'For therapists' },
];

const PROMISES = [
  { icon: BadgeCheck, title: 'CPB-verified', body: 'every therapist' },
  { icon: Lock, title: 'Confidential', body: 'encrypted notes' },
  { icon: Languages, title: 'English & Kiswahili', body: 'your choice' },
  { icon: Smartphone, title: 'Any phone', body: 'even on slow data' },
];

const HELP_WITH = [
  { icon: CloudRain, title: 'Anxiety & stress', body: 'Racing thoughts, worry, panic, burnout.' },
  {
    icon: Users,
    title: 'Depression & low mood',
    body: 'Feeling flat, hopeless or tired all the time.',
  },
  {
    icon: HeartCrack,
    title: 'Relationships & family',
    body: 'Conflict, breakups, parenting, marriage.',
  },
  { icon: Bird, title: 'Grief & life changes', body: 'Loss, illness, new jobs, moving on.' },
];

const STEPS = [
  {
    icon: UserPlus,
    title: 'Create your free account',
    body: 'Just your name, email and phone number. It takes about 2 minutes.',
  },
  {
    icon: ClipboardList,
    title: 'Tell us how you feel',
    body: 'A short, private check-in helps us suggest therapists who fit your needs.',
  },
  {
    icon: CalendarCheck,
    title: 'Pick a therapist & time',
    body: 'Compare licensed therapists by focus area, language and price, then choose a time.',
  },
  {
    icon: Video,
    title: 'Meet by secure video',
    body: `Join from your phone or laptop. Your first ${FREE_SESSION_DURATION_MINS} minutes are free.`,
  },
];

const FAQ = [
  {
    q: 'Is it really confidential?',
    a: "Yes. Sessions are private video calls, your notes are encrypted, and we follow Kenya's Data Protection Act. Your therapist won't share what you say without your consent, except where the law requires it to keep someone safe.",
  },
  {
    q: 'Do I need a diagnosis or referral?',
    a: "No. You can book for anything that's weighing on you: stress, sleep, relationships, grief, work, or just needing to talk.",
  },
  {
    q: 'What do I need for a video session?',
    a: 'A phone or laptop with internet. Sessions are built to work on slower mobile connections too.',
  },
  {
    q: 'How do I pay?',
    a: `Your first ${FREE_SESSION_DURATION_MINS} minutes are free. After that you pay per session with M-Pesa; you'll get a prompt on your phone when you book.`,
  },
  {
    q: 'Can I switch therapists?',
    a: 'Anytime. Just book your next session with someone else. No explanation needed.',
  },
  {
    q: 'Is this for emergencies?',
    a: 'No. If you or someone near you is in danger, call Befrienders Kenya on 0800 723 253 or go to the nearest hospital.',
  },
];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-xs font-bold uppercase tracking-widest text-on-secondary-container">
      {children}
    </p>
  );
}

/**
 * Landing page — public entry point that turns visitors into registered
 * patients. Static, calm, and accessible; the crisis line stays on top (SDLC §12.1).
 */
export default function HomePage() {
  const t = getDictionary('en');
  const rateRange = `${ksh(SESSION_RATE_MIN_KSH)}–${SESSION_RATE_MAX_KSH.toLocaleString('en-KE')}`;

  return (
    <div className="min-h-screen bg-surface pb-20 md:pb-0">
      <div className="bg-primary text-on-primary">
        <p className="container flex items-center justify-center gap-2 py-2 text-center text-sm">
          <Phone className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            In crisis right now? Call Befrienders Kenya free:{' '}
            <a href="tel:0800723253" className="font-semibold underline">
              0800 723 253
            </a>
          </span>
        </p>
      </div>

      <header className="sticky top-0 z-30 border-b border-surface-container-high bg-surface/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link href="/" aria-label={t['brand.name']}>
            <BrandLogo wordmark={t['brand.name']} className="hidden sm:inline-flex" />
            <BrandLogo wordmark="Suluhu" className="sm:hidden" />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 text-sm font-medium lg:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="text-on-surface-variant hover:text-primary">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden text-primary sm:inline-flex"
            >
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href="/register">Book free session</Link>
            </Button>
            <details className="relative lg:hidden">
              <summary
                className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded text-primary hover:bg-accent [&::-webkit-details-marker]:hidden"
                aria-label="Menu"
              >
                <Menu className="h-6 w-6" aria-hidden />
              </summary>
              <nav
                aria-label="Mobile"
                className="absolute right-0 top-12 flex w-56 flex-col rounded-lg border border-outline-variant bg-surface-container-lowest p-2 shadow-ambient-lg"
              >
                {NAV.map((n) => (
                  <a
                    key={n.href}
                    href={n.href}
                    className="rounded px-3 py-2 text-on-surface hover:bg-surface-container"
                  >
                    {n.label}
                  </a>
                ))}
                <Link
                  href="/login"
                  className="rounded px-3 py-2 font-semibold text-primary hover:bg-surface-container"
                >
                  Log in
                </Link>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-y-0 right-0 hidden w-1/2 overflow-hidden bg-primary lg:block"
          >
            <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary-container opacity-60" />
            <div className="absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-secondary opacity-25" />
          </div>
          <div className="container relative grid lg:min-h-[600px] lg:grid-cols-2">
            <div className="flex flex-col justify-center py-14 lg:py-20 lg:pr-14">
              <Eyebrow>Online therapy for Kenya</Eyebrow>
              <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-on-surface lg:text-[2.75rem]">
                It&apos;s okay to not be okay.
                <br />
                It&apos;s brave to talk about it.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-on-surface-variant">
                Suluhu connects you with licensed, caring therapists by private video, in a language
                you&apos;re comfortable in, at a time that suits you.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link href="/register">Start with a free session</Link>
                </Button>
                <Button asChild variant="ghost" size="lg" className="px-3 text-primary">
                  <Link href="/login">
                    Log in <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </div>
              <p className="mt-5 text-sm text-on-surface-variant">
                {FREE_SESSION_DURATION_MINS} minutes free · then from {ksh(SESSION_RATE_MIN_KSH)}{' '}
                per session · M-Pesa
              </p>
            </div>
            <div className="-mx-4 flex flex-col justify-center gap-6 bg-primary px-4 py-14 text-on-primary lg:mx-0 lg:bg-transparent lg:py-20 lg:pl-14 lg:pr-0">
              <p className="relative font-display text-2xl font-semibold leading-snug">
                Real help from real professionals, without the waiting room. Every therapist on
                Suluhu is licence-checked before they can see you.
              </p>
              <ul className="relative grid grid-cols-2 gap-3">
                {PROMISES.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="rounded-lg bg-white/10 p-4">
                    <span className="flex items-center gap-2 font-semibold">
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {title}
                    </span>
                    <span className="text-sm text-inverse-primary">{body}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="help" className="scroll-mt-20 bg-surface-container-lowest py-16 lg:py-20">
          <div className="container">
            <Eyebrow>We can help with</Eyebrow>
            <h2 className="font-display text-3xl font-bold text-on-surface lg:text-4xl">
              Whatever you&apos;re carrying, you don&apos;t have to carry it alone
            </h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {HELP_WITH.map(({ icon: Icon, title, body }) => (
                <article
                  key={title}
                  className="rounded-xl border border-surface-container-high bg-surface-container-lowest p-6"
                >
                  <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-md bg-accent text-on-secondary-container">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="mb-1 font-display text-lg font-semibold text-on-surface">
                    {title}
                  </h3>
                  <p className="text-sm text-on-surface-variant">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="container scroll-mt-20 py-16 lg:py-20">
          <div className="text-center">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="font-display text-3xl font-bold text-on-surface lg:text-4xl">
              From sign-up to your first session in minutes
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-lg text-on-surface-variant">
              No referrals, no waiting rooms, no awkward phone calls.
            </p>
          </div>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li
                key={title}
                className="rounded-xl border border-surface-container-high bg-surface-container-lowest p-6"
              >
                <span className="mb-4 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-on-primary">
                    {i + 1}
                  </span>
                  <Icon className="h-5 w-5 text-primary" aria-hidden />
                </span>
                <h3 className="mb-1 font-display text-lg font-semibold text-on-surface">{title}</h3>
                <p className="text-sm text-on-surface-variant">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="pricing" className="scroll-mt-20 bg-surface-container-lowest py-16 lg:py-20">
          <div className="container">
            <div className="text-center">
              <Eyebrow>Pricing</Eyebrow>
              <h2 className="font-display text-3xl font-bold text-on-surface lg:text-4xl">
                Start free. Pay only when you&apos;re ready.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-lg text-on-surface-variant">
                No subscriptions. No hidden fees. Pay per session with M-Pesa.
              </p>
            </div>
            <div className="mx-auto mt-10 grid max-w-4xl gap-6 md:grid-cols-2">
              <div className="relative rounded-xl border-2 border-primary bg-surface-container-lowest p-8">
                <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-1 text-xs font-bold text-on-primary">
                  Start here
                </span>
                <h3 className="font-display text-lg font-semibold">First session</h3>
                <p className="my-2 font-display text-4xl font-extrabold text-on-surface">
                  Free{' '}
                  <span className="text-base font-medium text-on-surface-variant">
                    {FREE_SESSION_DURATION_MINS} minutes
                  </span>
                </p>
                <p className="text-sm text-on-surface-variant">
                  Meet a therapist and see if it feels right. No payment needed.
                </p>
                <Button asChild className="mt-6 w-full">
                  <Link href="/register">Book my free session</Link>
                </Button>
              </div>
              <div className="rounded-xl border border-surface-container-high bg-surface-container-lowest p-8">
                <h3 className="font-display text-lg font-semibold">Ongoing sessions</h3>
                <p className="my-2 font-display text-3xl font-extrabold text-on-surface">
                  {rateRange}{' '}
                  <span className="whitespace-nowrap text-base font-medium text-on-surface-variant">
                    / session
                  </span>
                </p>
                <p className="text-sm text-on-surface-variant">
                  Each therapist sets their own rate, shown upfront before you book. 30, 45, 60 or
                  90 minutes.
                </p>
                <Button asChild variant="secondary" className="mt-6 w-full">
                  <Link href="/register">Create account to see therapists</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="container max-w-3xl scroll-mt-20 py-16 lg:py-20">
          <div className="text-center">
            <Eyebrow>Questions</Eyebrow>
            <h2 className="font-display text-3xl font-bold text-on-surface lg:text-4xl">
              Things people ask before starting
            </h2>
          </div>
          <div className="mt-8 space-y-3">
            {FAQ.map(({ q, a }, i) => (
              <details
                key={q}
                open={i === 0}
                className="group rounded-lg border border-surface-container-high bg-surface-container-lowest px-5 py-4"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-on-surface [&::-webkit-details-marker]:hidden">
                  {q}
                  <span
                    aria-hidden
                    className="text-xl text-primary group-open:rotate-45 transition-transform"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-on-surface-variant">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="therapists" className="container scroll-mt-20 pb-10">
          <div className="flex flex-col items-start justify-between gap-4 rounded-xl bg-surface-soothing p-8 sm:flex-row sm:items-center">
            <div>
              <Eyebrow>For therapists</Eyebrow>
              <h2 className="font-display text-2xl font-bold text-on-surface">
                Are you a CPB-licensed therapist?
              </h2>
              <p className="text-on-surface-variant">
                Reach clients across Kenya, set your own rates and get paid via M-Pesa.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild variant="secondary">
                <Link href="/login-therapist">Therapist log in</Link>
              </Button>
              <Button asChild variant="primary">
                <Link href="/register?role=therapist">
                  Apply to join <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="container pb-20">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-primary p-8 text-on-primary lg:flex-row lg:items-center lg:p-14">
            <div>
              <h2 className="font-display text-3xl font-bold">
                Taking the first step is the hardest part.
              </h2>
              <p className="mt-2 max-w-xl text-lg text-inverse-primary">
                Create a free account in 2 minutes and talk to a licensed therapist this week.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="bg-surface-container-lowest text-primary hover:bg-surface-container"
              >
                <Link href="/register">Create free account</Link>
              </Button>
              <Button
                asChild
                variant="secondary"
                size="lg"
                className="border-on-primary text-on-primary hover:bg-white/10"
              >
                <Link href="/login">I already have an account</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-surface-container-high bg-surface-container-lowest">
        <div className="container grid gap-8 py-12 text-sm text-on-surface-variant sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <BrandLogo wordmark={t['brand.name']} size="sm" />
            <p className="mt-3 max-w-sm">
              Licensed, compassionate mental health care from Eldoret to anywhere in Kenya.
            </p>
          </div>
          <nav aria-label="Get help" className="flex flex-col gap-2">
            <h2 className="font-display font-semibold text-on-surface">Get help</h2>
            <Link href="/register" className="hover:text-primary">
              Book free session
            </Link>
            <Link href="/login" className="hover:text-primary">
              Log in
            </Link>
            <a href="tel:0800723253" className="hover:text-primary">
              Crisis line: 0800 723 253
            </a>
          </nav>
          <nav aria-label="For therapists" className="flex flex-col gap-2">
            <h2 className="font-display font-semibold text-on-surface">For therapists</h2>
            <Link href="/register?role=therapist" className="hover:text-primary">
              Join Suluhu
            </Link>
            <Link href="/login-therapist" className="hover:text-primary">
              Therapist log in
            </Link>
          </nav>
        </div>
        <div className="container flex flex-col justify-between gap-2 border-t border-surface-container py-5 text-sm text-on-surface-variant sm:flex-row">
          <span>
            © {new Date().getFullYear()} {t['brand.name']} · Eldoret, Kenya
          </span>
          <span>Your data is protected under Kenya&apos;s Data Protection Act 2019</span>
        </div>
      </footer>

      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-3 border-t border-surface-container-high bg-surface-container-lowest p-3 md:hidden">
        <Button asChild variant="secondary" className="flex-1">
          <Link href="/login">Log in</Link>
        </Button>
        <Button asChild className="flex-1">
          <Link href="/register">Book free session</Link>
        </Button>
      </div>
    </div>
  );
}
