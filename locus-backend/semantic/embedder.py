"""
embedder.py

Generates CodeBERT embeddings for a list of EntityRecords.

We use microsoft/codebert-base (a RoBERTa model pre-trained on code+NL pairs).
The [CLS] token's hidden state from the last layer is used as the embedding
vector (dimension 768), which captures semantic meaning of the code entity.
"""

from __future__ import annotations

import numpy as np
import torch
from transformers import AutoTokenizer, AutoModel

_MODEL_NAME = "microsoft/codebert-base"
_MAX_TOKENS = 512
_BATCH_SIZE = 16


class CodeBERTEmbedder:

    def __init__(self, device: str | None = None) -> None:
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        print(f"[embedder] Loading {_MODEL_NAME} on {self.device} ...")
        self.tokenizer = AutoTokenizer.from_pretrained(_MODEL_NAME)
        self.model = AutoModel.from_pretrained(_MODEL_NAME).to(self.device)
        self.model.eval()
        print("[embedder] Model ready.")

    def embed(self, texts: list[str]) -> np.ndarray:
        """
        Encode a list of text strings.
        Returns float32 array of shape (len(texts), 768).
        """
        all_embeddings: list[np.ndarray] = []

        for batch_start in range(0, len(texts), _BATCH_SIZE):
            batch = texts[batch_start : batch_start + _BATCH_SIZE]

            encoded = self.tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=_MAX_TOKENS,
                return_tensors="pt",
            ).to(self.device)

            with torch.no_grad():
                output = self.model(**encoded)

            # CLS token embedding (first token of last hidden state)
            cls_embeddings = output.last_hidden_state[:, 0, :]
            all_embeddings.append(cls_embeddings.cpu().numpy())

        return np.vstack(all_embeddings).astype(np.float32)
