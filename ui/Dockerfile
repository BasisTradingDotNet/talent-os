# Build context is the repo root (see docker-compose.yml): the UI type-imports the frozen
# contract from api/src/contracts and the mock seeds from kit/fixtures, so both must be present
# for `tsc -b` and `vite build`. Only the files the build needs are copied, so a host
# node_modules/ can never leak into the image.
FROM node:22-alpine AS build
WORKDIR /app
COPY api/src/contracts ./api/src/contracts
COPY kit/fixtures ./kit/fixtures
COPY ui/package.json ui/package-lock.json ./ui/
WORKDIR /app/ui
RUN npm ci --no-audit --no-fund
COPY ui/index.html ui/vite.config.ts ui/tsconfig.json ./
COPY ui/src ./src
RUN npm run build

# ---
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/ui/dist /usr/share/nginx/html
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
