import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than a build step, so Next compiles them.
  transpilePackages: ['@merit/shared', '@merit/domain', '@merit/application', '@merit/infrastructure'],
  experimental: {
    serverComponentsExternalPackages: ['@libsql/client'],
    // The driver is left external below, so it has to be a real file in the deployed function's
    // node_modules. pnpm keeps it at the workspace root, which tracing rooted at apps/web never
    // walks into -- hence a build that succeeds and a serverless function that cannot require it.
    outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../..'),
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // `serverComponentsExternalPackages` only catches direct node_modules imports, and the
      // driver arrives through the transpiled @merit/infrastructure package. Left bundled,
      // webpack follows libsql's dynamic native-binding require into its own README.
      config.externals.push('@libsql/client', 'libsql');
    }
    // The repo writes ESM-style `./thing.js` specifiers against TypeScript sources, which is
    // what `verbatimModuleSyntax` wants and what Vitest already resolves. Teach webpack the
    // same mapping so app code and package code import the same way.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
