"""
cluster.py — Semantic Clustering CLI

Given a project directory (Python, JavaScript, or Java — auto-detected),
runs the full semantic clustering pipeline:
    1. Parse all supported source files with the matching language parser
    2. Extract text representations for class and function entities
       (class text includes child method text for richer embeddings)
    3. Encode with CodeBERT -> 768-dim embeddings
    4. UMAP (10-D) + HDBSCAN -> automatic domain cluster detection
    5. Merge micro-clusters for onboarding-friendly granularity
    6. UMAP (2-D) -> spatial layout coordinates
    7. Claude API -> human-readable domain label + description per cluster
    8. Assign each method to its parent class's cluster
    9. Print results; optionally save to JSON

Usage:
    python cluster.py path/to/project
    python cluster.py path/to/project --output results.json
    python cluster.py path/to/project --min-cluster-size 6
    python cluster.py path/to/project --no-labels      # skip Claude API call
"""

import os
import sys
import json
import argparse

from analyze import find_source_files, get_parser
from semantic.extractor import extract_entities, build_method_assignments
from semantic.embedder import CodeBERTEmbedder
from semantic.clusterer import run_pipeline
from semantic.labeller import label_clusters


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Semantic clustering of a codebase (Python/JavaScript/Java) via CodeBERT + HDBSCAN."
    )
    ap.add_argument("project_path", help="Path to the project directory.")
    ap.add_argument("--output", default=None, help="Optional path to save results as JSON.")
    ap.add_argument(
        "--min-cluster-size",
        type=int,
        default=None,
        help="Minimum entities per cluster (default: max(4, n_entities // 20)).",
    )
    ap.add_argument(
        "--no-labels",
        action="store_true",
        help="Skip the Claude API labelling step (uses centroid entity name instead).",
    )
    ap.add_argument(
        "--api-key",
        default=None,
        help="Anthropic API key (default: ANTHROPIC_API_KEY env var).",
    )
    args = ap.parse_args()

    project_path = args.project_path
    if not os.path.isdir(project_path):
        print(f"Error: '{project_path}' is not a directory.", file=sys.stderr)
        sys.exit(1)

    # -- 1. Parse ------------------------------------------------------------
    print(f"\nParsing source files in: {project_path}")
    source_files = find_source_files(project_path)
    if not source_files:
        print("No supported source files found.")
        sys.exit(0)
    print(f"Found {len(source_files)} file(s).")

    parsers = {lang: get_parser(lang) for lang in {lang for _, lang in source_files}}
    parsed_files: dict[str, tuple[str, dict]] = {}
    for filepath, lang in source_files:
        rel = os.path.relpath(filepath, project_path)
        parsed_files[rel] = (f"file:{rel}", parsers[lang].parse_file(filepath))

    # -- 2. Extract entity records (class + function only) -------------------
    print("\nExtracting entity text representations ...")
    records = extract_entities(parsed_files, project_path)
    print(f"Entities to cluster: {len(records)}  (classes and module-level functions)")

    if len(records) < 2:
        print("Need at least 2 entities to cluster. Exiting.")
        sys.exit(0)

    # -- 3. Embed with CodeBERT ----------------------------------------------
    print()
    embedder = CodeBERTEmbedder()
    embeddings = embedder.embed([r["text"] for r in records])
    print(f"[embedder] Embeddings shape: {embeddings.shape}")

    # -- 4-6. UMAP + HDBSCAN + 2D coords ------------------------------------
    print()
    result = run_pipeline(embeddings, records, min_cluster_size=args.min_cluster_size)
    labels        = result["labels"]
    coords_2d     = result["coords_2d"]
    centroids_2d  = result["cluster_centroids_2d"]

    # -- 7. LLM cluster labelling -------------------------------------------
    print()
    if args.no_labels:
        # Fallback: centroid-representative entity name, no description
        cluster_info: dict[int, dict] = {-1: {"label": "Uncategorised", "description": ""}}
        for i, rec in enumerate(records):
            cid = int(labels[i])
            if cid not in cluster_info:
                cluster_info[cid] = {"label": rec["name"], "description": ""}
    else:
        print("[labeller] Calling Claude API to generate domain labels ...")
        cluster_info = label_clusters(labels, records, api_key=args.api_key)

    # -- 8. Assign methods to parent class cluster ---------------------------
    class_cluster_map = {
        records[i]["id"]: int(labels[i])
        for i in range(len(records))
        if records[i]["type"] == "class"
    }
    # Build a cluster_names dict compatible with build_method_assignments
    cluster_names_compat = {cid: info["label"] for cid, info in cluster_info.items()}
    method_results = build_method_assignments(parsed_files, class_cluster_map, cluster_names_compat)

    # -- 9. Display results --------------------------------------------------
    print("\n" + "=" * 70)
    print("CLUSTERING RESULTS")
    print("=" * 70)

    # Group by cluster
    clusters: dict[int, list[dict]] = {}
    for i, rec in enumerate(records):
        clusters.setdefault(int(labels[i]), []).append(rec)

    method_by_cluster: dict[int, list[dict]] = {}
    for m in method_results:
        method_by_cluster.setdefault(m["cluster"], []).append(m)

    def _print_cluster(cid: int, members: list[dict]) -> None:
        info = cluster_info.get(cid, {"label": f"Cluster {cid}", "description": ""})
        header = f"[Uncategorised]" if cid == -1 else f"Cluster {cid}: \"{info['label']}\""
        print(f"\n{header}  ({len(members)} entities)")
        if info.get("description"):
            print(f"  {info['description']}")
        for rec in members:
            print(f"    [{rec['type']:8s}] {rec['name']}")
        for m in method_by_cluster.get(cid, []):
            print(f"      [method  ] {m['name']}")

    if -1 in clusters:
        _print_cluster(-1, clusters[-1])

    for cid in sorted((c for c in clusters if c != -1), key=lambda c: -len(clusters[c])):
        _print_cluster(cid, clusters[cid])

    print("\n" + "=" * 70)
    n_clusters = len([c for c in clusters if c != -1])
    n_noise    = int((labels == -1).sum())
    print(f"Total clustered entities : {len(records)}")
    print(f"Clusters found           : {n_clusters}")
    print(f"Noise points             : {n_noise}")
    print(f"Methods assigned         : {len(method_results)}")
    print("=" * 70)

    # -- 10. Optional JSON output --------------------------------------------
    if args.output:
        entity_results = [
            {
                "id":           records[i]["id"],
                "name":         records[i]["name"],
                "type":         records[i]["type"],
                "file":         records[i]["file"],
                "cluster":      int(labels[i]),
                "cluster_label": cluster_info.get(int(labels[i]), {}).get("label", "noise"),
                "umap_x":       float(coords_2d[i][0]),
                "umap_y":       float(coords_2d[i][1]),
            }
            for i in range(len(records))
        ] + method_results

        output_data = {
            "project":    project_path,
            "n_clusters": n_clusters,
            "n_noise":    n_noise,
            "clusters": {
                str(cid): {
                    **cluster_info.get(cid, {"label": f"Cluster {cid}", "description": ""}),
                    "centroid_x": centroids_2d.get(cid, (0.0, 0.0))[0],
                    "centroid_y": centroids_2d.get(cid, (0.0, 0.0))[1],
                }
                for cid in sorted(clusters)
                if cid != -1
            },
            "entities": entity_results,
        }
        out_dir = os.path.dirname(args.output)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(output_data, f, indent=2)
        print(f"\nResults saved to: {args.output}")


if __name__ == "__main__":
    main()
