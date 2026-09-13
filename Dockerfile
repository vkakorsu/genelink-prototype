# GENE-LINK MVP prototype. One image, one process. Runs anywhere Docker runs.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/public
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run test:ci && npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S genelink && adduser -S genelink -G genelink
COPY --from=build --chown=genelink:genelink /app/.next/standalone ./
COPY --from=build --chown=genelink:genelink /app/.next/static ./.next/static
COPY --from=build --chown=genelink:genelink /app/public ./public
COPY --from=build --chown=genelink:genelink /app/config ./config
USER genelink
EXPOSE 3000
CMD ["node", "server.js"]
