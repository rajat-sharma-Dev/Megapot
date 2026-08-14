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
  title: 'Mega Arcade — play for a real jackpot ticket',
  description:
    'Multiplayer arcade games where five players stake a fifth of a Megapot lottery ticket each and one takes the whole pot. Win enough and a real ticket mints straight to your wallet on Base.',
};

export const viewport: Viewport = {
  themeColor: '#04060c',
  // `width` and `initialScale` are stated explicitly because exporting a custom
  // viewport replaces the framework default rather than extending it — omitting
  // them drops `width=device-width` and every phone renders the app at 980px.
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom is deliberately NOT disabled. It was, to stop a double tap zooming
  // mid-race, but that locks zoom out of the entire app for everyone who needs it
  // to read anything. The race canvas scopes its own touch handling instead
  // (`.no-touch-scroll`), which solves the actual problem without the collateral.
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
