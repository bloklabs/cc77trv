import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves a project repo under /<repo>/. CI supplies the current
// repository name so the same commit works before and after the repo rename.
const requestedBase = process.env.PUBLIC_BASE || '/os3-concierge/'
const base = requestedBase.endsWith('/') ? requestedBase : `${requestedBase}/`

export default defineConfig(({ command }) => {
  const xray = process.env.VITE_XRAY === '1'
  if (command === 'build' && xray) {
    throw new Error('X-ray mode is a Tailnet-only workbench and cannot be built for production')
  }
  return {
    base,
    build: {
      target: 'es2020',
      sourcemap: false,
    },
    test: {
      environment: 'node',
      include: ['test/**/*.test.js'],
    },
    plugins: [
      {
        name: 'os3-release-stamp',
        generateBundle() {
          const sha = process.env.VITE_BUILD_SHA || 'dev'
          if (sha !== 'dev' && !/^[a-f0-9]{40}$/.test(sha)) throw new Error('VITE_BUILD_SHA must be a full commit SHA')
          this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ app: 'os3-concierge', sha }) + '\n' })
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
        manifest: {
          name: 'OS3 Concierge',
          short_name: 'OS3 Concierge',
          description: 'Private family research for travel, dining, culture, and daily life.',
          theme_color: '#f5efe6',
          background_color: '#f5efe6',
          display: 'standalone',
          orientation: 'portrait',
          start_url: base,
          scope: base,
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.origin.includes('basemaps.cartocdn.com'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'map-tiles',
                expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 14 },
              },
            },
          ],
        },
      }),
    ],
  }
})
