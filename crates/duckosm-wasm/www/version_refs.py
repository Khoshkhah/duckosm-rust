"""Put a version on the page's own file references, for a deploy (docs/development.md, "The deployed page"). GitHub Pages
sends `cache-control: max-age=600`, so after a deploy a browser can get the new index.html with an old app/duck.js from
its cache. This script adds `?v=<version>` to each relative reference of a .js, .mjs, .wasm, .css, .json or .html file in
the .js and .html files of a folder (in place): the static and dynamic imports, `new URL(...)` (the workers, the wasm
files, look.json), `fetch(...)`, and `src=` / `href=` of the page. An http(s) address and a bare module name of the import
map do not change. Then it checks that no other relative reference of these types is left without a version.

    python3 crates/duckosm-wasm/www/version_refs.py <folder> <version>     # change the files
    python3 crates/duckosm-wasm/www/version_refs.py <folder> --check       # only the check
"""
import pathlib
import re
import sys

REL = r"(?:\./|\.\./)?[\w.-]+(?:/[\w.-]+)*\.(?:js|mjs|wasm|css|json|html)"
LITERAL = re.compile(r"""(["'`])(""" + REL + r""")\1""")
# the places where a string is a reference: a static import, the inside of import( ), new URL( ), fetch( ), and src= / href=
STATIC = re.compile(r"""(\b(?:from|import)\s*)(["'])(""" + REL + r""")\2""")
CALL = re.compile(r"""(\b(?:import|new URL|fetch)\s*\()([^()]*)\)""")
ATTR = re.compile(r"""(\b(?:src|href)=)(["'])(""" + REL + r""")\2""")
# strings that are names, not references: the zip's file, the level editor's store file, wasm-bindgen's import module of the wasm file
NAMES = {"layers.json", "levels_info.json"}


def version(text, v):
    tag = lambda path: f"{path}?v={v}"  # noqa: E731
    text = STATIC.sub(lambda m: f"{m[1]}{m[2]}{tag(m[3])}{m[2]}", text)
    text = CALL.sub(lambda m: m[1] + LITERAL.sub(lambda s: f"{s[1]}{tag(s[2])}{s[1]}", m[2]) + ")", text)
    return ATTR.sub(lambda m: f"{m[1]}{m[2]}{tag(m[3])}{m[2]}", text)


def unversioned(text):
    """The relative references of these types with no version: the strings in " or ' (a name in ` is the text of a comment), less
    the names above."""
    return [m[2] for m in LITERAL.finditer(text) if m[1] != "`" and m[2] not in NAMES and not m[2].endswith("_bg.js")]


def files(folder):
    return sorted(p for p in pathlib.Path(folder).rglob("*") if p.suffix in (".js", ".html") and p.is_file())


def main():
    folder, v = sys.argv[1], sys.argv[2]
    if v != "--check":
        if not re.fullmatch(r"[\w.-]+", v):
            raise SystemExit(f"version_refs: the version must be letters, digits, '.', '_' or '-', not {v!r}")
        for p in files(folder):
            text = p.read_text()
            new = version(text, v)
            if new != text:
                p.write_text(new)
    left = [(p, ref) for p in files(folder) for ref in unversioned(p.read_text())]
    for p, ref in left:
        print(f"no version: {p}: {ref}")
    n = sum(p.read_text().count("?v=") for p in files(folder))
    print(f"version_refs: {n} references with a version, {len(left)} without")
    if left:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
