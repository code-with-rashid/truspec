/**
 * The JSONPath subset, as a standalone browser-safe entry point.
 *
 * `@truspec/core/runner` also exports it, but that barrel pulls in the assertion engine and the
 * OpenAPI reader — far more than a UI needs to evaluate a path against a response body, and more
 * than a browser bundle should carry. This module has no imports at all.
 */
export { jsonpath } from "../runner/jsonpath";
