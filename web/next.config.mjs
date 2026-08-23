/** @type {import('next').NextConfig} */
const nextConfig = {
  // slicer-core lives outside web/ and ships as TypeScript source, so Next has
  // to be told it is allowed to reach up and compile it.
  transpilePackages: [],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
