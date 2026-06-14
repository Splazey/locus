"""
clusterer.py

Dimensionality reduction + HDBSCAN clustering on CodeBERT embeddings.

Pipeline:
    1. UMAP (10-D)  — reduces 768-dim embeddings so HDBSCAN works effectively.
    2. HDBSCAN      — density-based clustering; auto cluster count; noise = -1.
    3. Merge pass   — micro-clusters below min_size absorbed into nearest neighbour.
    4. UMAP (2-D)   — second pass for spatial layout coordinates stored on output.
"""

from __future__ import annotations

import numpy as np
import hdbscan
import umap


_UMAP_N_COMPONENTS   = 10
_UMAP_N_NEIGHBORS    = 15
_UMAP_MIN_DIST       = 0.0

_HDBSCAN_MIN_SAMPLES = 1


def _make_umap(n_components: int, n_neighbors: int, n_total: int) -> umap.UMAP:
    # Spectral initialisation requires solving an eigenproblem on the k-NN graph.
    # It fails when n_neighbors is close to n (graph becomes nearly fully connected).
    # Use random init for small datasets to avoid this entirely.
    init = "random" if n_total < 50 else "spectral"
    return umap.UMAP(
        n_components=n_components,
        n_neighbors=n_neighbors,
        min_dist=_UMAP_MIN_DIST,
        metric="cosine",
        init=init,
        random_state=42,
    )


def reduce_dimensions(embeddings: np.ndarray, n_components: int = _UMAP_N_COMPONENTS) -> np.ndarray:
    """UMAP dimensionality reduction for clustering (high-dim output)."""
    n = len(embeddings)
    n_components = min(n_components, n - 2)   # must be strictly < n - 1 for spectral safety
    n_neighbors  = min(_UMAP_N_NEIGHBORS, n - 1)
    return _make_umap(n_components, n_neighbors, n).fit_transform(embeddings)


def reduce_2d(embeddings: np.ndarray) -> np.ndarray:
    """Second UMAP pass to 2 components for spatial layout coordinates."""
    n = len(embeddings)
    n_neighbors = min(_UMAP_N_NEIGHBORS, n - 1)
    return _make_umap(min(2, n - 2), n_neighbors, n).fit_transform(embeddings)


def _run_hdbscan(reduced: np.ndarray, min_cluster_size: int) -> np.ndarray:
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=_HDBSCAN_MIN_SAMPLES,
        metric="euclidean",
        cluster_selection_method="eom",
    )
    clusterer.fit(reduced)
    return clusterer.labels_


def _merge_small_clusters(
    labels: np.ndarray,
    reduced: np.ndarray,
    min_size: int,
) -> np.ndarray:
    """
    Iteratively absorb clusters smaller than min_size into their nearest
    large cluster (by centroid distance in UMAP space).
    Noise points (label -1) are never absorbed and never act as targets.
    """
    labels = labels.copy()

    for _ in range(50):  # max iterations to avoid infinite loop
        counts = {}
        for lbl in labels:
            if lbl != -1:
                counts[lbl] = counts.get(lbl, 0) + 1

        large = {lbl for lbl, cnt in counts.items() if cnt >= min_size}
        small = {lbl for lbl, cnt in counts.items() if cnt < min_size}

        if not small:
            break

        # Compute centroids of large clusters
        large_centroids = {
            lbl: reduced[labels == lbl].mean(axis=0)
            for lbl in large
        }

        for micro_lbl in small:
            if not large_centroids:
                # No large clusters to absorb into — leave as noise
                labels[labels == micro_lbl] = -1
                continue
            micro_centroid = reduced[labels == micro_lbl].mean(axis=0)
            nearest = min(
                large_centroids,
                key=lambda lbl: np.linalg.norm(large_centroids[lbl] - micro_centroid),
            )
            labels[labels == micro_lbl] = nearest

    return labels


def _remap_labels(labels: np.ndarray) -> np.ndarray:
    """Re-index cluster IDs to be contiguous starting from 0 (noise stays -1)."""
    mapping: dict[int, int] = {}
    next_id = 0
    out = labels.copy()
    for i, lbl in enumerate(labels):
        if lbl == -1:
            continue
        if lbl not in mapping:
            mapping[lbl] = next_id
            next_id += 1
        out[i] = mapping[lbl]
    return out


def cluster_embeddings(
    reduced: np.ndarray,
    min_cluster_size: int,
) -> np.ndarray:
    """Run HDBSCAN then merge micro-clusters, return remapped labels."""
    labels = _run_hdbscan(reduced, min_cluster_size)
    labels = _merge_small_clusters(labels, reduced, min_cluster_size)
    return _remap_labels(labels)


def compute_cluster_centroids_2d(
    labels: np.ndarray,
    coords_2d: np.ndarray,
) -> dict[int, tuple[float, float]]:
    """Return the 2D centroid for each cluster (excluding noise)."""
    centroids: dict[int, tuple[float, float]] = {}
    for cid in set(labels) - {-1}:
        pts = coords_2d[labels == cid]
        cx, cy = pts.mean(axis=0)
        centroids[cid] = (float(cx), float(cy))
    return centroids


def run_pipeline(
    embeddings: np.ndarray,
    records: list[dict],
    min_cluster_size: int | None = None,
) -> dict:
    """
    Full pipeline: UMAP (10-D) -> HDBSCAN -> merge -> UMAP (2-D).

    Parameters
    ----------
    embeddings        : CodeBERT embedding matrix (n, 768)
    records           : entity record list (same order as embeddings)
    min_cluster_size  : minimum members per cluster; defaults to
                        max(4, n_entities // 20) for onboarding-friendly granularity

    Returns
    -------
    dict with keys:
        reduced          : np.ndarray (n, 10)   — used for clustering
        coords_2d        : np.ndarray (n, 2)    — spatial layout hints
        labels           : np.ndarray (n,)      — cluster IDs, -1 = noise
        cluster_centroids_2d : dict[int, (x, y)]
    """
    n = len(records)
    if min_cluster_size is None:
        min_cluster_size = max(4, n // 20)

    print(f"[clusterer] Running UMAP ({embeddings.shape[1]}D -> {_UMAP_N_COMPONENTS}D) ...")
    reduced = reduce_dimensions(embeddings)

    print(f"[clusterer] Running HDBSCAN (min_cluster_size={min_cluster_size}) ...")
    labels = cluster_embeddings(reduced, min_cluster_size)

    n_clusters = len(set(labels) - {-1})
    n_noise    = int((labels == -1).sum())
    print(f"[clusterer] Found {n_clusters} clusters, {n_noise} noise points.")

    print("[clusterer] Computing 2D layout coordinates ...")
    coords_2d = reduce_2d(embeddings)
    centroids_2d = compute_cluster_centroids_2d(labels, coords_2d)

    return {
        "reduced":              reduced,
        "coords_2d":            coords_2d,
        "labels":               labels,
        "cluster_centroids_2d": centroids_2d,
    }
