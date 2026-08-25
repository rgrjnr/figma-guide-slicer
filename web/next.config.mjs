/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * `next build` and `next dev` both write to `.next` by default, so running a
   * build to check the tree compiles overwrites the chunks the dev server is
   * serving from — and the running app dies with "Cannot find module
   * './873.js'" on the next navigation. It looks like an application bug and it
   * is not; it is two processes sharing one output directory.
   *
   * `npm run build:check` sets this so a verification build never touches the
   * dev server's output.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // slicer-core lives outside web/ and ships as TypeScript source, so Next has
  // to be told it is allowed to reach up and compile it.
  transpilePackages: [],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
