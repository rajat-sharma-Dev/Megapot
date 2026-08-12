import type { Metadata, Viewport } from 'next';
import { Chakra_Petch, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

/**
 * Three typefaces, each with one job.
 *
 * Chakra Petch is the display face — squared-off, technical, and the single
 * biggest reason the product reads as a game rather than an admin panel. Inter
 * carries body copy because it stays legible at 13px on a dark background. And
 * every number in this app is money, points or a countdown, so they all go
 * through a monospace with real tabular figures: a jackpot that jitters as its
 * digits change looks broken.
 */
const display = Chakra_Petch({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});

const body = Inter({
  variable: '--font-body',
  subsets: ['latin'],
});

const mono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'Rally Vault — five racers, one real jackpot ticket',
  description:
    'Five racers stake a fifth of a Megapot ticket each. Highest score takes the whole pot — and the pot buys a real lottery ticket minted straight to your wallet on Base.',
};

export const viewport: Viewport = {
  themeColor: '#04060c',
  // The race is a full-bleed canvas you steer by dragging; letting the browser
  // zoom on a double tap makes it unplayable on a phone.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} antialiased bg-grid bg-scan`}
      >
        <div className="bg-field" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
