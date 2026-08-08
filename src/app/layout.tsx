import type { Metadata } from 'next';
import { Sora, Inter } from 'next/font/google';
import './globals.css';

const display = Sora({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
});

const body = Inter({
  variable: '--font-body',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Rally Vault — race for a real jackpot ticket',
  description:
    'A 5-player obstacle race where the Shards you collect become the numbers on a real Megapot lottery ticket, minted to your wallet on Base.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} antialiased bg-grid`}>
        <div className="bg-field" />
        {children}
      </body>
    </html>
  );
}
