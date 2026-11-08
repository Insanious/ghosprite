#!/bin/sh
# Regenerates drawing goldens with the local Aseprite, then runs the driver a
# second time and fails unless that run reproduces the file byte for byte.
# With arguments, only the named groups run; otherwise every group does.
set -eu

aseprite="$HOME/Programming/aseprite/build/bin/aseprite"
dir=tests/fixtures/draw

if [ $# -eq 0 ]; then
	for spec in "$dir"/*.json; do
		set -- "$@" "$(basename "$spec" .json)"
	done
fi

first=$(mktemp)
trap 'rm -f "$first"' EXIT

for group in "$@"; do
	"$aseprite" -b --script-param cases="$group" --script "$dir/draw.lua"
	cp "$dir/$group.aseprite" "$first"
	"$aseprite" -b --script-param cases="$group" --script "$dir/draw.lua"
	if ! cmp -s "$first" "$dir/$group.aseprite"; then
		echo "$group: a second run wrote different bytes" >&2
		exit 1
	fi
	echo "$group: regenerated, rerun identical"
done
