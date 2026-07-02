/** @odoo-module **/

import { registry } from "@web/core/registry";

/**
 * UploadService — Handles uploading captured media blobs to Odoo.
 *
 * For small files (< 5 MB): uses ORM call to create ir.attachment with
 * base64 data. For larger files: uses the /web_media_capture/upload
 * HTTP endpoint (multipart form).
 */
const uploadService = {
    dependencies: ["orm", "notification"],

    start(env, { orm, notification }) {
        const SMALL_FILE_THRESHOLD = 5 * 1024 * 1024; // 5 MB
        const MAX_RETRIES = 3;
        const RETRY_BASE_DELAY = 1000; // ms

        // ----------------------------------------------------------------
        // Helpers
        // ----------------------------------------------------------------

        /**
         * Convert a Blob to a base64 string (without the data URI prefix).
         * @param {Blob} blob
         * @returns {Promise<string>}
         */
        function _blobToBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    // Strip "data:...;base64," prefix
                    const base64 = reader.result.split(",")[1];
                    resolve(base64);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        /**
         * Generate a filename from MIME type and timestamp.
         * @param {string} mimetype
         * @returns {string}
         */
        function _generateFilename(mimetype) {
            const now = new Date();
            const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
            const ext = mimetype.includes("video") ? _videoExtension(mimetype) : _imageExtension(mimetype);
            const prefix = mimetype.includes("video") ? "VID" : "IMG";
            return `${prefix}_${ts}.${ext}`;
        }

        function _imageExtension(mimetype) {
            const map = {
                "image/jpeg": "jpg",
                "image/png": "png",
                "image/webp": "webp",
            };
            return map[mimetype] || "jpg";
        }

        function _videoExtension(mimetype) {
            if (mimetype.includes("mp4")) return "mp4";
            if (mimetype.includes("webm")) return "webm";
            return "webm";
        }

        /**
         * Wait for a specified duration (exponential backoff).
         * @param {number} attempt — 0-indexed retry number
         */
        function _backoffDelay(attempt) {
            return new Promise((resolve) =>
                setTimeout(resolve, RETRY_BASE_DELAY * Math.pow(2, attempt))
            );
        }

        // ----------------------------------------------------------------
        // Upload via ORM (small files — base64 JSON-RPC)
        // ----------------------------------------------------------------

        async function _uploadViaOrm(blob, metadata) {
            const base64Data = await _blobToBase64(blob);
            const vals = {
                name: metadata.name || _generateFilename(blob.type),
                datas: base64Data,
                mimetype: blob.type || "application/octet-stream",
                type: "binary",
            };
            if (metadata.res_model) {
                vals.res_model = metadata.res_model;
            }
            if (metadata.res_id) {
                vals.res_id = metadata.res_id;
            }
            const id = await orm.call("ir.attachment", "create", [vals]);
            return { id, name: vals.name, mimetype: vals.mimetype, file_size: blob.size };
        }

        // ----------------------------------------------------------------
        // Upload via HTTP (large files — multipart form)
        // ----------------------------------------------------------------

        async function _uploadViaHttp(blob, metadata) {
            const formData = new FormData();
            const filename = metadata.name || _generateFilename(blob.type);
            formData.append("file", blob, filename);
            if (metadata.res_model) {
                formData.append("res_model", metadata.res_model);
            }
            if (metadata.res_id) {
                formData.append("res_id", String(metadata.res_id));
            }
            formData.append("csrf_token", odoo.csrf_token || "");

            const url = metadata.portal
                ? "/web_media_capture/portal/upload"
                : "/web_media_capture/upload";

            if (metadata.portal && metadata.access_token) {
                formData.append("access_token", metadata.access_token);
            }

            const response = await fetch(url, {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Upload failed (HTTP ${response.status})`);
            }

            return await response.json();
        }

        // ----------------------------------------------------------------
        // Public API
        // ----------------------------------------------------------------

        /**
         * Upload a single blob as an ir.attachment.
         *
         * @param {Blob} blob — the captured image or video
         * @param {object} [metadata]
         * @param {string} [metadata.name] — filename (auto-generated if omitted)
         * @param {string} [metadata.res_model] — link to this model
         * @param {number} [metadata.res_id] — link to this record id
         * @param {boolean} [metadata.portal] — use portal upload endpoint
         * @param {string} [metadata.access_token] — portal access token
         * @returns {Promise<{id: number, name: string, mimetype: string, file_size: number}>}
         */
        async function upload(blob, metadata = {}) {
            let lastError;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    if (attempt > 0) {
                        await _backoffDelay(attempt - 1);
                    }

                    if (blob.size <= SMALL_FILE_THRESHOLD && !metadata.portal) {
                        return await _uploadViaOrm(blob, metadata);
                    } else {
                        return await _uploadViaHttp(blob, metadata);
                    }
                } catch (err) {
                    lastError = err;
                    console.warn(
                        `[MediaCapture] Upload attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`,
                        err.message
                    );
                }
            }

            notification.add(
                `Upload failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message || "Unknown error"}`,
                { type: "danger", sticky: false }
            );
            throw lastError;
        }

        /**
         * Upload multiple blobs sequentially.
         *
         * @param {Blob[]} blobs
         * @param {object} [metadata] — shared metadata for all files
         * @returns {Promise<Array<{id, name, mimetype, file_size}>>}
         */
        async function uploadMultiple(blobs, metadata = {}) {
            const results = [];
            for (const blob of blobs) {
                const result = await upload(blob, metadata);
                results.push(result);
            }
            return results;
        }

        return { upload, uploadMultiple };
    },
};

registry.category("services").add("media_capture.upload", uploadService);
