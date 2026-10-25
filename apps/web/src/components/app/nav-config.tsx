import {
  BadgeCheck,
  CalendarDays,
  ClipboardList,
  Compass,
  CreditCard,
  FileText,
  HeartPulse,
  LayoutDashboard,
  LibraryBig,
  MessageSquare,
  Plug,
  Settings,
  ShieldCheck,
  Siren,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@suluhu/shared';
import type { MessageKey } from '@/i18n/dictionaries';

export interface NavItem {
  labelKey: MessageKey;
  href: string;
  icon: LucideIcon;
  /** Built in a later milestone; rendered as a disabled "Soon" item. */
  soon?: boolean;
}

const patientNav: NavItem[] = [
  { labelKey: 'nav.dashboard', href: '/patient', icon: LayoutDashboard },
  { labelKey: 'nav.findTherapist', href: '/patient/therapists', icon: Compass },
  { labelKey: 'nav.sessions', href: '/patient/sessions', icon: CalendarDays },
  { labelKey: 'nav.record', href: '/patient/record', icon: FileText },
  { labelKey: 'nav.messages', href: '/patient/messages', icon: MessageSquare },
  { labelKey: 'nav.mood', href: '/patient/mood', icon: HeartPulse },
  { labelKey: 'nav.resources', href: '/patient/resources', icon: LibraryBig },
  { labelKey: 'nav.settings', href: '/settings', icon: Settings },
];

const therapistNav: NavItem[] = [
  { labelKey: 'nav.dashboard', href: '/therapist', icon: LayoutDashboard },
  { labelKey: 'nav.onboarding', href: '/therapist/onboarding', icon: BadgeCheck },
  { labelKey: 'nav.schedule', href: '/therapist/schedule', icon: CalendarDays },
  { labelKey: 'nav.clients', href: '/therapist/clients', icon: Users },
  { labelKey: 'nav.messages', href: '/therapist/messages', icon: MessageSquare },
  { labelKey: 'nav.earnings', href: '/therapist/earnings', icon: Wallet },
  { labelKey: 'nav.settings', href: '/settings', icon: Settings },
];

const adminNav: NavItem[] = [
  { labelKey: 'nav.dashboard', href: '/admin', icon: LayoutDashboard },
  { labelKey: 'nav.onboarding', href: '/admin/onboarding', icon: ClipboardList },
  { labelKey: 'nav.alerts', href: '/admin/alerts', icon: Siren },
  { labelKey: 'nav.content', href: '/admin/content', icon: LibraryBig },
  { labelKey: 'nav.revenue', href: '/admin/revenue', icon: CreditCard },
  { labelKey: 'nav.payouts', href: '/admin/payouts', icon: Wallet },
  { labelKey: 'nav.payments', href: '/admin/payments', icon: Plug },
  { labelKey: 'nav.audit', href: '/admin/audit', icon: ShieldCheck },
  { labelKey: 'nav.settings', href: '/settings', icon: Settings },
];

export function navForRole(role: UserRole): NavItem[] {
  switch (role) {
    case 'THERAPIST':
      return therapistNav;
    case 'ADMIN':
    case 'SUPER_ADMIN':
      return adminNav;
    default:
      return patientNav;
  }
}
