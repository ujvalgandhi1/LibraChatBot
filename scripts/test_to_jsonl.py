#!/usr/bin/env python
"""
Python half of the cross-language format contract.

format_of() in to-jsonl.py must agree with formatOf() in
app/client/lib/asset-format.js for every case in format_fixtures.json. The
client renders the value as a badge; this module writes it into the indexed
`format` field that drives the facet. Drift means a row shows one format while
being counted under another.

The JS half is app/client/test/format.test.js.

    python -m unittest discover -s scripts -p "test_*.py"
    python scripts\\test_to_jsonl.py
"""
from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "format_fixtures.json"

# to-jsonl.py has a hyphen in its name, so it can't be imported normally.
_spec = importlib.util.spec_from_file_location("to_jsonl", HERE / "to-jsonl.py")
to_jsonl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(to_jsonl)


class FormatContract(unittest.TestCase):
    """format_of() must return the shared fixture value for every case."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.cases = json.loads(FIXTURES.read_text(encoding="utf-8"))["cases"]

    def test_fixture_file_is_present_and_non_trivial(self) -> None:
        self.assertGreaterEqual(len(self.cases), 20, "expected 20+ shared fixtures")

    def test_matches_shared_fixtures(self) -> None:
        for case in self.cases:
            qn, expected, why = case["qualifiedName"], case["format"], case["why"]
            with self.subTest(why=why, qualifiedName=qn):
                self.assertEqual(to_jsonl.format_of(qn), expected)

    def test_tolerates_none(self) -> None:
        self.assertEqual(to_jsonl.format_of(None), "file")
        self.assertEqual(to_jsonl.format_of(""), "file")


class SanitizeKey(unittest.TestCase):
    """Keys must match documents already indexed, or a rerun duplicates instead of merging."""

    def test_replaces_characters_the_index_rejects(self) -> None:
        seen: set[str] = set()
        self.assertEqual(to_jsonl.sanitize_key("abc-123_x=y", seen), "abc-123_x=y")
        seen.clear()
        self.assertEqual(to_jsonl.sanitize_key("a/b:c d", seen), "a_b_c_d")

    def test_blank_keys_get_a_positional_fallback(self) -> None:
        seen: set[str] = set()
        self.assertEqual(to_jsonl.sanitize_key("", seen), "row_1")
        self.assertEqual(to_jsonl.sanitize_key(None, seen), "row_2")

    def test_collisions_are_suffixed_not_overwritten(self) -> None:
        seen: set[str] = set()
        self.assertEqual(to_jsonl.sanitize_key("dup", seen), "dup")
        self.assertEqual(to_jsonl.sanitize_key("dup", seen), "dup_2")
        self.assertEqual(to_jsonl.sanitize_key("dup", seen), "dup_3")


if __name__ == "__main__":
    unittest.main(verbosity=2)
