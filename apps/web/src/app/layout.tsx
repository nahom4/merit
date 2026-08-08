import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Merit',
  description: 'An AI development officer for small nonprofits.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
          <header className="mb-10 border-b border-line pb-4">
            <a href="/" className="text-lg font-semibold tracking-tight">
              Merit
            </a>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
