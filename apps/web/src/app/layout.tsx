import type { Metadata } from 'next';
import { Manrope, Fraunces } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';
import { currentUser } from '../lib/session.js';

const bodyFont = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
});

const displayFont = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: {
    default: 'Merit',
    template: '%s · Merit',
  },
  description: 'An AI development officer for small nonprofits.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>
        <div className="relative isolate">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[30rem] bg-[radial-gradient(circle_at_top,rgba(15,118,110,0.24),transparent_55%)]"
          />
          <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-6 sm:px-6 lg:px-8">
            <Link href="/" className="group inline-flex items-baseline gap-3">
              <span className="text-xl font-semibold tracking-tight text-ink">Merit</span>
              <span className="soft-label group-hover:border-accent group-hover:text-accent">
                nonprofit development ops
              </span>
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              <Link
                href="/"
                className="rounded-full px-4 py-2 text-muted transition hover:bg-white/70 hover:text-ink"
              >
                Home
              </Link>
              {user?.organizationId != null && (
                <Link
                  href={`/organizations/${user.organizationId}`}
                  className="rounded-full px-4 py-2 text-muted transition hover:bg-white/70 hover:text-ink"
                >
                  My organisation
                </Link>
              )}
              {user === null ? (
                <a
                  href="/api/auth/google/start"
                  className="rounded-full bg-ink px-4 py-2 font-medium text-white shadow-sm transition hover:bg-accentStrong"
                >
                  Sign in with Google
                </a>
              ) : (
                <>
                  <span className="hidden text-muted sm:inline">{user.email}</span>
                  <a
                    href="/api/auth/logout"
                    className="rounded-full border border-line px-4 py-2 text-muted transition hover:text-ink"
                  >
                    Sign out
                  </a>
                </>
              )}
            </nav>
          </header>
          <main className="mx-auto max-w-7xl px-4 pb-16 pt-2 sm:px-6 lg:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
