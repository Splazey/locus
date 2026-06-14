"""
javascript_parser.py

Parses a single JavaScript source file (.js/.jsx/.mjs/.cjs) using
Tree-sitter and produces the same records dict as the other parsers
(see base_parser.py for the contract).

Mapping to the language-neutral model
-------------------------------------
- class_declaration / class expression      → class   (extends → bases)
- method_definition in a class body         → method  ("constructor" kept as-is)
- function_declaration                      → function
- const f = () => {} / function expression  → function (named by the variable)
- top-level const/let/var (non-function)    → variable (parent_class=None)
- field_definition in a class body          → variable (parent_class=class)
- this.x = ... inside constructor           → variable (parent_class=class)
- import_statement (ESM)                    → imports
- require('m') in a top-level declarator    → imports (CommonJS)
- call_expression in function bodies        → calls   (this. stripped)
- /** JSDoc */ preceding a declaration      → docstring
"""

from __future__ import annotations

from tree_sitter import Parser, Language, Node
from tree_sitter_javascript import language as javascript_language

from parser.base_parser import BaseParser

_FUNC_VALUE_TYPES = ("arrow_function", "function_expression", "function")
_DECL_TYPES = ("lexical_declaration", "variable_declaration")


class JavaScriptParser(BaseParser):

    EXTENSIONS = (".js", ".jsx", ".mjs", ".cjs")
    CALL_NODE_TYPES = ("call_expression", "new_expression")

    def _create_parser(self) -> Parser:
        return Parser(Language(javascript_language()))

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
        # Unwrap export wrappers: `export default class A`, `export const f = ...`
        if node.type == "export_statement":
            for child in node.children:
                self._walk(child, source, source_bytes, result, parent_class)
            return

        if node.type in ("class_declaration", "class"):
            self._handle_class(node, source, source_bytes, result)
            return

        if node.type == "function_declaration":
            self._handle_function(node, source, result,
                                  name=self._field_text(node, "name", source))
            return

        if node.type in _DECL_TYPES:
            self._handle_declaration(node, source, source_bytes, result)
            return

        if node.type == "import_statement":
            self._handle_esm_import(node, source, result)
            return

        # default: recurse into children
        for child in node.children:
            self._walk(child, source, source_bytes, result,
                       parent_class=parent_class)

    # ------------------------------------------------------------------
    # Entity handlers
    # ------------------------------------------------------------------

    def _handle_class(self, node: Node, source: str, source_bytes: bytes,
                      result: dict) -> None:
        name = self._field_text(node, "name", source)
        if not name:
            return

        bases: list[str] = []
        for child in node.children:
            if child.type == "class_heritage":
                # class_heritage = "extends" + expression
                for sub in child.children:
                    if sub.type in ("identifier", "member_expression"):
                        bases.append(self._text(sub, source))

        result["classes"].append({
            "name":       name,
            "bases":      bases,
            "start_line": node.start_point[0] + 1,
            "end_line":   node.end_point[0]   + 1,
            "docstring":  self._jsdoc(node, source),
            "text":       self._text(node, source),
        })

        body = node.child_by_field_name("body")
        if not body:
            return
        for child in body.children:
            if child.type == "method_definition":
                self._handle_method(child, source, result, class_name=name)
            elif child.type == "field_definition":
                prop = child.child_by_field_name("property")
                if prop:
                    result["variables"].append({
                        "name":         self._text(prop, source),
                        "var_type":     None,
                        "parent_class": name,
                        "start_line":   child.start_point[0] + 1,
                        "end_line":     child.end_point[0]   + 1,
                    })

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
            "docstring":  self._jsdoc(node, source),
            "text":       self._text(node, source),
        })

        body = node.child_by_field_name("body")
        if body:
            self._collect_calls(body, source, result,
                                caller_name=f"{class_name}.{name}",
                                caller_type="method")
            if name == "constructor":
                self._collect_this_assignments(body, source, result, class_name)

    def _handle_function(self, node: Node, source: str, result: dict,
                         name: str, doc_node: Node | None = None) -> None:
        if not name:
            return
        result["functions"].append({
            "name":       name,
            "start_line": node.start_point[0] + 1,
            "end_line":   node.end_point[0]   + 1,
            "docstring":  self._jsdoc(doc_node or node, source),
            "text":       self._text(node, source),
        })
        body = node.child_by_field_name("body")
        if body:
            self._collect_calls(body, source, result,
                                caller_name=name, caller_type="function")

    def _handle_declaration(self, node: Node, source: str,
                            source_bytes: bytes, result: dict) -> None:
        """const/let/var: function values become functions, require() calls
        become imports, everything else becomes a module-level variable."""
        for decl in node.children:
            if decl.type != "variable_declarator":
                continue
            name_node = decl.child_by_field_name("name")
            value = decl.child_by_field_name("value")

            if value is not None and value.type in _FUNC_VALUE_TYPES:
                if name_node and name_node.type == "identifier":
                    self._handle_function(value, source, result,
                                          name=self._text(name_node, source),
                                          doc_node=node)
                continue

            if value is not None and self._require_module(value, source) is not None:
                self._handle_require(node, name_node, value, source, result)
                continue

            if name_node and name_node.type == "identifier":
                result["variables"].append({
                    "name":         self._text(name_node, source),
                    "var_type":     None,
                    "parent_class": None,
                    "start_line":   node.start_point[0] + 1,
                    "end_line":     node.end_point[0]   + 1,
                })

    # ------------------------------------------------------------------
    # Imports
    # ------------------------------------------------------------------

    def _handle_esm_import(self, node: Node, source: str, result: dict) -> None:
        raw = self._text(node, source).strip()
        src_node = node.child_by_field_name("source")
        if src_node is None:
            return
        module = self._text(src_node, source).strip("'\"`")

        names: list[str] = []
        namespace = False
        for child in node.children:
            if child.type != "import_clause":
                continue
            for sub in child.children:
                if sub.type == "identifier":
                    # default import: `import Foo from 'm'`
                    names.append(self._text(sub, source))
                elif sub.type == "namespace_import":
                    namespace = True
                elif sub.type == "named_imports":
                    for spec in sub.children:
                        if spec.type == "import_specifier":
                            n = spec.child_by_field_name("name")
                            if n:
                                names.append(self._text(n, source))

        if names and not namespace:
            kind = "from"
        else:
            # namespace import or bare `import 'm'` — whole-module import
            kind, names = "import", []

        result["imports"].append({
            "raw":    raw,
            "kind":   kind,
            "module": module,
            "names":  names,
            "alias":  None,
        })

    def _handle_require(self, decl_node: Node, name_node: Node | None,
                        value: Node, source: str, result: dict) -> None:
        raw = self._text(decl_node, source).strip()
        module = self._require_module(value, source)

        if name_node is not None and name_node.type == "object_pattern":
            # const { a, b } = require('m')
            names = []
            for prop in name_node.children:
                if prop.type == "shorthand_property_identifier_pattern":
                    names.append(self._text(prop, source))
                elif prop.type == "pair_pattern":
                    key = prop.child_by_field_name("key")
                    if key:
                        names.append(self._text(key, source))
            kind = "from"
        else:
            # const x = require('m') — whole-module import
            names, kind = [], "import"

        result["imports"].append({
            "raw":    raw,
            "kind":   kind,
            "module": module,
            "names":  names,
            "alias":  None,
        })

    def _require_module(self, value: Node, source: str) -> str | None:
        """If *value* is `require('m')` (or `require('m').x`), return 'm'."""
        if value.type == "member_expression":
            obj = value.child_by_field_name("object")
            if obj is not None:
                value = obj
        if value.type != "call_expression":
            return None
        func = value.child_by_field_name("function")
        if func is None or self._text(func, source) != "require":
            return None
        args = value.child_by_field_name("arguments")
        if args is None:
            return None
        for arg in args.children:
            if arg.type == "string":
                return self._text(arg, source).strip("'\"`")
        return None

    # ------------------------------------------------------------------
    # Constructor field collection (analog of Python __init__ self attrs)
    # ------------------------------------------------------------------

    def _collect_this_assignments(self, body: Node, source: str,
                                  result: dict, class_name: str) -> None:
        seen: set[str] = set()
        stack = list(body.children)
        while stack:
            n = stack.pop()
            if n.type == "assignment_expression":
                left = n.child_by_field_name("left")
                if left is not None and left.type == "member_expression":
                    obj = left.child_by_field_name("object")
                    prop = left.child_by_field_name("property")
                    if obj is not None and prop is not None \
                            and self._text(obj, source) == "this":
                        var_name = self._text(prop, source)
                        if var_name and var_name not in seen:
                            seen.add(var_name)
                            result["variables"].append({
                                "name":         var_name,
                                "var_type":     None,
                                "parent_class": class_name,
                                "start_line":   n.start_point[0] + 1,
                                "end_line":     n.end_point[0]   + 1,
                            })
            stack.extend(n.children)

    # ------------------------------------------------------------------
    # Calls
    # ------------------------------------------------------------------

    def _extract_callee(self, call_node: Node, source: str) -> str | None:
        """
        foo()            → "foo"
        this.bar()       → "bar"        (strip this)
        obj.method()     → "obj.method"
        new Foo()        → "Foo"
        require('m')     → None         (handled as an import)
        """
        if call_node.type == "new_expression":
            ctor = call_node.child_by_field_name("constructor")
            return self._text(ctor, source).strip() if ctor else None

        func = call_node.child_by_field_name("function")
        if func is None:
            return None

        text = self._text(func, source).strip()
        if text == "require" or text.startswith("require("):
            return None
        if text.startswith("this."):
            text = text[len("this."):]
        return text if text else None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _jsdoc(self, node: Node, source: str) -> str:
        """Return the JSDoc block (/** ... */) immediately preceding *node*."""
        prev = node.prev_named_sibling
        if prev is None and node.parent is not None \
                and node.parent.type == "export_statement":
            prev = node.parent.prev_named_sibling
        if prev is None or prev.type != "comment":
            return ""
        raw = self._text(prev, source)
        if not raw.startswith("/**"):
            return ""
        lines = raw.strip("/*").splitlines()
        cleaned = [ln.strip().lstrip("*").strip() for ln in lines]
        return " ".join(ln for ln in cleaned if ln).strip()
