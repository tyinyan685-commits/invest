import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync } from 'fs'
import { resolve, basename } from 'path'
import { pathToFileURL } from 'url'

// Vite plugin: serve /api/* routes using local serverless function files
function localApiPlugin() {
  return {
    name: 'local-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next()

        // Parse the API route: /api/profile?symbol=MU → profile.js
        const [pathname, queryString] = req.url.split('?')
        const apiName = pathname.replace('/api/', '').replace(/\/$/, '')
        const apiFile = resolve(process.cwd(), 'api', `${apiName}.js`)

        try {
          // Dynamic import the handler (invalidate cache for dev)
          const fileUrl = pathToFileURL(apiFile).href + '?t=' + Date.now()
          const mod = await import(fileUrl)
          const handler = mod.default

          if (!handler) {
            res.statusCode = 404
            res.end(JSON.stringify({ ok: false, error: `No handler in ${apiName}.js` }))
            return
          }

          // Build mock req object (Vercel serverless compatible)
          const params = new URLSearchParams(queryString || '')
          const query = Object.fromEntries(params)
          const mockReq = {
            method: req.method,
            url: req.url,
            query,
            headers: req.headers,
            body: null,
          }

          // Build mock res object
          let statusCode = 200
          const headers = {}
          const mockRes = {
            status(code) { statusCode = code; return mockRes },
            setHeader(k, v) { headers[k] = v; return mockRes },
            json(data) {
              res.statusCode = statusCode
              res.setHeader('Content-Type', 'application/json')
              for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
              res.end(JSON.stringify(data))
            },
            send(data) {
              res.statusCode = statusCode
              for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
              res.end(data)
            },
          }

          await handler(mockReq, mockRes)
        } catch (e) {
          console.error(`[API] ${req.url} error:`, e.message)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [localApiPlugin(), react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
