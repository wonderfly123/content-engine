import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // ffprobe-installer ships a `require(path)` for its platform binary that
  // Webpack must not try to bundle. `sharp` is a native libvips binding and
  // must stay external on the server runtime.
  serverExternalPackages: ["@ffprobe-installer/ffprobe", "sharp"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "scontent.cdninstagram.com" },
      { protocol: "https", hostname: "*.fbcdn.net" },
    ],
  },
};

export default config;
