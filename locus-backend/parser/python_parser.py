"""
python_parser.py

Parses a single Python source file using Tree-sitter and extracts a
structured representation of every entity and relationship it contains.

Extracted entities
------------------
- Files
- Classes  (with base-class names for inheritance resolution)
- Methods   (functions defined inside a class body)
- Functions (module-level functions)
- Imports   (structured, ready for cross-file resolution)

Extracted relationships (within one file)
-----------------------------------------
- file      → contains  → class
- file      → contains  → function
- class     → contains  → method
- class     → inherits  → <base class name>   (resolved later)
- function  → calls     → <callee name>       (resolved later)
- method    → calls     → <callee name>       (resolved later)

Every node carries:
- id         : globally unique string
- name       : short display name
- type       : file | class | method | function | import
- start_line : 1-based line number  (for frontend navigation)
- end_line   : 1-based line number
- docstring  : first string literal in body (for CodeBERT embedding)
- text       : raw source text of the entity  (for CodeBERT embedding)
"""

from __future__ import annotations

from tree_sitter import Parser, Language, Node
from tree_sitter_python import language as python_language

from parser.base_parser import BaseParser


class PythonParser(BaseParser):

    EXTENSIONS = (".py",)
    CALL_NODE_TYPES = ("call",)

    def _create_parser(self) -> Parser:
        return Parser(Language(python_language()))

    def _post_parse(self, root: Node, source: str, result: dict) -> None:
        self._collect_module_variables(root, source, result)

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
        """
        Recursive DFS.  We recurse manually (not via a stack) so that we
        can carry *parent_class* context down into class bodies.
        """

        if node.type == "class_definition":
            self._handle_class(node, source, source_bytes, result)
            # recurse into class body with this class as parent
            body = node.child_by_field_name("body")
            if body:
                class_name = self._field_text(node, "name", source)
                for child in body.children:
                    self._walk(child, source, source_bytes, result,
                               parent_class=class_name)
            return  # already walked body; don't fall through

        if node.type == "function_definition":
            self._handle_function(node, source, source_bytes, result,
                                  parent_class)
            # recurse into function body to find nested calls
            body = node.child_by_field_name("body")
            func_name = self._field_text(node, "name", source)
            caller_type = "method" if parent_class else "function"
            caller_id   = (f"{parent_class}.{func_name}"
                           if parent_class else func_name)
            if body:
                self._collect_calls(body, source, result,
                                    caller_name=caller_id,
                                    caller_type=caller_type)
            return

        if node.type in ("import_statement", "import_from_statement"):
            self._handle_import(node, source, result)
            return

        # default: recurse into children
        for child in node.children:
            self._walk(child, source, source_bytes, result,
                       parent_class=parent_class)

    # ------------------------------------------------------------------
    # Entity handlers
    # ------------------------------------------------------------------

    def _handle_class(
        self,
        node: Node,
        source: str,
        source_bytes: bytes,
        result: dict,
    ) -> None:
        name = self._field_text(node, "name", source)
        if not name:
            return

        # Base classes ------------------------------------------------
        bases: list[str] = []
        # tree-sitter-python stores superclasses in an argument_list node
        # that is a direct child (not a named field in all versions)
        for child in node.children:
            if child.type == "argument_list":
                for arg in child.children:
                    if arg.type in ("identifier", "attribute"):
                        bases.append(self._text(arg, source))

        result["classes"].append({
            "name":       name,
            "bases":      bases,              # raw names, resolved later
            "start_line": node.start_point[0] + 1,
            "end_line":   node.end_point[0]   + 1,
            "docstring":  self._docstring(node, source),
            "text":       self._text(node, source),
        })
        self._collect_class_variables(node, source, result, name)

    def _handle_function(
        self,
        node: Node,
        source: str,
        source_bytes: bytes,
        result: dict,
        parent_class: str | None,
    ) -> None:
        name = self._field_text(node, "name", source)
        if not name:
            return

        entry = {
            "name":       name,
            "start_line": node.start_point[0] + 1,
            "end_line":   node.end_point[0]   + 1,
            "docstring":  self._docstring(node, source),
            "text":       self._text(node, source),
        }

        if parent_class:
            entry["class_name"] = parent_class
            result["methods"].append(entry)
            if name == "__init__":
                self._collect_init_self_attrs(node, source, result, parent_class)
        else:
            result["functions"].append(entry)

    def _handle_import(
        self,
        node: Node,
        source: str,
        result: dict,
    ) -> None:
        raw  = self._text(node, source).strip()
        kind = node.type  # import_statement | import_from_statement

        if kind == "import_statement":
            # e.g. "import os" or "import os as operating_system"
            for child in node.children:
                if child.type == "dotted_name":
                    result["imports"].append({
                        "raw":    raw,
                        "kind":   "import",
                        "module": self._text(child, source),
                        "names":  [],
                        "alias":  None,
                    })
                elif child.type == "aliased_import":
                    # import foo as bar
                    name_node  = child.child_by_field_name("name")
                    alias_node = child.child_by_field_name("alias")
                    result["imports"].append({
                        "raw":    raw,
                        "kind":   "import",
                        "module": self._text(name_node, source) if name_node else "",
                        "names":  [],
                        "alias":  self._text(alias_node, source) if alias_node else None,
                    })

        elif kind == "import_from_statement":
            # e.g. "from os.path import join, exists"
            module_node = node.child_by_field_name("module_name")
            module = self._text(module_node, source) if module_node else ""

            names: list[str] = []
            for child in node.children:
                if child.type == "dotted_name" and child != module_node:
                    names.append(self._text(child, source))
                elif child.type == "aliased_import":
                    n = child.child_by_field_name("name")
                    if n:
                        names.append(self._text(n, source))
                elif child.type == "wildcard_import":
                    names.append("*")

            result["imports"].append({
                "raw":    raw,
                "kind":   "from",
                "module": module,
                "names":  names,
                "alias":  None,
            })

    # ------------------------------------------------------------------
    # Variable collection
    # ------------------------------------------------------------------

    def _collect_module_variables(self, module_node: Node, source: str, result: dict) -> None:
        """Collect variable assignments that are direct children of the module."""
        for child in module_node.children:
            if child.type in ("assignment", "annotated_assignment"):
                self._extract_variable(child, source, result, parent_class=None)

    def _collect_class_variables(self, class_node: Node, source: str, result: dict, class_name: str) -> None:
        """Collect direct attribute assignments in a class body (not inside methods)."""
        body = class_node.child_by_field_name("body")
        if not body:
            return
        for child in body.children:
            if child.type in ("assignment", "annotated_assignment"):
                self._extract_variable(child, source, result, parent_class=class_name)

    def _collect_init_self_attrs(self, func_node: Node, source: str, result: dict, class_name: str) -> None:
        """Collect self.x = ... assignments inside __init__, deduplicating by name."""
        body = func_node.child_by_field_name("body")
        if not body:
            return
        seen: set[str] = set()
        stack = list(body.children)
        while stack:
            n = stack.pop()
            if n.type in ("assignment", "annotated_assignment"):
                left = n.child_by_field_name("left")
                if left and left.type == "attribute":
                    obj = left.child_by_field_name("object")
                    attr_node = left.child_by_field_name("attribute")
                    if obj and attr_node and self._text(obj, source) in ("self", "cls"):
                        var_name = self._text(attr_node, source)
                        if var_name and var_name not in seen:
                            seen.add(var_name)
                            var_type = None
                            if n.type == "annotated_assignment":
                                type_node = n.child_by_field_name("type")
                                if type_node:
                                    var_type = self._text(type_node, source)
                            result["variables"].append({
                                "name":        var_name,
                                "var_type":    var_type,
                                "parent_class": class_name,
                                "start_line":  n.start_point[0] + 1,
                                "end_line":    n.end_point[0]   + 1,
                            })
            else:
                stack.extend(n.children)

    def _extract_variable(self, node: Node, source: str, result: dict, parent_class: str | None) -> None:
        """Extract a simple variable from an assignment or annotated_assignment node."""
        left = node.child_by_field_name("left")
        if not left or left.type != "identifier":
            return
        var_name = self._text(left, source)
        if not var_name:
            return
        var_type = None
        if node.type == "annotated_assignment":
            type_node = node.child_by_field_name("type")
            if type_node:
                var_type = self._text(type_node, source)
        result["variables"].append({
            "name":        var_name,
            "var_type":    var_type,
            "parent_class": parent_class,
            "start_line":  node.start_point[0] + 1,
            "end_line":    node.end_point[0]   + 1,
        })

    # ------------------------------------------------------------------
    # Call collection  (walks a function/method body)
    # ------------------------------------------------------------------

    def _extract_callee(self, call_node: Node, source: str) -> str | None:
        """
        From a `call` node return a best-effort callee string.

        foo()           → "foo"
        self.bar()      → "bar"           (strip self/cls)
        obj.method()    → "obj.method"
        Foo.static()    → "Foo.static"
        """
        func = call_node.child_by_field_name("function")
        if func is None:
            return None

        text = self._text(func, source).strip()

        # Strip leading self. / cls. for cleaner matching
        for prefix in ("self.", "cls."):
            if text.startswith(prefix):
                text = text[len(prefix):]
                break

        return text if text else None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _docstring(self, node: Node, source: str) -> str:
        """
        Return the first string literal in the node's body, if it exists.
        This is what Python uses as a docstring.
        Used by CodeBERT for richer semantic embeddings.
        """
        body = node.child_by_field_name("body")
        if not body:
            return ""
        for child in body.children:
            if child.type == "expression_statement":
                for sub in child.children:
                    if sub.type == "string":
                        raw = self._text(sub, source)
                        # Strip surrounding quotes
                        return raw.strip("'\"").strip()
        return ""