/** @odoo-module **/

import { registry } from "@web/core/registry";

/**
 * CompressionService — Client-side image resizing and thumbnail generation.
 *
 * Uses OffscreenCanvas (with <canvas> fallback) for efficient processing
 * without blocking the UI thread.
 */
const compressionService = {
    dependencies: [],

    start(env) {
        // ----------------------------------------------------------------
        // Helpers
        // ----------------------------------------------------------------

        /**
         * Create an ImageBitmap from a blob.
         * @param {Blob} blob
         * @returns {Promise<ImageBitmap>}
         */
        async function _loadBitmap(blob) {
            if (typeof createImageBitmap !== "undefined") {
                return await createImageBitmap(blob);
            }
            // Fallback: use Image element
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = URL.createObjectURL(blob);
            });
        }

        /**
         * Render an image source onto a canvas at the given dimensions.
         * Returns the canvas.
         *
         * @param {ImageBitmap|HTMLImageElement} source
         * @param {number} width
         * @param {number} height
         * @returns {HTMLCanvasElement|OffscreenCanvas}
         */
        function _renderToCanvas(source, width, height) {
            let canvas;
            let ctx;
            if (typeof OffscreenCanvas !== "undefined") {
                canvas = new OffscreenCanvas(width, height);
                ctx = canvas.getContext("2d");
            } else {
                canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                ctx = canvas.getContext("2d");
            }
            ctx.drawImage(source, 0, 0, width, height);
            return canvas;
        }

        /**
         * Convert a canvas to a Blob.
         * @param {HTMLCanvasElement|OffscreenCanvas} canvas
         * @param {string} type
         * @param {number} quality
         * @returns {Promise<Blob>}
         */
        function _canvasToBlob(canvas, type, quality) {
            if (canvas instanceof OffscreenCanvas) {
                return canvas.convertToBlob({ type, quality });
            }
            return new Promise((resolve) => {
                canvas.toBlob(resolve, type, quality);
            });
        }

        // ----------------------------------------------------------------
        // Public API
        // ----------------------------------------------------------------

        /**
         * Compress and/or resize an image blob.
         *
         * @param {Blob} blob — source image
         * @param {object} [opts]
         * @param {number} [opts.maxDimension=1920] — max width or height
         * @param {number} [opts.quality=0.85] — JPEG quality (0-1)
         * @param {string} [opts.format="image/jpeg"] — output format
         * @returns {Promise<Blob>}
         */
        async function compressImage(blob, opts = {}) {
            const maxDim = opts.maxDimension ?? 1920;
            const quality = opts.quality ?? 0.85;
            const format = opts.format ?? "image/jpeg";

            const source = await _loadBitmap(blob);
            let { width, height } = source;

            // Only resize if larger than maxDimension
            if (width > maxDim || height > maxDim) {
                const ratio = Math.min(maxDim / width, maxDim / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = _renderToCanvas(source, width, height);

            // Close bitmap to free memory
            if (source.close) {
                source.close();
            }

            return await _canvasToBlob(canvas, format, quality);
        }

        /**
         * Generate a square thumbnail from an image blob.
         *
         * The image is center-cropped to a square, then resized.
         *
         * @param {Blob} blob — source image
         * @param {number} [size=256] — output dimension (square)
         * @returns {Promise<Blob>}
         */
        async function generateThumbnail(blob, size = 256) {
            const source = await _loadBitmap(blob);
            const { width, height } = source;

            // Center-crop to square
            const cropSize = Math.min(width, height);
            const sx = (width - cropSize) / 2;
            const sy = (height - cropSize) / 2;

            let canvas;
            let ctx;
            if (typeof OffscreenCanvas !== "undefined") {
                canvas = new OffscreenCanvas(size, size);
                ctx = canvas.getContext("2d");
            } else {
                canvas = document.createElement("canvas");
                canvas.width = size;
                canvas.height = size;
                ctx = canvas.getContext("2d");
            }

            ctx.drawImage(source, sx, sy, cropSize, cropSize, 0, 0, size, size);

            if (source.close) {
                source.close();
            }

            return await _canvasToBlob(canvas, "image/jpeg", 0.8);
        }

        return { compressImage, generateThumbnail };
    },
};

registry.category("services").add("media_capture.compression", compressionService);
