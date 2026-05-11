import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "scontent.cdninstagram.com" },
      { protocol: "https", hostname: "*.fbcdn.net" },
    ],
  },
};

export default config;
