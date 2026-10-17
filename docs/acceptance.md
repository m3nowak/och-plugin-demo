# Acceptance record

This records how Rat 1.0.0 was checked against the host it targets, and what
was not checked.

## Platform

| | |
| --- | --- |
| Date | 17 October 2026 |
| Host | OpenChamber web 2.3.3 (`@openchamber/web` from npm), unmodified, one fresh isolated instance per suite |
| OS | AlmaLinux 9.8, x86_64 |
| Node.js | 24.22.0 (npm 12.2.1) |
| Browser | Chrome for Testing headless shell 156.0.8078.4 (Playwright 1.64.1) |
| WebGL path | ANGLE on EGL, Mesa radeonsi (AMD Radeon Vega 11), via `--use-angle=gl-egl` |
| Artifact | `dist/rat-1.0.0.zip`, SHA-256 `c6789bbf3df9ddb76fbe4defef3d07bf905342eaa4eac39106d2426e683b08f8` |

## Automated checks (`npm test`, 29 passing)

`tests/acceptance/package.test.mjs` checks the ZIP itself:

- It is byte-identical to a fresh build of the current sources.
- It contains exactly the manifest, icon, panel HTML, prebuilt classic
  script, `LICENSE`, `NOTICE.md` and `THIRD_PARTY_LICENSES.txt`.
- The manifest passes the SDK's own parser: API version 1, panel `rat`
  named "Rat", OpenChamber `>=2.3.3`, no capabilities.
- The root Git manifest declares the same extension as the ZIP, with paths
  relative to the repository root. Its prebuilt script, HTML, icon and
  third-party notices match the ZIP. The script and notices are read before
  rebuilding, so a build cannot conceal stale Git artifacts.
- The panel HTML credits the artwork with the model, author and license
  links. `LICENSE` is MIT and excludes the artwork. `NOTICE.md` records the
  source checksum, the changes, the omitted mask map and the absence of
  endorsement. The licenses of three.js and the SDK are included.

`tests/acceptance/git-install.test.mjs` snapshots the non-ignored working-tree
files, including new files, into a new Git repository without `node_modules/`
or `build/`. The real host Git installer clones it through a test-only Git URL
rewrite, without a remote connection, npm install or build in that checkout.
The test checks that
installation succeeds as source `git`, the prebuilt panel loads, the textured
rat draws and rotates, attribution is present, and there are no page errors.
External browser requests are blocked; the panel requests only its own assets.
This checks local changes before a commit, not the current GitHub branch.
`verify:clean-build` separately checks committed artifacts; it must pass after
all generated files are committed and before they are pushed.

The regression test first failed with `invalid-manifest`. Adding the root
manifest alone changed the failure to `missing-build`. Shipping the prebuilt
panel fixes both. The original ZIP-only checks did not cover Git installation.

`tests/acceptance/panel.test.mjs` installs that ZIP through **Settings →
Extensions → Browse ZIP archive** in a real host. All browser traffic to
anything but loopback is blocked throughout. It then checks that:

- The card reads `ZIP · v1.0.0 · Enabled`, the rail gains a "Rat" entry, and
  the entry opens the panel.
- Canvas screenshots show the textured rat: mostly brown fur, some pink, and
  no part touching the canvas edge.
- Twelve screenshots over 11 s, more than half a turn, all stay framed while
  the silhouette changes. In 250 ms the silhouette changes by less than 25 %,
  so the rotation is slow.
- The panel has no buttons, inputs or focusable controls; it has exactly the
  three attribution links.
- The attribution sits below the scene, inside the panel, with contrast of at
  least 4.5:1. Clicking a link makes the host open it in a new tab.
- When the panel is expanded, collapsed, or the window is resized, the
  drawing buffer follows and the rat stays framed with the attribution
  readable.
- Switching the host to Dark and back to Light while the panel is open
  changes its theme. Its background matches the host card's and the text
  stays readable.
- Closing the panel from the rail, closing it with its close button, and
  showing another rail panel each stop drawing. No frames are drawn and no
  animation frame stays requested, which is the extension's own doing rather
  than browser throttling. Reopening resumes with exactly one callback per
  frame.
- A page in the background stops drawing and resumes the same way.
- Moving the panel to the left zone and back to the right twice, through the
  host's "Move panel to …" menu, keeps it working in both places. The move
  animates the panel's size and position, and the browser can report several
  of those changes at once; the panel acts on the newest.
- After a reload, the panel loads and draws offline. Every request from its
  frame went to its own package path on the host.
- With `prefers-reduced-motion: reduce`, the rat still turns.

`tests/acceptance/failures.test.mjs` uses a fresh host for each case:

- Chromium with `--disable-3d-apis` shows "The 3D view needs WebGL, which is
  not available here." with the attribution intact, and makes no further
  context attempts.
- A test copy of the ZIP whose embedded base-colour texture is replaced by
  non-PNG bytes shows "The rat model could not be loaded." with the
  attribution intact, and decodes nothing further.
- The deliverable ZIP is unchanged afterwards.

Mutation check: each of the following broken builds was installed with
`RAT_TEST_ZIP`, and the matching tests failed as they should:

- plain intersection only, without the clipping test: 90 frames drawn while
  closed;
- untextured grey material: 0 % fur;
- no theme application;
- framing too tight: the rat touched the edge;
- page visibility ignored: 90 frames drawn in the background.

## Manual checks

- Rendered screenshots were compared with the creator's Sketchfab thumbnail.
  Fur pattern, pink ears, nose and tail, eye placement, proportions and the
  Y-up orientation match. Sketchfab's lighting looks greyer.
- The light and dark panels were inspected by eye.
- The normal map's convention was measured, not assumed (see NOTICE.md). An
  integrability test gave a residual of 0.064 for OpenGL against 0.095 for
  DirectX. On calibration maps of known convention it gave 0.002 against
  0.013.

## Not tested, and known limits

- OpenChamber desktop, VS Code, mobile and the relay transport were not
  tested. The extension uses only the SDK's shared web/desktop API, but no
  desktop support is claimed.
- Browsers other than Chromium, displays with a device pixel ratio above 1,
  and touch input were not tested.
- Headless Chromium never hides a page, so the page-background check sets
  `document.visibilityState` to `hidden` and dispatches `visibilitychange` in
  the panel, as a browser does when the tab is switched or minimised.
- On the test machine, Chromium's SwiftShader software renderer crashed its
  GPU process within seconds, even for a bare WebGL triangle and without
  Rat. Software rendering was therefore not tested; the panel would show its
  "graphics device was reset" message in that case.
- OpenChamber 2.3.3 gives an extension no signal when its Rail panel closes.
  It keeps the frame mounted at opacity 0, partly clipped by the narrower
  column. Rat detects the clipping. A future host that hid panels without any
  clipping or `display: none` would leave Rat drawing while invisible.
- No public release, registry entry or GitHub Release was made.
