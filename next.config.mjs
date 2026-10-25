/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.roblox.com",
      },
      {
        protocol: "https",
        hostname: "**.rbxcdn.com",
      },
    ],
  },
};

export default nextConfig;
