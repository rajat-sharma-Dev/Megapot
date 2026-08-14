/**
 * The arcade floor.
 *
 * Mega Arcade is the product; a game is a cabinet on its floor. Everything that
 * differs between cabinets lives in this one list, so adding a game is a data
 * change rather than a page rewrite — the landing screen, the game-select floor
 * and the nav all read from here.
 *
 * What every cabinet shares, and what makes this an arcade rather than a
 * collection of games: one wallet, one arcade vault, and one prize. Whatever you
 * play, you are playing for a share of a Megapot lottery ticket at a fraction of
 * what a ticket costs to buy.
 *
 * Unreleased cabinets are marked `soon` and carry no date. They are listed so
 * the floor reads as a floor, not so anyone thinks they can play them — the UI
 * renders them visibly locked and they have no route to enter.
 */

export type GameStatus = 'live' | 'soon';

export type ArcadeGame = {
  id: string;
  name: string;
  /** One line, on the cabinet marquee. */
  tagline: string;
  /** What you actually do, for the card back. */
  description: string;
  status: GameStatus;
  /** Null for anything not playable — there is no route to enter a locked game. */
  href: string | null;
  seats: number;
  durationLabel: string;
  /** A CSS custom property, so cabinets inherit the shared colour language. */
  accent: string;
  glyph: string;
};

export const GAMES: ArcadeGame[] = [
  {
    id: 'rally-vault',
    name: 'Rally Vault',
    tagline: 'Five racers. One real ticket.',
    description:
      'A five-player obstacle race. Collect point cells, manage a boost tank, steal at the ' +
      'checkpoints. The highest score takes the whole pot — and that is not the same racer as ' +
      'the one who crossed the line first.',
    status: 'live',
    href: '/play',
    seats: 5,
    durationLabel: '~70s',
    accent: 'var(--accent)',
    glyph: '▶',
  },
  /**
   * Unannounced cabinets.
   *
   * Deliberately anonymous. Naming a game that does not exist reads as a
   * roadmap promise, and there is nothing to promise yet — so the floor shows
   * a locked machine and its table size, which is the only thing about it that
   * is actually decided.
   *
   * The seat counts vary on purpose: the arcade is not five-handed by rule, it
   * is five-handed because Rally Vault is. The pot maths works at any table
   * size, since a seat always stakes one shard.
   */
  {
    id: 'cabinet-02',
    name: 'Cabinet 02',
    tagline: '',
    description: '',
    status: 'soon',
    href: null,
    seats: 2,
    durationLabel: '',
    accent: 'var(--cyan)',
    glyph: '◆',
  },
  {
    id: 'cabinet-03',
    name: 'Cabinet 03',
    tagline: '',
    description: '',
    status: 'soon',
    href: null,
    seats: 3,
    durationLabel: '',
    accent: 'var(--violet)',
    glyph: '✦',
  },
  {
    id: 'cabinet-04',
    name: 'Cabinet 04',
    tagline: '',
    description: '',
    status: 'soon',
    href: null,
    seats: 4,
    durationLabel: '',
    accent: 'var(--gold)',
    glyph: '⬢',
  },
];

export const liveGames = () => GAMES.filter((g) => g.status === 'live');
export const comingSoon = () => GAMES.filter((g) => g.status === 'soon');
export const getGame = (id: string) => GAMES.find((g) => g.id === id) ?? null;

/** The cabinet a player lands on when they just want to play something. */
export const DEFAULT_GAME = GAMES[0];
