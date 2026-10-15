# syntax=docker/dockerfile:1
# UI Extension Builder + HubSpot connector in one small image (no node_modules at runtime).
#
#   docker build -t uiex-builder .
#   docker run -p 3000:3000 \
#     -e APP_URL=https://builder.example.com \
#     -e HUBSPOT_CLIENT_ID=... -e HUBSPOT_CLIENT_SECRET=... -e SESSION_SECRET=... \
#     uiex-builder
#
# Guide: docs/HOSTING.md → "Docker".

# ---- build -----------------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
# Type-checks, builds the app into dist/ and bundles the server into dist-server/.
RUN npm run build

# ---- run -------------------------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
# Files stay owned by root (read-only for the app user).
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{headers:{'X-UIEX-Request':'1'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist-server/node.mjs"]
