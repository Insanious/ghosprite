#!/bin/sh
# Regenerates goldens with the local Aseprite, then runs the driver a second
# time and fails unless that run reproduces every file byte for byte.
# A group is found by its <group>.json in tests/fixtures/draw or tests/fixtures/doc.
# With arguments, only the named groups run; otherwise every group does.
set -eu

aseprite="$HOME/Programming/aseprite/build/bin/aseprite"
draw=tests/fixtures/draw
doc=tests/fixtures/doc

if [ $# -eq 0 ]; then
	for spec in "$draw"/*.json "$doc"/*.json; do
		set -- "$@" "$(basename "$spec" .json)"
	done
fi

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

for group in "$@"; do
	if [ -f "$draw/$group.json" ]; then
		"$aseprite" -b --script-param cases="$group" --script "$draw/draw.lua"
		cp "$draw/$group.aseprite" "$scratch/first"
		"$aseprite" -b --script-param cases="$group" --script "$draw/draw.lua"
		if ! cmp -s "$scratch/first" "$draw/$group.aseprite"; then
			echo "$group: a second run wrote different bytes" >&2
			exit 1
		fi
	elif [ -f "$doc/$group.json" ]; then
		"$aseprite" -b --script-param cases="$group" --script "$doc/doc.lua"
		rm -rf "$scratch/first"
		mkdir "$scratch/first"
		cp "$doc/base.aseprite" "$doc/base-clear.aseprite" "$doc/base-layers.aseprite" "$doc/base-props.aseprite" "$scratch/first"
		cp -r "$doc/$group" "$scratch/first/$group"
		"$aseprite" -b --script-param cases="$group" --script "$doc/doc.lua"
		rm -rf "$scratch/second"
		mkdir "$scratch/second"
		cp "$doc/base.aseprite" "$doc/base-clear.aseprite" "$doc/base-layers.aseprite" "$doc/base-props.aseprite" "$scratch/second"
		cp -r "$doc/$group" "$scratch/second/$group"
		if ! diff -r "$scratch/first" "$scratch/second" >/dev/null; then
			echo "$group: a second run wrote different bytes" >&2
			exit 1
		fi
	else
		echo "$group: no $group.json in $draw or $doc" >&2
		exit 1
	fi
	echo "$group: regenerated, rerun identical"
done
