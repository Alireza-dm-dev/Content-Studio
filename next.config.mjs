/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdfmake", "pdfkit"],
  experimental: {
    // Must accommodate up to MAX_FILE_SIZE (100 MB) files encoded as base64
    // which adds ~33% overhead. 200 MB allows the largest file plus JSON
    // wrapper and metadata fields.
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
