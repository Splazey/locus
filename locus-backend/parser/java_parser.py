"""
java_parser.py

Parses a single Java source file using Tree-sitter and produces the
same records dict as the other parsers (see base_parser.py for the
contract), plus one extra key:

    "package": "a.b"   — from the package declaration ("" if absent)

Mapping to the language-neutral model
-------------------------------------
- class/interface/enum/record declaration  → class
  (extends + implements                    → bases, all become inherits)
- method_declaration / constructor_declaration → method
- field_declaration in a class body        → variable (parent_class=class)
- import_declaration                       → imports (kind="from",
  module=package, names=[Class] or ["*"])
- method_invocation / new Foo()            → calls   (this. stripped)
- /** Javadoc */ preceding a declaration   → docstring
- functions list stays empty (Java has no top-level functions)
"""

from __future__ import annotations

from tree_sitter import Parser, Language, Node
from tree_sitter_java import language as java_language

from parser.base_parser import BaseParser

_TYPE_DECLS = (
    "class_declaration",
    "interface_declaration",
    "enum_declaration",
    "record_declaration",
)


class JavaParser(BaseParser):

    EXTENSIONS = (".java",)
    CALL_NODE_TYPES = ("method_invocation", "object_creation_expression")

    def _create_parser(self) -> Parser:
        return Parser(Language(java_language()))

    def parse_file(self, filepath: str) -> dict:
        result = super().parse_file(filepath)
        result.setdefault("package", "")
        return result

    # ------------------------------------------------------------------
    # Tree traversal
    # ------------------------------------------------------------------

    def _walk(
        self,
        node: Node,
        source: str,
        source_bytes: bytes,
        result: dict,
        parent_class: str | None,
    ) -> None:
        if node.type == "package_declaration":
            for child in node.children:
                if child.type in ("scoped_identifier", "identifier"):
                    result["package"] = self._text(child, source)
            return

        if node.type == "import_declaration":
            self._handle_import(node, source, result)
            return

        if node.type in _TYPE_DECLS:
            self._handle_type_declaration(node, source, source_bytes, result)
            return

        # default: recurse into children
        for child in node.children:
            self._walk(child, source, source_bytes, result,
                       parent_class=parent_class)

    # ------------------------------------------------------------------
    # Entity handlers
    # ------------------------------------------------------------------

    def _handle_type_declaration(self, node: Node, source: str,
                                 source_bytes: bytes, result: dict) -> None:
        name = self._field_text(node, "name", source)
        if not name:
            return

        bases: list[str] = []
        # extends — single class (field "superclass") or, for interfaces,
        # an interface list (extends_interfaces)
        superclass = node.child_by_field_name("superclass")
        if superclass is not None:
            bases.extend(self._type_names(superclass, source))
        for child in node.children:
            if child.type in ("super_interfaces", "extends_interfaces"):
                bases.extend(self._type_names(child, source))

        result["classes"].append({
            "name":       name,
            "bases":      bases,
            "start_line": node.start_point[0] + 1,
            "end_line":   node.end_point[0]   + 1,
            "docstring":  self._javadoc(node, source),
            "text":       self._text(node, source),
        })

        body = node.child_by_field_name("body")
        if not body:
            return
        for child in body.children:
            if child.type in ("method_declaration", "constructor_declaration"):
                self._handle_method(child, source, result, class_name=name)
            elif child.type == "field_declaration":
                self._handle_field(child, source, result, class_name=name)
            elif child.type in _TYPE_DECLS:
                # Nested type: recorded as its own class
                self._handle_type_declaration(child, source, source_bytes, result)

    def _handle_method(self, node: Node, source: str, result: dict,
                       class_name: str) -> None:
        name = self._field_text(node, "name", source)
        if not name:
            return

        result["methods"].append({
            "name":       name,
            "class_name": class_name,
            "start_line": node.start_point[0] + 1,
            "end_line":   node.end_point[0]   + 1,
            "docstring":  self._javadoc(node, source),
            "text":       self._text(node, source),
        })

        body = node.child_by_field_name("body")
        if body:
            self._collect_calls(body, source, result,
                                caller_name=f"{class_name}.{name}",
                                caller_type="method")

    def _handle_field(self, node: Node, source: str, result: dict,
                      class_name: str) -> None:
        var_type = self._field_text(node, "type", source) or None
        for child in node.children:
            if child.type == "variable_declarator":
                name_node = child.child_by_field_name("name")
                if name_node is None:
                    continue
                result["variables"].append({
                    "name":         self._text(name_node, source),
                    "var_type":     var_type,
                    "parent_class": class_name,
                    "start_line":   node.start_point[0] + 1,
                    "end_line":     node.end_point[0]   + 1,
                })

    def _handle_import(self, node: Node, source: str, result: dict) -> None:
        raw = self._text(node, source).strip()

        dotted = ""
        wildcard = False
        for child in node.children:
            if child.type in ("scoped_identifier", "identifier"):
                dotted = self._text(child, source)
            elif child.type == "asterisk":
                wildcard = True

        if not dotted:
            return

        if wildcard:
            module, names = dotted, ["*"]
        else:
            # "a.b.C" → module "a.b", names ["C"]; works for static
            # member imports too ("a.b.C.member" → module "a.b.C")
            module, _, last = dotted.rpartition(".")
            names = [last]

        result["imports"].append({
            "raw":    raw,
            "kind":   "from",
            "module": module,
            "names":  names,
            "alias":  None,
        })

    # ------------------------------------------------------------------
    # Calls
    # ------------------------------------------------------------------

    def _extract_callee(self, call_node: Node, source: str) -> str | None:
        """
        foo()              → "foo"
        this.bar()         → "bar"
        obj.method()       → "obj.method"
        new Foo()          → "Foo"
        """
        if call_node.type == "object_creation_expression":
            type_node = call_node.child_by_field_name("type")
            if type_node is None:
                return None
            text = self._text(type_node, source).strip()
            # Drop generic arguments: new ArrayList<String>() → ArrayList
            return text.split("<")[0] or None

        obj = call_node.child_by_field_name("object")
        name = self._field_text(call_node, "name", source)
        if not name:
            return None
        if obj is not None:
            obj_text = self._text(obj, source).strip()
            if obj_text not in ("this", "super"):
                return f"{obj_text}.{name}"
        return name

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _type_names(self, node: Node, source: str) -> list[str]:
        """Collect type identifiers from a superclass / interface list node."""
        names: list[str] = []
        stack = list(node.children)
        while stack:
            n = stack.pop()
            if n.type in ("type_identifier", "scoped_type_identifier"):
                names.append(self._text(n, source).split("<")[0])
            elif n.type == "generic_type":
                # ArrayList<String> → ArrayList
                stack.extend(n.children)
            else:
                stack.extend(n.children)
        return names

    def _javadoc(self, node: Node, source: str) -> str:
        """Return the Javadoc block (/** ... */) immediately preceding *node*."""
        prev = node.prev_named_sibling
        if prev is None or prev.type != "block_comment":
            return ""
        raw = self._text(prev, source)
        if not raw.startswith("/**"):
            return ""
        lines = raw.strip("/*").splitlines()
        cleaned = [ln.strip().lstrip("*").strip() for ln in lines]
        return " ".join(ln for ln in cleaned if ln).strip()
