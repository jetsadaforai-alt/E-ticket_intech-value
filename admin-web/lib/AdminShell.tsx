'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Store,
  CalendarDays,
  Users,
  LifeBuoy,
  PackageOpen,
  ShieldCheck,
  LogOut,
  Ticket,
  Menu,
  X,
  Settings,
} from 'lucide-react';
import { useAuth } from './AuthContext';
import { cn } from './cn';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, superAdminOnly: true },
  { href: '/vendors', label: 'ร้านค้ารออนุมัติ', icon: Store },
  { href: '/events', label: 'จัดการ Event', icon: CalendarDays },
  { href: '/users', label: 'จัดการผู้ใช้', icon: Users },
  { href: '/support', label: 'Support Ticket', icon: LifeBuoy },
  { href: '/packages', label: 'แพ็กเกจ & ราคา', icon: PackageOpen, superAdminOnly: true },
  { href: '/admins', label: 'จัดการบัญชี Admin', icon: ShieldCheck, superAdminOnly: true },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { isLoading, admin, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !admin) router.replace('/login');
  }, [isLoading, admin, router]);

  // Close the drawer automatically on navigation instead of leaving it open behind
  // the new page.
  useEffect(() => setMobileNavOpen(false), [pathname]);

  if (isLoading || !admin) {
    return (
      <div className="flex-1 min-h-screen flex items-center justify-center bg-background text-text-muted font-medium">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          กำลังโหลด...
        </div>
      </div>
    );
  }

  const navItems = NAV.filter((item) => !item.superAdminOnly || admin.role === 'super_admin');

  const sidebarContent = (
    <>
      <div className="p-5 border-b border-border flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-white shadow-xs">
          <Ticket className="w-5 h-5" />
        </div>
        <div>
          <div className="font-bold text-foreground leading-tight">E-ticket </div>
          <div className="text-xs font-medium text-text-muted">Admin Console</div>
        </div>
        <button
          onClick={() => setMobileNavOpen(false)}
          className="ml-auto p-1.5 text-text-muted hover:text-foreground md:hidden"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all',
                active ? 'bg-primary-soft text-primary shadow-xs' : 'text-text-muted hover:text-foreground hover:bg-neutral-bubble'
              )}
            >
              <Icon className={cn('w-4 h-4', active ? 'text-primary' : 'text-text-muted')} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3.5 border-t border-border bg-neutral-bubble m-2 rounded-2xl">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary-pill text-primary-dark flex items-center justify-center font-bold text-xs uppercase shadow-xs">
              {admin.username.slice(0, 2)}
            </div>
            <div className="overflow-hidden">
              <div className="text-xs font-semibold text-foreground truncate">{admin.username}</div>
              <span
                className={cn(
                  'inline-block text-[10px] font-semibold px-1.5 py-0.2 rounded-full',
                  admin.role === 'super_admin' ? 'bg-primary-pill text-primary-dark' : 'bg-info-bg text-info'
                )}
              >
                {admin.role === 'super_admin' ? 'SuperAdmin' : 'Admin'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/profile"
              title="แก้ไขโปรไฟล์"
              className="p-1.5 text-text-muted hover:text-foreground hover:bg-border/40 rounded-lg transition-colors"
            >
              <Settings className="w-4 h-4" />
            </Link>
            <button
              onClick={logout}
              title="ออกจากระบบ"
              className="p-1.5 text-danger hover:bg-danger-bg rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex flex-1 min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-surface border-r border-border flex-col shadow-xs select-none">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface flex flex-col shadow-xl select-none">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 border-b border-border bg-surface p-4">
          <button onClick={() => setMobileNavOpen(true)} className="p-1.5 text-text-muted hover:text-foreground">
            <Menu className="w-5 h-5" />
          </button>
          <div className="font-bold text-foreground">E-ticket</div>
        </div>

        <main className="flex-1 p-4 md:p-8 overflow-y-auto max-w-7xl w-full">{children}</main>
      </div>
    </div>
  );
}
