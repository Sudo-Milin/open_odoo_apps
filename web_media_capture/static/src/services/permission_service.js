/** @odoo-module **/

import { registry } from "@web/core/registry";

/**
 * PermissionService — Detects and manages browser permissions for
 * camera and microphone access.
 *
 * Provides a clean API that widgets use to decide whether to show the
 * camera UI, a permission prompt, or a file-upload fallback.
 */
const permissionService = {
    dependencies: [],

    start(env) {
        /** @type {Object<string, string>} */
        const _cache = {};

        // ----------------------------------------------------------------
        // Helpers
        // ----------------------------------------------------------------

        /**
         * Query a permission using the Permissions API (where supported).
         * @param {string} name — "camera" or "microphone"
         * @returns {Promise<string>} — "granted"|"prompt"|"denied"|"unavailable"
         */
        async function _queryPermission(name) {
            // No MediaDevices at all (e.g. HTTP context)
            if (!navigator.mediaDevices?.getUserMedia) {
                return "unavailable";
            }

            // Try the Permissions API first
            if (navigator.permissions?.query) {
                try {
                    const status = await navigator.permissions.query({ name });
                    return status.state; // "granted" | "prompt" | "denied"
                } catch {
                    // Some browsers don't support querying "camera"
                    // Fall through to probe method
                }
            }

            // Probe: try getUserMedia briefly then stop
            try {
                const constraints =
                    name === "camera" ? { video: true } : { audio: true };
                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                stream.getTracks().forEach((t) => t.stop());
                return "granted";
            } catch (err) {
                if (
                    err.name === "NotAllowedError" ||
                    err.name === "PermissionDeniedError"
                ) {
                    return "denied";
                }
                if (
                    err.name === "NotFoundError" ||
                    err.name === "DevicesNotFoundError"
                ) {
                    return "unavailable";
                }
                return "unavailable";
            }
        }

        // ----------------------------------------------------------------
        // Public API
        // ----------------------------------------------------------------

        /**
         * Check camera permission status without triggering a prompt.
         * Results are cached for the session.
         * @returns {Promise<"granted"|"prompt"|"denied"|"unavailable">}
         */
        async function checkCamera() {
            if (!_cache.camera) {
                _cache.camera = await _queryPermission("camera");
            }
            return _cache.camera;
        }

        /**
         * Check microphone permission status.
         * @returns {Promise<"granted"|"prompt"|"denied"|"unavailable">}
         */
        async function checkMicrophone() {
            if (!_cache.microphone) {
                _cache.microphone = await _queryPermission("microphone");
            }
            return _cache.microphone;
        }

        /**
         * Request camera permission (triggers browser prompt).
         * Clears cache and re-checks.
         * @returns {Promise<"granted"|"denied"|"unavailable">}
         */
        async function requestCamera() {
            delete _cache.camera;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                stream.getTracks().forEach((t) => t.stop());
                _cache.camera = "granted";
                return "granted";
            } catch (err) {
                if (
                    err.name === "NotAllowedError" ||
                    err.name === "PermissionDeniedError"
                ) {
                    _cache.camera = "denied";
                    return "denied";
                }
                _cache.camera = "unavailable";
                return "unavailable";
            }
        }

        /**
         * Check if we're in a secure context (HTTPS or localhost).
         * getUserMedia requires a secure context.
         * @returns {boolean}
         */
        function isSecureContext() {
            return window.isSecureContext === true;
        }

        /**
         * Reset the permission cache (e.g. after user changes settings).
         */
        function clearCache() {
            delete _cache.camera;
            delete _cache.microphone;
        }

        return {
            checkCamera,
            checkMicrophone,
            requestCamera,
            isSecureContext,
            clearCache,
        };
    },
};

registry.category("services").add("media_capture.permission", permissionService);
