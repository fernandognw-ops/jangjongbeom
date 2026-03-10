/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel 배포 최적화: src 디렉터리 구조 명시적 지원
  reactStrictMode: true,
  // 정적 페이지 생성 시 trailing slash 없이 일관된 URL
  trailingSlash: false,
};

export default nextConfig;
