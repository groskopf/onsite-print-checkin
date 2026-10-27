# onsite-print-checkin

A mobile-friendly check-in station using React, JavaScript, Vite, and jsQR.
Scanning an attendee's pass welcomes them and prints their name tag on the
event's printer.

## Check-in flow

1. Enter the event code. Spaces, dashes, and lowercase letters are accepted.
   A link such as `/checkin/?event=ABCDEFGH234567AB` (shown with a QR code on
   the event app's Check-in page) opens the event directly and skips this step.
2. Choose one of the printers booked for the event. Printers without a booking
   for today are shown but cannot be chosen.
3. The scanning page shows the event and printer at the top. Allow camera
   access and hold an attendee's pass QR code in the frame.

Each scanned pass looks up the attendee and opens a welcome pop-up with their
name and company. **Print** sends a name tag (`layout_2`: name on line 1,
company on line 3) to the chosen printer's active booking; **Cancel** closes
the pop-up without printing. A pass that is unknown, belongs to another event,
or is not a check-in pass shows an error pop-up instead.

Nothing prints without pressing **Print**. A pass held in front of the camera
does not reopen the pop-up; it counts as a new scan after it has been out of
view for 1.5 seconds. Use **Change printer** to switch printer. **Log out**
asks for confirmation, then forgets the event on this device and returns to
the event code screen.

The event and printer are remembered in this browser's local storage, so a
reload returns to the scanner. The printer choice is shared with the admin
check-in page on the same origin.

A pass QR code contains the 64-character attendee code. An attendee pass URL
(`/attendee/{EVENT_CODE}/{attendee_code}`) is also accepted if it belongs to
the selected event. Other codes are rejected and never opened as links.

Camera images are decoded locally with jsQR, not uploaded. The camera prefers
the rear camera and stops when the page is hidden.

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

6. Open <http://localhost:5173/checkin/> to see the check-in station. VS Code forwards this port from the container.

The first container setup requires internet access to download the image and dependencies.

Copilot session files are shared from the host's `~/.copilot/session-state` into
the container user's home; other Copilot configuration and credentials are not
mounted. The host directory must exist before reopening (create it as your
normal user with `mkdir -p ~/.copilot/session-state` if necessary).
Only use trusted code: shared session files may contain sensitive conversations
and are writable from the container.
The container and VS Code run as `node`, with `updateRemoteUserUID` enabled to
match your host UID/GID on Linux. Avoid `sudo` for npm, editing, or Copilot
commands so new files remain host-owned. Compare `id` inside and outside the
container after **Dev Containers: Rebuild and Reopen in Container**.
Sharing history does not transfer a running chat or authentication, and session
discovery depends on the chat provider. Use its history/resume UI if supported;
do not resume the same session concurrently on the host and in a container.

This repository has its own Node.js environment; backend Python development uses
the separate container in `../onsite-print-backend`. The API proxy inside this
container targets `http://host.docker.internal:8080`, reaching the full stack
started on the host from `../onsite-print-server`. Override `API_PROXY_TARGET`
when using a different API server. Reopening does not start the full stack.

The container builds from `.devcontainer/Dockerfile`, which uses Node.js 24 with npm and installs Git, curl, and CA certificates. App dependencies install separately with `npm ci` after the workspace is mounted.

After changing the Dockerfile or container configuration, run **Dev Containers: Rebuild and Reopen in Container** from the Command Palette.

## Make your first change

Edit `src/App.jsx` to change the check-in screens. Saving the file updates the browser automatically.
`src/checkin-api.js` holds API calls, scan parsing, and stored choices.
`src/main.jsx` mounts the React app, and `src/index.css` controls its appearance.

## Commands

```sh
npm run dev      # Start the development server
npm run lint     # Check JavaScript and React code
npm test         # Run unit tests for API and scan helpers
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

Alternatively, trigger the **Publish release** GitHub Actions workflow from the
Actions tab (`workflow_dispatch` only, runs from `main`). It reads the pending
`IMAGE_TAG` from `.env`, builds and pushes the image to GHCR using the built-in
`GITHUB_TOKEN`, tags the published commit on `main` with that version (no `v`
prefix), and commits the incremented `.env` back to `main`. This requires one-
time setup: personal-account repos can't add GitHub Actions to a ruleset's
bypass list, so add a `RELEASE_TOKEN` repository secret holding a fine-grained
personal access token (owned by a repository admin, scoped to this repo with
Contents: Read and write permission), and add the **Repository admin** role to
the branch ruleset's bypass list for `main`. Pushes authenticated with
`RELEASE_TOKEN` are attributed to the token owner's admin role and bypass the
pull-request requirement. Renew the token before it expires.

See the server repo's README for image-only deployment and HTTPS setup. Phone
camera testing requires HTTPS even during development on a LAN.

## Test the publishing script

```sh
bash tests/docker-push-test.sh
```

GitHub Actions runs these tests on pushes and pull requests against this repo's
own script. They use a mocked Docker CLI, do not build or upload images, and
require no credentials or sibling repositories.
