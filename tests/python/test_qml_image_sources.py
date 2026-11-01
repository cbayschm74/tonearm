"""No QML element may load a remote URL: every `source:` is local or empty.

Marketplace security review, 2026-10-31, against 0.14.1:

    Panel.qml:406-416 loads Model.artUrl() directly in Qt Image; Model.js
    constructs the configured Roon Core's plaintext HTTP image URL. An
    attacker controlling/spoofing that referenced Core response can exhaust
    shared-shell memory with an oversized body before decoding; sourceSize
    acts later, and the separate art helper's byte cap/tonearmd MemoryMax do
    not contain this shell-side fetch.

The fix moves every fetch into tonearmd (art.py: byte cap, header-checked
dimensions, same-origin redirects) and leaves the widget nothing to do but
load the file the daemon wrote. This scan is what keeps it that way. Every
`source:` binding in every QML file -- Image, ColorQuantizer, anything added
later, Loader included -- must go through one of Model.js's local-path
helpers, which refuse anything that is not a plain absolute path, or be
empty. A new element that binds a URL some other way fails here, rather than
shipping as a shell-side fetch nobody noticed.

Same shape and same reasoning as test_qml_text_format.py: asserted across
every binding rather than "the ones that carry Core data", because that
classification has to be redone on every new binding and being wrong is
silent.
"""

import os
import re
import unittest

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# The only expressions a `source:` may be built from. Both helpers return
# either "" or "file://" + a path matching a strict absolute-path shape.
LOCAL_HELPERS = ("Model.artSource(", "Model.rowArtSource(")

# `source:` as a property binding -- not `sourceSize`, not `.source` reads.
_SOURCE = re.compile(r"(?<![A-Za-z_.])source\s*:\s*(.+)$", re.MULTILINE)

# A string literal that opens with a URL scheme able to reach the network.
_REMOTE_LITERAL = re.compile(r"""["'`](?:https?|ftp|wss?|data|qrc|image):""", re.I)


def shell_sources():
    """Every QML and JS file the shell loads: the plugin root, not tests/docs."""
    out = []
    for name in sorted(os.listdir(REPO)):
        if name.endswith((".qml", ".js")) and os.path.isfile(os.path.join(REPO, name)):
            out.append(name)
    return out


def qml_files():
    return [n for n in shell_sources() if n.endswith(".qml")]


def strip_comments(source):
    """Drop // line comments, leaving `file://` inside strings alone."""
    return re.sub(r"(?<![:\"'])//.*$", "", source, flags=re.MULTILINE)


def read(name):
    with open(os.path.join(REPO, name)) as handle:
        return handle.read()


class TestEveryImageSourceIsLocal(unittest.TestCase):
    def test_every_source_binding_goes_through_a_local_path_helper(self):
        bad = []
        for name in qml_files():
            source = strip_comments(read(name))
            for match in _SOURCE.finditer(source):
                expr = match.group(1).strip()
                line = source[:match.start()].count("\n") + 1
                if expr in ('""', "''"):
                    continue
                if any(h in expr for h in LOCAL_HELPERS) and "+" not in expr:
                    continue
                bad.append("%s:%d -> %s" % (name, line, expr))
        self.assertEqual(bad, [], "source bindings not proven local: %s" % bad)

    def test_no_shell_file_builds_a_remote_url(self):
        # Belt to the braces above: no string literal in any file the shell
        # loads may open with a network scheme, so a URL cannot be assembled
        # in Model.js and smuggled through a helper's name.
        bad = []
        for name in shell_sources():
            source = strip_comments(read(name))
            for match in _REMOTE_LITERAL.finditer(source):
                line = source[:match.start()].count("\n") + 1
                bad.append("%s:%d" % (name, line))
        self.assertEqual(bad, [], "remote URL literals in shell code: %s" % bad)

    def test_the_old_url_builders_are_not_referenced(self):
        bad = []
        for name in shell_sources():
            source = strip_comments(read(name))
            for word in ("artUrl", "imageUrl", "rowArtUrl", "/api/image/"):
                if word in source:
                    bad.append("%s: %s" % (name, word))
        self.assertEqual(bad, [], bad)

    def test_the_scan_actually_finds_the_image_sources(self):
        # A regex that matched nothing would let all three pass vacuously.
        found = sum(len(_SOURCE.findall(strip_comments(read(n))))
                    for n in qml_files())
        # Panel.qml: the now-playing Image and ColorQuantizer; BrowsePane.qml:
        # the row Image.
        self.assertGreaterEqual(found, 3, "only found %d source bindings" % found)
        self.assertIn("Panel.qml", qml_files())
        self.assertIn("BrowsePane.qml", qml_files())
        self.assertIn("Model.js", shell_sources())


if __name__ == "__main__":
    unittest.main()
