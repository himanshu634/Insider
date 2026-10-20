# syntax=docker/dockerfile:1
# Dev image for the API, the job worker and the web app (compose.yaml). Dependencies are
# installed for Linux inside the image; compose bind-mounts the source folders on top, so edits
# on the Mac reload without a rebuild. Rebuild after a dependency change: bin/insider dev does.
FROM node:22-bookworm-slim

RUN npm install -g pnpm@11.2.2
WORKDIR /app

# Every workspace manifest, so the frozen lockfile matches. Only the API, the web app and their
# workspace dependencies are installed: the collector (Electron) runs on the Mac.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/collector/package.json apps/collector/
COPY apps/web/package.json apps/web/
COPY services/api/package.json services/api/
COPY packages/contracts/package.json packages/contracts/
COPY tools/analyst/package.json tools/analyst/
COPY tools/export-importer/package.json tools/export-importer/
COPY tools/spike/package.json tools/spike/
RUN --mount=type=cache,id=insider-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@insider/api..." --filter "@insider/web..."

COPY packages/contracts packages/contracts
COPY services/api services/api
COPY apps/web apps/web
