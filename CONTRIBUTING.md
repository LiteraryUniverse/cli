# Contributing

Run `npm ci`, `npm run typecheck` and `npm test` here. npm installs and builds
the SDK from the commit pinned in package.json and package-lock.json.
Run bun test test for Bun compatibility. CLI workflows call the supported SDK
methods; keep domain and authorization rules on LU.

Add checks through command subprocesses and temporary projects. Preserve local
files, stable write IDs, deployment binding and safe error output. The packed CLI
must run in a clean consumer without either source folder. Keep dependencies
and MIT licensing in the distributable package.

The monorepo SDK contract workflow checks Node and Bun on Windows, macOS
(Intel and Apple Silicon), and Linux. It exercises packed installs and the
installed lu command from paths containing spaces, Unicode and ampersands.
Native keystore checks use temporary deployment entries and remove them during
cleanup. They require an available, unlocked OS store: set LU_TEST_NATIVE_KEYSTORE
to 1 and run node --test test/credentials-native.test.mjs or bun test on that file.

To adopt an SDK change, push the SDK commit first, update the Git commit in the
CLI dependency, regenerate package-lock.json with npm install, and run the
checks above. The CLI always tests the SDK commit it ships. In the monorepo,
commit changes inside each submodule before updating the parent pointers.
