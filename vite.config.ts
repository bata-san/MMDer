import { defineConfig, type Plugin } from 'vite';

const BUILD_VERSION = 'v6.0.0';

function cloudflareShell(): Plugin {
  return {
    name: 'mmd-lab-cloudflare-shell',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let next = html
          .replace(/\s*<link rel="stylesheet" href="\.\/style\.css[^"]*" \/>/, '')
          .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
          .replace(/<script type="module" src="\.\/dist\/app\.js\?v=[^"]+"><\/script>/, '<script type="module" src="/src/client.ts"></script>')
          .replace(/<span id="build-version">[^<]*<\/span>/, `<span id="build-version">${BUILD_VERSION}</span>`);
        if (!next.includes('rel="icon"')) {
          next = next.replace('</head>', '  <link rel="icon" href="./favicon.svg" type="image/svg+xml" />\n</head>');
        }
        return next;
      },
    },
  };
}

export default defineConfig({
  plugins: [cloudflareShell()],
  publicDir: false,
  build: {
    outDir: 'build/client',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  worker: {
    format: 'es',
  },
});
