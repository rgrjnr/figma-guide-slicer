# The web app plus the Braze robot, in one image. The base is Playwright's own
# — it ships Node 22, Chromium and every system library the browser needs, and
# its tag must match the `playwright` version in web/package.json or the npm
# package will refuse the pre-installed browsers and download its own at run
# time (into a layer that does not persist).
FROM mcr.microsoft.com/playwright:v1.62.1-noble

# The build context is the repo root, not web/: the app imports @slicer/core
# from ../packages/slicer-core as TypeScript source (externalDir in
# next.config.mjs), so the Docker build has to see both directories.
WORKDIR /app
COPY packages ./packages
COPY web ./web

WORKDIR /app/web
# `npm ci` includes devDependencies on purpose — playwright itself is a dev
# dependency but the /api/braze/run route needs it at run time, and the
# postinstall step copies tesseract's worker/wasm/traineddata into public/.
RUN npm ci
RUN npm run build

# No display on the server; without this the robot tries to open a headed
# Chromium and dies. Everything else (credentials, TOTP secret, the two
# passwords, SESSION_SECRET) comes from Coolify's environment tab.
ENV BRAZE_HEADLESS=1
ENV NODE_ENV=production

# State that must outlive a deploy — mount as volumes in Coolify:
#   /app/web/data        the JSON ledgers (projects, campaigns, invoices) + assets
#   /app/web/braze/.auth the Playwright storageState (the signed-in Braze session)
#   /app/web/.runs       per-run screenshots and dumps, useful when a flow fails

EXPOSE 3000
CMD ["npm", "run", "start"]
