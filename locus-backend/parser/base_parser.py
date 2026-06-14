"""
base_parser.py

Language-neutral base class for all Locus source parsers.

Every language parser subclasses BaseParser and produces the same
*records dict* so the graph builder (analyze.py) never needs to know
which language a file was written in:

    {
        "file":      str,
        "classes":   [{name, bases, start_line, end_line, docstring, text}],
        "functions": [{name, start_line, end_line, docstring, text}],
        "methods":   [{name, class_name, start_line, end_line, docstring, text}],
        "imports":   [{raw, kind, module, names, alias}],
        "calls":     [{caller_name, caller_type, callee_name}],
        "variables": [{name, var_type, parent_class, start_line, end_line}],
    }

Import `kind` semantics (shared across languages):
    "import" — a whole module is imported (Python `import x`,
               JS `import * as x from 'm'` / bare `require('m')`)
    "from"   — named entities are imported from a module (Python
               `from x import y`, JS named imports, Java `import a.b.C`)

Subclasses must:
    - set EXTENSIONS (tuple of file extensions, e.g. (".py",))
    - implement _create_parser() returning a tree_sitter.Parser
    - implement _walk(root, source, source_bytes, result, parent_class)
"""

from __future__ import annotations

from tree_sitter import Parser, Node


class BaseParser:

    #: File extensions this parser handles, e.g. (".py",)
    EXTENSIONS: tuple[str, ...] = ()

    #: tree-sitter node types that represent a call expression
    CALL_NODE_TYPES: tuple[str, ...] = ("call",)

    def __init__(self) -> None:
        self._parser = self._create_parser()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def parse_file(self, filepath: str) -> dict:
        """Parse *filepath* and return the language-neutral records dict."""
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            source = f.read()

        source_bytes = bytes(source, "utf-8")
        tree = self._parser.parse(source_bytes)

        result = {
            "file": filepath,
            "classes":   [],
            "functions": [],
            "methods":   [],
            "imports":   [],
            "calls":     [],
            "variables": [],
        }

        self._walk(tree.root_node, source, source_bytes, result,
                   parent_class=None)
        self._post_parse(tree.root_node, source, result)

        return result

    # ------------------------------------------------------------------
    # Hooks for subclasses
    # ------------------------------------------------------------------

    def _create_parser(self) -> Parser:
        raise NotImplementedError

    def _walk(self, node: Node, source: str, source_bytes: bytes,
              result: dict, parent_class: str | None) -> None:
        raise NotImplementedError

    def _post_parse(self, root: Node, source: str, result: dict) -> None:
        """Optional extra pass over the whole tree (e.g. module variables)."""

    def _extract_callee(self, call_node: Node, source: str) -> str | None:
        """Return a best-effort callee string for a call node."""
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Shared call collection
    # ------------------------------------------------------------------

    def _collect_calls(
        self,
        node: Node,
        source: str,
        result: dict,
        caller_name: str,
        caller_type: str,
    ) -> None:
        """
        DFS inside a function/method body recording every call expression.
        Resolution to actual graph nodes happens later in analyze.py.
        """
        stack = [node]
        while stack:
            n = stack.pop()
            if n.type in self.CALL_NODE_TYPES:
                callee = self._extract_callee(n, source)
                if callee:
                    result["calls"].append({
                        "caller_name": caller_name,
                        "caller_type": caller_type,
                        "callee_name": callee,
                    })
            stack.extend(n.children)

    # ------------------------------------------------------------------
    # Shared helpers
    # ------------------------------------------------------------------

    def _text(self, node: Node, source: str) -> str:
        return source[node.start_byte:node.end_byte]

    def _field_text(self, node: Node, field: str, source: str) -> str:
        child = node.child_by_field_name(field)
        return self._text(child, source) if child else ""
