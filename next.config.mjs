/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse/pdfjs-dist load a worker file at runtime; bundling breaks that lookup.
  serverExternalPackages: ["pdfmake", "pdfkit", "pdf-parse", "pdfjs-dist", "ssh2", "ssh2-sftp-client"],
  experimental: {
    // Must accommodate up to MAX_FILE_SIZE (100 MB) files encoded as base64
    // which adds ~33% overhead. 200 MB allows the largest file plus JSON
    // wrapper and metadata fields.
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
