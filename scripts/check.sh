#!/bin/sh
# Everything a commit must pass, stopping at the first failure.
# With arguments, only the matching tests run and the build is skipped.
set -eu

biome ci .
tsc --noEmit
if [ $# -gt 0 ]; then
	bun test "$@"
else
	bun test --pass-with-no-tests
	bun build src/index.ts --outdir dist --target bun
fi
