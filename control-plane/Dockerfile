# =============================================================================
#  Multi-stage Dockerfile for the Fault Injection Control Plane
#
#  Stage 1: builder
#    Install production dependencies and prune devDependencies.
#  Stage 2: runtime
#    Minimal node:18-alpine image with only what is needed at run time.
# =============================================================================

# ---------------------------------------------------------------------------
#  Builder stage
# ---------------------------------------------------------------------------
FROM node:18-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Prune dev dependencies so we can copy only production modules to the final
# image.  This is safer than `npm ci --omit=dev` because the lock file
# guarantees reproducible installs across stages.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
#  Runtime stage
# ---------------------------------------------------------------------------
FROM node:18-alpine

# Do not run as root
RUN addgroup -S nodeuser && \
    adduser -S nodeuser -G nodeuser

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /build/node_modules ./node_modules

# Copy application source
COPY package.json ./
COPY src/ ./src/
COPY views/ ./views/
COPY public/ ./public/

# Ensure everything is owned by the non-root user
RUN chown -R nodeuser:nodeuser /app

USER nodeuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

CMD ["node", "src/server.js"]
