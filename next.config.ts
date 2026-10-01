import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs"],
  allowedDevOrigins: ["192.168.11.101"],
};

export default nextConfig;
