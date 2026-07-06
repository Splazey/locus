"""
typescript_parser.py

Parses TypeScript source files (.ts/.tsx) using Tree-sitter and produces
the same records dict as the other parsers (see base_parser.py for the
contract).

TypeScript's grammar is a structural superset of JavaScript's for every
construct Locus extracts (classes, functions, methods, imports, calls,
variables) — type annotations, interfaces, generics, and enums are simply
not visited by JavaScriptParser's walk. So this parser reuses all of
JavaScriptParser's traversal/extraction logic and only adds TypeScript's
two grammars (plain .ts vs JSX-flavored .tsx).
"""

from __future__ import annotations

from tree_sitter import Parser, Language
from tree_sitter_typescript import language_typescript, language_tsx

from parser.javascript_parser import JavaScriptParser


class TypeScriptParser(JavaScriptParser):

    EXTENSIONS = (".ts", ".tsx")

    def __init__(self) -> None:
        self._ts_parser = Parser(Language(language_typescript()))
        self._tsx_parser = Parser(Language(language_tsx()))
        super().__init__()

    def _create_parser(self) -> Parser:
        # Default grammar for __init__; parse_file swaps in the right one
        # per file based on extension (.tsx needs JSX support, .ts doesn't).
        return self._ts_parser

    def parse_file(self, filepath: str) -> dict:
        self._parser = self._tsx_parser if filepath.endswith(".tsx") else self._ts_parser
        return super().parse_file(filepath)
