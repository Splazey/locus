"""
extractor.py

Converts raw parser output into a flat list of EntityRecord dicts,
each containing the text content that will be fed into CodeBERT.

Only `class` and `function` records are returned for clustering.
Methods are NOT returned as standalone records; instead their text is
folded into their parent class's representation to enrich the embedding.
After clustering, callers can use `build_method_assignments` to inherit
each method's cluster label from its parent class.

An EntityRecord has:
    id          : globally unique string (mirrors analyze.py node IDs)
    name        : short display name
    type        : class | function
    file        : relative path of the source file
    text        : the concatenated text fed to CodeBERT
"""

from __future__ import annotations
import os
import re


_MAX_CLASS_CHARS  = 2000  # class body + methods budget
_MAX_METHOD_CHARS = 400   # per-method contribution
_MAX_FUNC_CHARS   = 1500


def _clean(text: str) -> str:
    text = re.sub(r"#[^\n]*", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _build_class_text(cls: dict, methods: list[dict]) -> str:
    """
    Combine class name, docstring, class body, and all its method
    signatures + docstrings into one string for CodeBERT.
    """
    parts = [cls["name"]]

    if cls.get("docstring"):
        parts.append(cls["docstring"][:300])

    if cls.get("text"):
        parts.append(_clean(cls["text"])[:_MAX_CLASS_CHARS])

    for m in methods:
        method_parts = [m["name"]]
        if m.get("docstring"):
            method_parts.append(m["docstring"][:150])
        if m.get("text"):
            method_parts.append(_clean(m["text"])[:_MAX_METHOD_CHARS])
        parts.append(" ".join(method_parts))

    return " ".join(parts)


def _build_func_text(func: dict) -> str:
    parts = [func["name"]]
    if func.get("docstring"):
        parts.append(func["docstring"][:300])
    if func.get("text"):
        parts.append(_clean(func["text"])[:_MAX_FUNC_CHARS])
    return " ".join(parts)


def extract_entities(
    parsed_files: dict[str, tuple[str, dict]],
    project_path: str,
) -> list[dict]:
    """
    Returns a list of EntityRecord dicts for `class` and `function` nodes only.
    Method texts are folded into their parent class records.

    Parameters
    ----------
    parsed_files : { relative_path: (file_id, parsed_result) }
    project_path : root directory (unused here, kept for interface consistency)
    """
    records: list[dict] = []

    for relative_path, (file_id, parsed) in parsed_files.items():

        # Group methods by parent class for easy lookup
        methods_by_class: dict[str, list[dict]] = {}
        for m in parsed.get("methods", []):
            methods_by_class.setdefault(m["class_name"], []).append(m)

        # Classes — text includes all child methods
        for cls in parsed.get("classes", []):
            class_id = f"class:{relative_path}:{cls['name']}"
            child_methods = methods_by_class.get(cls["name"], [])
            records.append({
                "id":       class_id,
                "name":     cls["name"],
                "type":     "class",
                "file":     relative_path,
                "docstring": cls.get("docstring", ""),
                "text":     _build_class_text(cls, child_methods),
            })

        # Module-level functions only (not methods)
        for func in parsed.get("functions", []):
            func_id = f"function:{relative_path}:{func['name']}"
            records.append({
                "id":       func_id,
                "name":     func["name"],
                "type":     "function",
                "file":     relative_path,
                "docstring": func.get("docstring", ""),
                "text":     _build_func_text(func),
            })

    return records


def build_method_assignments(
    parsed_files: dict[str, tuple[str, dict]],
    class_cluster_map: dict[str, int],
    cluster_names: dict[int, str],
) -> list[dict]:
    """
    For every method, inherit its parent class's cluster assignment.
    Returns a list of method result dicts (same shape as entity results).

    Parameters
    ----------
    parsed_files      : { relative_path: (file_id, parsed_result) }
    class_cluster_map : { class_node_id: cluster_label_int }
    cluster_names     : { cluster_id: cluster_label_string }
    """
    method_results: list[dict] = []

    for relative_path, (file_id, parsed) in parsed_files.items():
        for m in parsed.get("methods", []):
            method_id  = f"method:{relative_path}:{m['class_name']}.{m['name']}"
            parent_id  = f"class:{relative_path}:{m['class_name']}"
            cluster_id = class_cluster_map.get(parent_id, -1)
            method_results.append({
                "id":           method_id,
                "name":         f"{m['class_name']}.{m['name']}",
                "type":         "method",
                "file":         relative_path,
                "cluster":      cluster_id,
                "cluster_name": cluster_names.get(cluster_id, "noise") if cluster_id != -1 else "noise",
            })

    return method_results
