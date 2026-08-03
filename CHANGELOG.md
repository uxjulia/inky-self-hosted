# Changelog

## [Unreleased]

### Added

- Self-hosted companion app for CrossInk devices with OPDS, WebDAV, RSS/Atom, local uploads, and local library browsing.
- React/Vite frontend, FastAPI backend, SQLite storage, and Docker Compose or direct-host deployment.
- EPUB optimization pipeline for X3/X4 screen targets before sending to a device.
- File sending to CrossInk devices on the same local network through `File Transfer > Join a Network` or `File Transfer > Create Hotspot`
- Basic Auth support for self-hosted installs.
- In-app help page covering sources, local library, device setup, and send behavior.
- Help content explaining CrossInk-specific EPUB enhancements such as stable locations and reference pages.
- EPUB optimizer setting for customizing how many words count as one generated reference page.

### Changed

- EPUB optimization now tree-shakes unused CSS rules and removes unreachable stylesheet files.
- EPUB optimization now rasterizes SVG image resources to JPEG so CrossInk can display more dividers and artwork.
