import os
import json
import argparse


def emit_progress(percent, message):
    """Print a machine-readable progress line consumed by the Electron host.

    Format: ##LOCUS_PROGRESS## {"percent": 42, "message": "Parsing main.js"}
    Regular human-readable prints are unaffected.
    """
    payload = json.dumps({"percent": round(percent), "message": message})
    print(f"##LOCUS_PROGRESS## {payload}", flush=True)


EXT_TO_LANG = {
    ".py":   "python",
    ".js":   "javascript",
    ".jsx":  "javascript",
    ".mjs":  "javascript",
    ".cjs":  "javascript",
    ".java": "java",
    ".ts":   "typescript",
    ".tsx":  "typescript",
}

# Directories that never contain first-party source worth graphing
SKIP_DIRS = {
    "node_modules", "__pycache__", ".git", "venv", ".venv",
    "build", "dist", "target", "out", ".idea", ".vscode",
}

# Extra directories skipped only in --lite mode (tests, fixtures, generated bundles).
LITE_SKIP_DIRS = {
    "test", "tests", "__tests__", "spec", "specs", "fixtures",
    "vendor", "examples", "example", "docs", "doc", "benchmark", "benchmarks",
}


def get_parser(lang):
    """Lazily import and instantiate the parser for *lang*, so grammar
    packages are only required for languages actually present."""
    if lang == "python":
        from parser.python_parser import PythonParser
        return PythonParser()
    if lang == "javascript":
        from parser.javascript_parser import JavaScriptParser
        return JavaScriptParser()
    if lang == "java":
        from parser.java_parser import JavaParser
        return JavaParser()
    if lang == "typescript":
        from parser.typescript_parser import TypeScriptParser
        return TypeScriptParser()
    raise ValueError(f"Unsupported language: {lang}")


def find_source_files(project_path, lite=False):
    """Walk *project_path* and return [(filepath, language), ...] for every
    supported source file, auto-detecting language by extension.

    In *lite* mode, additionally skip test/vendor/docs directories and minified
    bundles to keep large codebases manageable."""
    skip = SKIP_DIRS | LITE_SKIP_DIRS if lite else SKIP_DIRS
    source_files = []
    for root, dirs, files in os.walk(project_path):
        dirs[:] = [d for d in dirs if d.lower() not in skip]
        for file in files:
            if lite and file.lower().endswith((".min.js", ".bundle.js")):
                continue
            ext = os.path.splitext(file)[1].lower()
            lang = EXT_TO_LANG.get(ext)
            if lang:
                source_files.append((os.path.join(root, file), lang))
    return source_files

def create_node(node_id, name, node_type, start_line=None, end_line=None, docstring=None, var_type=None):
    node = {
        "id": node_id,
        "name": name,
        "type": node_type
    }
    if start_line is not None:
        node["start_line"] = start_line
    if end_line is not None:
        node["end_line"] = end_line
    if docstring is not None:
        node["docstring"] = docstring
    if var_type is not None:
        node["var_type"] = var_type
    return node

def create_edge(source, target, edge_type, raw=None):
    edge = {"source": source, "target": target, "type": edge_type}
    if raw is not None:
        edge["raw"] = raw
    return edge

def relative_path_to_module(relative_path):
    """Convert a relative file path like 'auth.py' or 'sub/mod.py' to a module name."""
    no_ext = os.path.splitext(relative_path)[0]
    return no_ext.replace(os.sep, ".").replace("/", ".")

def main():
    ap = argparse.ArgumentParser(
        description="Analyze a Python, JavaScript, or Java project and build a code graph."
    )
    ap.add_argument(
        "project_path",
        nargs="?",
        default="sample_projects",
        help="Path to the project directory to analyze (default: sample_projects)",
    )
    ap.add_argument(
        "--output",
        default="output/graph.json",
        help="Output path for the graph JSON (default: output/graph.json)",
    )
    ap.add_argument(
        "--cluster",
        action="store_true",
        help="Run the semantic clustering pipeline and enrich graph.json with cluster nodes and belongs_to edges.",
    )
    ap.add_argument(
        "--lite",
        action="store_true",
        help="Lite mode for very large codebases: drop variable nodes (~60%% of nodes) "
             "and skip test/build/vendor directories to keep the graph small.",
    )
    ap.add_argument(
        "--no-labels",
        action="store_true",
        help="When --cluster is set, skip Claude API labelling (uses fallback names).",
    )
    ap.add_argument(
        "--min-cluster-size",
        type=int,
        default=None,
        help="Minimum entities per cluster when --cluster is set.",
    )
    ap.add_argument(
        "--api-key",
        default=None,
        help="Anthropic API key for cluster labelling (default: ANTHROPIC_API_KEY env var).",
    )
    args = ap.parse_args()

    PROJECT_PATH = args.project_path
    OUTPUT_PATH = args.output

    emit_progress(1, "Scanning project files")
    graph = {"nodes": [], "edges": []}
    source_files = find_source_files(PROJECT_PATH, lite=args.lite)
    emit_progress(3, f"Found {len(source_files)} source files")

    # Progress budget: parsing fills most of the bar, but leaves room for the
    # clustering pipeline when it is enabled.
    PARSE_START = 4
    PARSE_END = 35 if args.cluster else 78
    total_files = len(source_files) or 1

    # Auto-detected language breakdown
    lang_counts = {}
    for _, lang in source_files:
        lang_counts[lang] = lang_counts.get(lang, 0) + 1
    print("Detected languages: " + (", ".join(
        f"{lang} ({n} files)" for lang, n in sorted(lang_counts.items())
    ) or "none"))

    parsers = {lang: get_parser(lang) for lang in lang_counts}

    # --- First pass: parse all files and build all entity nodes ---
    all_parsed = {}  # relative_path → (file_id, parsed result)
    rel_path_lang = {}  # relative_path → language
    # module_name → file_id
    module_to_file_id = {}
    # (relative_path, entity_name) → node_id  (for classes and functions)
    local_entity = {}
    # Java: fully-qualified class name → relative_path; package → [rel_path]
    fqcn_to_rel_path = {}
    package_to_rel_paths = {}

    for file_index, (filepath, lang) in enumerate(source_files):
        relative_path_display = os.path.relpath(filepath, PROJECT_PATH)
        emit_progress(
            PARSE_START + (file_index / total_files) * (PARSE_END - PARSE_START),
            f"Parsing {relative_path_display}",
        )
        parsed = parsers[lang].parse_file(filepath)
        relative_path = os.path.relpath(filepath, PROJECT_PATH)
        file_id = f"file:{relative_path}"

        all_parsed[relative_path] = (file_id, parsed)
        rel_path_lang[relative_path] = lang

        graph["nodes"].append(create_node(file_id, relative_path, "file"))

        if lang == "python":
            module_name = relative_path_to_module(relative_path)
            module_to_file_id[module_name] = file_id
        elif lang == "java":
            package = parsed.get("package", "")
            package_to_rel_paths.setdefault(package, []).append(relative_path)
            for cls in parsed["classes"]:
                fqcn = f"{package}.{cls['name']}" if package else cls["name"]
                fqcn_to_rel_path[fqcn] = relative_path

        for cls in parsed["classes"]:
            class_id = f"class:{relative_path}:{cls['name']}"
            graph["nodes"].append(create_node(
                class_id, cls["name"], "class",
                cls.get("start_line"), cls.get("end_line"), cls.get("docstring")
            ))
            graph["edges"].append(create_edge(file_id, class_id, "contains"))
            local_entity[(relative_path, cls["name"])] = class_id

            for base in cls.get("bases", []):
                base_id = f"class:{base}"
                graph["edges"].append(create_edge(class_id, base_id, "inherits"))

        for func in parsed["functions"]:
            function_id = f"function:{relative_path}:{func['name']}"
            graph["nodes"].append(create_node(
                function_id, func["name"], "function",
                func.get("start_line"), func.get("end_line"), func.get("docstring")
            ))
            graph["edges"].append(create_edge(file_id, function_id, "contains"))
            local_entity[(relative_path, func["name"])] = function_id

        for method in parsed["methods"]:
            method_id = f"method:{relative_path}:{method['class_name']}.{method['name']}"
            class_id = f"class:{relative_path}:{method['class_name']}"
            graph["nodes"].append(create_node(
                method_id,
                f"{method['class_name']}.{method['name']}",
                "method",
                method.get("start_line"), method.get("end_line"), method.get("docstring")
            ))
            graph["edges"].append(create_edge(class_id, method_id, "contains"))

        # Deduplicate variables by (parent_class_or_module, name) to avoid repeated self.x.
        # In lite mode, variables are dropped entirely (they are ~60% of nodes).
        seen_vars = set()
        for var in ([] if args.lite else parsed.get("variables", [])):
            parent_class = var.get("parent_class")
            dedup_key = (relative_path, parent_class or "__module__", var["name"])
            if dedup_key in seen_vars:
                continue
            seen_vars.add(dedup_key)

            if parent_class:
                parent_id = f"class:{relative_path}:{parent_class}"
            else:
                parent_id = file_id

            var_id = f"variable:{relative_path}:{parent_class or 'module'}.{var['name']}:{var['start_line']}"
            graph["nodes"].append(create_node(
                var_id, var["name"], "variable",
                var.get("start_line"), var.get("end_line"),
                var_type=var.get("var_type")
            ))
            graph["edges"].append(create_edge(parent_id, var_id, "contains"))

    # Build reverse map: module_name → relative_path (Python import resolution)
    module_to_rel_path = {
        relative_path_to_module(rel): rel
        for rel, lang in rel_path_lang.items() if lang == "python"
    }
    # Also index by the last component of the module path for same-dir resolution.
    # e.g. "1.auth" → "1\auth.py" but also "auth" → "1\auth.py" (if unambiguous)
    short_module_to_rel_paths = {}  # short_name → [rel_path, ...]
    for full_mod, rel in module_to_rel_path.items():
        short = full_mod.split(".")[-1]
        short_module_to_rel_paths.setdefault(short, []).append(rel)

    # JS/TS files indexed by normalized relative path (forward slashes)
    js_rel_paths = {
        rel.replace(os.sep, "/"): rel
        for rel, lang in rel_path_lang.items() if lang in ("javascript", "typescript")
    }

    def resolve_python_module(module, importer_rel_path):
        """Return the relative path of the local file matching *module*, or None."""
        # 1. Exact full module match (e.g. "src.domain.article")
        if module in module_to_rel_path:
            return module_to_rel_path[module]
        # 2. Same-directory: if importer is in dir X, look for X.<module>
        importer_dir = os.path.dirname(importer_rel_path)
        if importer_dir:
            candidate = importer_dir.replace(os.sep, ".") + "." + module
        else:
            candidate = module
        if candidate in module_to_rel_path:
            return module_to_rel_path[candidate]
        # 3. Unqualified short name — only if exactly one file has that stem
        short = module.split(".")[-1]
        matches = short_module_to_rel_paths.get(short, [])
        # Filter to files in the same directory as the importer
        same_dir = [m for m in matches if os.path.dirname(m) == importer_dir]
        if len(same_dir) == 1:
            return same_dir[0]
        return None

    def resolve_js_module(module, importer_rel_path):
        """Resolve a JS import specifier against local files. Only relative
        specifiers ('./x', '../y') can be local; bare ones are external."""
        if not module.startswith("."):
            return None
        importer_dir = os.path.dirname(importer_rel_path).replace(os.sep, "/")
        joined = os.path.normpath(os.path.join(importer_dir, module)).replace(os.sep, "/")
        candidates = [joined] if os.path.splitext(joined)[1] else []
        candidates += [joined + ext for ext in
                       (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")]
        candidates.append(joined + "/index.ts")
        candidates.append(joined + "/index.tsx")
        candidates.append(joined + "/index.js")
        for cand in candidates:
            if cand in js_rel_paths:
                return js_rel_paths[cand]
        return None

    def resolve_java_import(module, names):
        """Resolve a Java import (module='a.b', names=['C'] or ['*']) to local
        relative paths. Returns a list (possibly empty)."""
        resolved = []
        for name in names:
            if name == "*":
                resolved.extend(package_to_rel_paths.get(module, []))
            else:
                rel = fqcn_to_rel_path.get(f"{module}.{name}" if module else name)
                if rel:
                    resolved.append(rel)
        return resolved

    def resolve_module(module, importer_rel_path):
        lang = rel_path_lang.get(importer_rel_path, "python")
        if lang in ("javascript", "typescript"):
            return resolve_js_module(module, importer_rel_path)
        if lang == "java":
            return None  # Java handled separately via resolve_java_import
        return resolve_python_module(module, importer_rel_path)

    # --- Second pass: resolve imports ---
    emit_progress(PARSE_END + 2, "Resolving imports")
    # Track created import_module / import_entity nodes to avoid duplicates across files
    created_import_modules  = set()  # module name → node already emitted
    created_import_entities = set()  # (module, name) → node already emitted

    def ensure_import_module(module):
        """Emit an import_module node for *module* if not already done. Returns its id."""
        mod_id = f"import_module:{module}"
        if module not in created_import_modules:
            created_import_modules.add(module)
            graph["nodes"].append(create_node(mod_id, module, "import_module"))
        return mod_id

    def ensure_import_entity(module, name):
        """Emit an import_entity node and a has_entity edge if not already done. Returns its id."""
        key = (module, name)
        entity_id = f"import_entity:{module}:{name}"
        if key not in created_import_entities:
            created_import_entities.add(key)
            mod_id = ensure_import_module(module)
            graph["nodes"].append(create_node(entity_id, name, "import_entity"))
            graph["edges"].append(create_edge(entity_id, mod_id, "has_entity"))
        return entity_id

    for relative_path, (file_id, parsed) in all_parsed.items():
        lang = rel_path_lang[relative_path]
        for imp in parsed["imports"]:
            module = imp["module"]
            names = imp["names"]       # non-empty only for "from X import Y, Z"
            kind = imp["kind"]

            if lang == "java":
                raw_text = imp["raw"]
                local_targets = resolve_java_import(module, names)
                if local_targets:
                    for target_rel in local_targets:
                        linked = False
                        for name in names:
                            if name == "*":
                                continue
                            entity_id = local_entity.get((target_rel, name))
                            if entity_id:
                                graph["edges"].append(create_edge(file_id, entity_id, "imports", raw=raw_text))
                                linked = True
                        if not linked:
                            graph["edges"].append(create_edge(file_id, f"file:{target_rel}", "imports", raw=raw_text))
                else:
                    # External (JDK or third-party) import
                    if names == ["*"] or not names:
                        mod_id = ensure_import_module(module)
                        graph["edges"].append(create_edge(file_id, mod_id, "imports", raw=raw_text))
                    else:
                        for name in names:
                            entity_id = ensure_import_entity(module, name)
                            graph["edges"].append(create_edge(file_id, entity_id, "imports", raw=raw_text))
                continue

            if kind == "from" and names:
                # Try to resolve each imported name to a local entity
                target_rel = resolve_module(module, relative_path)
                if target_rel is not None:
                    target_file_id = f"file:{target_rel}"
                    raw_text = imp["raw"]
                    # Module is local — try to link to specific named entities
                    resolved_any = False
                    for name in names:
                        if name == "*":
                            graph["edges"].append(create_edge(file_id, target_file_id, "imports", raw=raw_text))
                            resolved_any = True
                        else:
                            entity_id = local_entity.get((target_rel, name))
                            if entity_id:
                                graph["edges"].append(create_edge(file_id, entity_id, "imports", raw=raw_text))
                                resolved_any = True
                    if not resolved_any:
                        graph["edges"].append(create_edge(file_id, target_file_id, "imports", raw=raw_text))
                    continue  # handled — no import node needed

            elif kind == "import":
                # "import module" — check if the whole module is local
                target_rel = resolve_module(module, relative_path)
                if target_rel is not None:
                    graph["edges"].append(create_edge(file_id, f"file:{target_rel}", "imports", raw=imp["raw"]))
                    continue  # handled — no import node needed

            # Not resolved locally → external dependency
            raw_text = imp["raw"]
            if kind == "import":
                # import A  →  file links directly to the module node
                mod_id = ensure_import_module(module)
                graph["edges"].append(create_edge(file_id, mod_id, "imports", raw=raw_text))
            else:
                # from A import B, C  →  file links to each entity node
                if names == ["*"]:
                    # wildcard: link to the module itself
                    mod_id = ensure_import_module(module)
                    graph["edges"].append(create_edge(file_id, mod_id, "imports", raw=raw_text))
                else:
                    for name in names:
                        entity_id = ensure_import_entity(module, name)
                        graph["edges"].append(create_edge(file_id, entity_id, "imports", raw=raw_text))

    # --- Third pass: calls ---
    emit_progress(PARSE_END + 5, "Resolving call relationships")
    # Build a cross-file lookup: entity_name → [node_id, ...]
    callee_lookup: dict[str, list[str]] = {}
    for (rel_path, entity_name), entity_id in local_entity.items():
        callee_lookup.setdefault(entity_name, []).append(entity_id)

    known_node_ids = {n["id"] for n in graph["nodes"]}
    emitted_calls = set()

    for relative_path, (file_id, parsed) in all_parsed.items():
        for call in parsed["calls"]:
            if call["caller_type"] == "function":
                caller_id = f"function:{relative_path}:{call['caller_name']}"
            else:
                parts = call["caller_name"].split(".", 1)
                if len(parts) == 2:
                    caller_id = f"method:{relative_path}:{parts[0]}.{parts[1]}"
                else:
                    caller_id = f"function:{relative_path}:{call['caller_name']}"

            if caller_id not in known_node_ids:
                continue

            callee_name = call["callee_name"]
            callee_id = None

            # 1a. Same-class method match (handles self.method() after self. is stripped)
            if call["caller_type"] == "method":
                caller_name_parts = call["caller_name"].split(".", 1)
                if len(caller_name_parts) == 2:
                    same_class_potential = f"method:{relative_path}:{caller_name_parts[0]}.{callee_name}"
                    if same_class_potential in known_node_ids and same_class_potential != caller_id:
                        callee_id = same_class_potential

            # 1b. Same-file function or class match
            if not callee_id:
                same_file = local_entity.get((relative_path, callee_name))
                if same_file:
                    callee_id = same_file

            if not callee_id and "." in callee_name:
                # Could be ClassName.method_name in the same file
                cls_part, meth_part = callee_name.split(".", 1)
                potential = f"method:{relative_path}:{cls_part}.{meth_part}"
                if potential in known_node_ids:
                    callee_id = potential
                else:
                    # Cross-file unique match
                    matches = callee_lookup.get(callee_name, [])
                    if len(matches) == 1:
                        callee_id = matches[0]
            elif not callee_id:
                # Cross-file unique match
                matches = callee_lookup.get(callee_name, [])
                if len(matches) == 1 and matches[0] != caller_id:
                    callee_id = matches[0]

            if not callee_id or callee_id not in known_node_ids:
                continue
            if callee_id == caller_id:
                continue

            call_key = f"{caller_id}::{callee_id}"
            if call_key in emitted_calls:
                continue
            emitted_calls.add(call_key)

            graph["edges"].append(create_edge(caller_id, callee_id, "calls"))

    # --- Folder aggregation: derive directory container nodes from file paths ---
    _add_folder_aggregation(graph)

    # --- Optional semantic clustering pass ---
    if args.cluster:
        _enrich_with_clusters(graph, all_parsed, PROJECT_PATH, args)

    graph["metadata"] = {"languages": lang_counts}

    emit_progress(96, "Writing graph.json")
    output_dir = os.path.dirname(OUTPUT_PATH)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=4)

    print()
    print("Analysis Complete")
    print(f"Nodes: {len(graph['nodes'])}")
    print(f"Edges: {len(graph['edges'])}")
    print()
    print(f"Saved: {OUTPUT_PATH}")
    emit_progress(100, "Analysis complete")


def _add_folder_aggregation(graph: dict) -> None:
    """Derive directory container nodes from file node paths.

    File nodes normally sit at the top level. This builds the directory tree from
    each file's relative path and appends `folder` nodes plus `contains` edges
    (folder -> subfolder and folder -> file), so the frontend can present a large
    codebase as a navigable, collapsible overview. Files at the project root keep
    no folder parent and stay top-level. Pure post-processing — no parsing.

    Each folder node carries `file_count` (number of descendant files) so the UI
    can label collapsed folders and size minimap blocks.
    """
    file_nodes = [n for n in graph["nodes"] if n["type"] == "file"]
    if not file_nodes:
        return

    def folder_id(path):
        return f"folder:{path}"

    folder_seen = set()          # folder path -> created
    file_counts = {}             # folder path -> descendant file count
    new_nodes = []
    new_edges = []

    for fnode in file_nodes:
        # File node "name" is the relative path; normalise separators for stable ids.
        rel = fnode["name"].replace("\\", "/")
        dirs = rel.split("/")[:-1]   # drop the filename
        if not dirs:
            continue                 # root-level file — no folder parent

        parent_path = None
        cumulative = []
        for d in dirs:
            cumulative.append(d)
            path = "/".join(cumulative)
            file_counts[path] = file_counts.get(path, 0) + 1
            if path not in folder_seen:
                folder_seen.add(path)
                new_nodes.append({
                    "id": folder_id(path),
                    "name": d,          # basename for display
                    "type": "folder",
                    "path": path,
                })
                if parent_path is not None:
                    new_edges.append(create_edge(folder_id(parent_path), folder_id(path), "contains"))
            parent_path = path

        # Link the deepest folder to the file itself.
        new_edges.append(create_edge(folder_id(parent_path), fnode["id"], "contains"))

    for node in new_nodes:
        node["file_count"] = file_counts.get(node["path"], 0)

    graph["nodes"].extend(new_nodes)
    graph["edges"].extend(new_edges)


def _enrich_with_clusters(graph: dict, all_parsed: dict, project_path: str, args) -> None:
    """
    Run the semantic clustering pipeline and add cluster nodes + belongs_to edges
    to the graph in-place.
    """
    # Imported lazily so the heavy ML dependencies (torch, transformers, umap,
    # hdbscan) are only required when --cluster is actually requested.
    from semantic.extractor import extract_entities, build_method_assignments
    from semantic.embedder import CodeBERTEmbedder
    from semantic.clusterer import run_pipeline
    from semantic.labeller import label_clusters

    print()
    print("Running semantic clustering pipeline ...")

    # Build parsed_files dict expected by extractor
    parsed_files = {rel: (file_id, parsed) for rel, (file_id, parsed) in all_parsed.items()}

    emit_progress(46, "Extracting entities for clustering")
    records = extract_entities(parsed_files, project_path)
    if len(records) < 2:
        print("[cluster] Too few entities to cluster — skipping.")
        return

    emit_progress(52, "Embedding code with CodeBERT")
    embedder = CodeBERTEmbedder()
    embeddings = embedder.embed([r["text"] for r in records])

    emit_progress(72, "Clustering entities (UMAP + HDBSCAN)")
    result = run_pipeline(embeddings, records, min_cluster_size=args.min_cluster_size)
    labels       = result["labels"]
    coords_2d    = result["coords_2d"]
    centroids_2d = result["cluster_centroids_2d"]

    if args.no_labels:
        cluster_info: dict[int, dict] = {-1: {"label": "Uncategorised", "description": ""}}
        for i, rec in enumerate(records):
            cid = int(labels[i])
            if cid not in cluster_info:
                cluster_info[cid] = {"label": rec["name"], "description": ""}
    else:
        print("[cluster] Calling Claude API to generate domain labels ...")
        emit_progress(85, "Labelling clusters with Claude")
        cluster_info = label_clusters(labels, records, api_key=args.api_key)

    # Add cluster nodes
    for cid, info in cluster_info.items():
        if cid == -1:
            continue
        cx, cy = centroids_2d.get(cid, (0.0, 0.0))
        graph["nodes"].append({
            "id":          f"cluster:{cid}",
            "name":        info["label"],
            "type":        "cluster",
            "description": info.get("description", ""),
            "centroid_x":  round(cx, 4),
            "centroid_y":  round(cy, 4),
        })

    # Add belongs_to edges for classes and functions
    known_ids = {n["id"] for n in graph["nodes"]}
    for i, rec in enumerate(records):
        cid = int(labels[i])
        if cid == -1:
            continue
        cluster_node_id = f"cluster:{cid}"
        if rec["id"] in known_ids and cluster_node_id in known_ids:
            graph["edges"].append(create_edge(rec["id"], cluster_node_id, "belongs_to"))

    # Add belongs_to edges for methods (inherit parent class cluster)
    class_cluster_map = {
        records[i]["id"]: int(labels[i])
        for i in range(len(records))
        if records[i]["type"] == "class"
    }
    cluster_names_compat = {cid: info["label"] for cid, info in cluster_info.items()}
    method_results = build_method_assignments(parsed_files, class_cluster_map, cluster_names_compat)
    for m in method_results:
        cid = m["cluster"]
        if cid == -1:
            continue
        cluster_node_id = f"cluster:{cid}"
        if m["id"] in known_ids and cluster_node_id in known_ids:
            graph["edges"].append(create_edge(m["id"], cluster_node_id, "belongs_to"))

    # Attach 2D UMAP coords to entity nodes for frontend layout hints
    id_to_coords = {records[i]["id"]: coords_2d[i] for i in range(len(records))}
    for node in graph["nodes"]:
        if node["id"] in id_to_coords:
            node["umap_x"] = round(float(id_to_coords[node["id"]][0]), 4)
            node["umap_y"] = round(float(id_to_coords[node["id"]][1]), 4)

    n_clusters = len([c for c in cluster_info if c != -1])
    print(f"[cluster] Added {n_clusters} cluster nodes and belongs_to edges to graph.")

if __name__ == "__main__":
    main()
