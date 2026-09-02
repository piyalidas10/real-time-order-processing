# frontend/Dockerfile
# Multi-stage build for Angular 21 → Nginx
#
# WHY MULTI-STAGE BUILDS?
# ─────────────────────────
# Stage 1 (builder): Contains Node.js, npm, all node_modules, TypeScript
#   compiler, Angular CLI.  This is ~500-800 MB.
# Stage 2 (runtime): Contains only Nginx + the compiled static HTML/JS/CSS.
#   This is ~25 MB — dramatically smaller, faster to push/pull, smaller
#   attack surface (no Node.js, no npm, no source code in production).
#
# The dist/ output from stage 1 is COPY --from=builder into stage 2.

# ── Stage 1: Angular build ────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first for Docker layer caching.
# If package.json hasn't changed, npm ci reuses the cached layer.
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY . .
RUN npm run build -- --configuration production


# ── Stage 2: Nginx runtime ────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove default Nginx config and add ours
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy Angular production build output
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
