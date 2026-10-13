# onsite-print-checkin

A mobile-friendly barcode scanner using React, JavaScript, Vite, and ZXing.

## Scanning

Open the app on your phone, tap **Start scanning**, and allow camera access.
The scanner prefers the rear camera and reads QR codes and common one-dimensional
barcodes. After a successful scan, the camera stops and the decoded value appears.
Tap **Scan next** to scan another code, or **Stop scanning** to release the camera.
The camera also stops when the page is hidden.

Codes are displayed as plain text, never automatically opened as links. Camera
images are decoded locally, not uploaded. This page does not perform backend
check-in or attendee validation.

Camera access requires **HTTPS** (or localhost for desktop development).
Opening a plain HTTP LAN address on a phone will not work for camera access.
For phone testing, use an HTTPS deployment or a trusted HTTPS development endpoint.

## Start in the dev container

1. Install Docker and the **Dev Containers** extension (`ms-vscode-remote.remote-containers`) in VS Code.
2. Make sure Docker is running, then open this folder in VS Code.
3. Open the Command Palette (`Ctrl+Shift+P`) and select **Dev Containers: Reopen in Container**.
4. Wait for the container to finish setting up. It includes Node.js 24, npm, Git, and ESLint support; dependencies install automatically.
5. In the VS Code terminal inside the container, run:

	```sh
	npm run dev
	```

6. Open <http://localhost:5173/checkin/> to see the scanner. VS Code forwards this port from the container.

The first container setup requires internet access to download the image and dependencies.

The container builds from `.devcontainer/Dockerfile`, which uses Node.js 24 with npm and installs Git, curl, and CA certificates. App dependencies install separately with `npm ci` after the workspace is mounted.

After changing the Dockerfile or container configuration, run **Dev Containers: Rebuild and Reopen in Container** from the Command Palette.

## Make your first change

Edit `src/App.jsx` to change the scanner. Saving the file updates the browser automatically.
`src/main.jsx` mounts the React app, and `src/index.css` controls its appearance.

## Commands

```sh
npm run dev      # Start the development server
npm run lint     # Check JavaScript and React code
npm run build    # Create a production build in dist/
npm run preview  # Preview the production build
```

## Run without a container

Install Node.js 24 (the version in `.nvmrc`), then run:

```sh
npm ci
npm run dev
```

The development server binds to all interfaces so it is reachable through container port forwarding. Use it only in a trusted development environment.

## Full-stack development and deployment

From the sibling `onsite-print-server` repo:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

Open <http://localhost:8080/checkin/>. Source changes hot-reload through the
gateway. Production builds use the same `/checkin/` base path and support
refreshing nested SPA routes. Missing `/checkin/assets/` files return 404.

Use relative API URLs such as `/api/v2/health`. The gateway forwards them to
FastAPI. When running Vite directly on port 5173, its API proxy defaults to
`http://localhost:8080`; set `API_PROXY_TARGET` if the backend is elsewhere.

The Dockerfile has `development` and `production` targets. The production image
serves only built assets; it does not run Vite. To publish it, set `IMAGE_TAG` in
`.env`, set `CR_PAT` securely in the environment with GHCR `write:packages`
permission, and run `bash docker-push.sh`. `GHCR_USERNAME` defaults to `groskopf`.
The image is `ghcr.io/groskopf/onsite-print-checkin:<IMAGE_TAG>`.

Tags must be `major.minor.patch` without leading zeros. The script publishes
the current version and increments its patch in `.env` only after success.
Failures leave the version unchanged. Commit the updated `.env`; it contains
the next release, not a published tag. Use the printed published tag for
deployment. Do not publish concurrently or from stale checkouts: increments
do not prevent overwrites caused by stale versions or interrupted-push retries.

See the server repo's README for image-only deployment and HTTPS setup. Phone
camera testing requires HTTPS even during development on a LAN.

## Test the publishing script

```sh
bash tests/docker-push-test.sh
```

GitHub Actions runs these tests on pushes and pull requests against this repo's
own script. They use a mocked Docker CLI, do not build or upload images, and
require no credentials or sibling repositories.
