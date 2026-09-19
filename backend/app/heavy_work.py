"""Shared concurrency boundary for temporary, memory-intensive server work."""

from __future__ import annotations

import threading


# A public instance cannot safely run an EPUB conversion and archive extraction
# at the same time. Keep the process-wide limit explicit.
HEAVY_WORK_LOCK = threading.BoundedSemaphore(1)
WAITING_FOR_HEAVY_WORK_MESSAGE = "Waiting for another conversion to finish"
