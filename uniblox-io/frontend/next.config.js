/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ["fakestoreapi.com"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "spyne-media.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "spyne-desktop-app.s3.amazonaws.com",
      },
    ],
  },
};

module.exports = nextConfig;
