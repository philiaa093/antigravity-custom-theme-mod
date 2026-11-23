#!/usr/bin/env python3
"""Mirror launcher for theme_from_image.py."""

from __future__ import annotations

import sys
from pathlib import Path

# Add repository root to sys.path so theme_from_image can be imported cleanly
repo_root = Path(__file__).resolve().parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from theme_from_image import main

if __name__ == "__main__":
    raise SystemExit(main())
