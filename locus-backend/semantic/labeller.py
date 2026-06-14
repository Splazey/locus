"""
labeller.py

Uses the Claude API (claude-haiku-4-5) to generate human-readable domain labels
and descriptions for every HDBSCAN cluster in a single batched API call.

Design choices
--------------
- One call for all clusters: eliminates per-call static overhead and HTTP latency.
- Names only (no docstrings): entity names already encode domain intent clearly.
  Docstrings were used upstream by CodeBERT to *form* the clusters; the labeller
  only needs to *name* a group it receives, and names are the strongest signal.
- Short system prompt: minimal framing, all tokens go to entity content.

Token budget (typical 8-cluster project, names only)
    Input  : ~110 overhead + ~1,200 entity names + ~30 group markers = ~1,340
    Output : ~360 (8 × ~45 token JSON objects)
    Cost   : ~$0.002 per project analysis at claude-haiku-4-5 rates

Noise cluster (-1) gets a static label with no API call.
"""

from __future__ import annotations

import json as _json
import os
import re

import anthropic

_MODEL              = "claude-haiku-4-5-20251001"
_MAX_NAMES          = 30    # max entity names sent per cluster
_MAX_OUTPUT_TOKENS  = 100   # per cluster in the batch; total ceiling = N * 100


def _build_batch_prompt(groups: dict[int, list[str]]) -> str:
    """
    Build a single prompt listing every cluster as a numbered group.
    groups: { cluster_id: [entity_name, ...] }
    """
    sorted_ids = sorted(groups)
    lines = [
        "You are a software architect analysing a codebase for a developer who is new to it.",
        "Below are groups of related code entity names (classes and functions).",
        "For each group infer the single domain responsibility it covers.",
        "Reply with ONLY a JSON array — one object per group, in the same order:",
        '[{"id": <group_id>, "label": "Short Title", "description": "1-2 sentences."}, ...]',
        "",
    ]
    for cid in sorted_ids:
        names = groups[cid][:_MAX_NAMES]
        lines.append(f"Group {cid}:")
        lines.extend(f"- {name}" for name in names)
        lines.append("")
    return "\n".join(lines)


def label_clusters(
    labels_array,           # np.ndarray of cluster IDs per entity
    records: list[dict],    # entity records (same order as labels_array)
    api_key: str | None = None,
) -> dict[int, dict]:
    """
    Generate a label and description for every cluster in a single API call.

    Parameters
    ----------
    labels_array : cluster ID per entity (-1 = noise)
    records      : entity dicts (must include 'name')
    api_key      : Anthropic API key; falls back to ANTHROPIC_API_KEY env var

    Returns
    -------
    { cluster_id: {"label": str, "description": str} }
    """
    # Group entity names by cluster (names only — no docstrings)
    groups: dict[int, list[str]] = {}
    for rec, cid in zip(records, labels_array):
        groups.setdefault(int(cid), []).append(rec["name"])

    results: dict[int, dict] = {
        -1: {
            "label":       "Uncategorised",
            "description": "Entities that did not fit clearly into any domain cluster.",
        }
    }

    cluster_ids = sorted(cid for cid in groups if cid != -1)
    if not cluster_ids:
        return results

    prompt = _build_batch_prompt({cid: groups[cid] for cid in cluster_ids})
    n = len(cluster_ids)
    print(f"[labeller] Labelling {n} cluster(s) in one API call ...")

    try:
        client = anthropic.Anthropic(api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"))
        response = client.messages.create(
            model=_MODEL,
            max_tokens=n * _MAX_OUTPUT_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()

        # Strip markdown code fences if the model wraps the JSON
        raw = re.sub(r"^```[a-z]*\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

        parsed = _json.loads(raw)
        for item in parsed:
            cid = int(item["id"])
            results[cid] = {
                "label":       item.get("label", f"Cluster {cid}"),
                "description": item.get("description", ""),
            }

    except Exception as exc:
        print(f"[labeller] Warning: batch labelling failed ({exc}); using fallback names.")
        for cid in cluster_ids:
            if cid not in results:
                # Fallback: use the most representative name (first entry)
                results[cid] = {
                    "label":       groups[cid][0] if groups[cid] else f"Cluster {cid}",
                    "description": "",
                }

    # Fill in any cluster IDs the model may have omitted
    for cid in cluster_ids:
        if cid not in results:
            results[cid] = {
                "label":       groups[cid][0] if groups[cid] else f"Cluster {cid}",
                "description": "",
            }

    return results
