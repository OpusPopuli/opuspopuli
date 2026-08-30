/**
 * @opuspopuli/common
 *
 * Shared types, interfaces, and utilities for the Opus Populi platform.
 * This package provides the core abstractions that allow pluggable
 * provider implementations.
 */

// Provider interfaces and types
export * from "./providers/index.js";

// Utilities
export * from "./utils/index.js";

// Shared constants (single source of truth — see commitments.ts)
export * from "./commitments.js";

// Shared embedding width — see the file for why this cannot live per-service.
export * from "./embeddings-dimensions.js";
