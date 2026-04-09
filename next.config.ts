/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // Optional but recommended for smaller builds
  images: {
    unoptimized: true, // Use if you're having issues with image optimization
  },
}

module.exports = nextConfig