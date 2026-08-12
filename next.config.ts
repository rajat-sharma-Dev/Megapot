import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Build output directory.
   *
   * Overridable so the end-to-end suite can build into its own directory. It runs
   * `next build`, and sharing `.next` with a running `npm run dev` clobbers the
   * dev server's chunks underneath it — every page then 500s with
   * "Cannot find module './xyz.js'" until someone restarts it. Isolating the test
   * build removes the conflict instead of documenting it.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
