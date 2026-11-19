import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // ffprobe-installer ships a `require(path)` for its platform binary that
  // Webpack must not try to bundle. `sharp` is a native libvips binding and
  // must stay external on the server runtime.
  // Chats used to live at /conversations; old links (texts, bookmarks) keep working.
  async redirects() {
    return [
      { source: "/conversations", destination: "/chats", permanent: true },
      { source: "/conversations/:id", destination: "/chats/:id", permanent: true },
    ];
  },
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
