/** @odoo-module **/

import { registry } from "@web/core/registry";

/**
 * MediaService — Central service for camera and recording lifecycle.
 *
 * Registered as "media_capture.media" in the services registry.
 * Manages device enumeration, camera streams, image capture, and
 * video recording via the browser MediaDevices API.
 */
const mediaService = {
    dependencies: [],

    start(env) {
        /** @type {MediaStream|null} */
        let _activeStream = null;
        /** @type {MediaRecorder|null} */
        let _activeRecorder = null;

        // ----------------------------------------------------------------
        // Helpers
        // ----------------------------------------------------------------

        function _isMobile() {
            return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        }

        function _bestMimeType() {
            // Prefer mp4 (Safari), fall back to webm (Chrome/Firefox)
            const types = [
                "video/mp4",
                "video/webm;codecs=vp9,opus",
                "video/webm;codecs=vp8,opus",
                "video/webm",
            ];
            for (const t of types) {
                if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
                    return t;
                }
            }
            return "";
        }

        // ----------------------------------------------------------------
        // Public API
        // ----------------------------------------------------------------

        /**
         * Enumerate available media input devices.
         * @returns {Promise<{videoInputs: MediaDeviceInfo[], audioInputs: MediaDeviceInfo[]}>}
         */
        async function enumerateDevices() {
            if (!navigator.mediaDevices?.enumerateDevices) {
                return { videoInputs: [], audioInputs: [] };
            }
            const devices = await navigator.mediaDevices.enumerateDevices();
            return {
                videoInputs: devices.filter((d) => d.kind === "videoinput"),
                audioInputs: devices.filter((d) => d.kind === "audioinput"),
            };
        }

        /**
         * Open a camera stream.
         *
         * @param {object} [opts]
         * @param {string} [opts.deviceId] — specific camera device id
         * @param {"user"|"environment"} [opts.facingMode] — front / rear
         * @param {number} [opts.width] — ideal width
         * @param {number} [opts.height] — ideal height
         * @param {boolean} [opts.audio] — include audio track (for video)
         * @returns {Promise<MediaStream>}
         */
        async function openCamera(opts = {}) {
            // Stop any previous stream first
            stopAll();

            const constraints = { video: {} };

            if (opts.deviceId) {
                constraints.video.deviceId = { exact: opts.deviceId };
            } else if (opts.facingMode) {
                constraints.video.facingMode = { ideal: opts.facingMode };
            } else if (_isMobile()) {
                // Default to rear camera on mobile
                constraints.video.facingMode = { ideal: "environment" };
            }

            if (opts.width) {
                constraints.video.width = { ideal: opts.width };
            }
            if (opts.height) {
                constraints.video.height = { ideal: opts.height };
            }

            if (opts.audio) {
                constraints.audio = true;
            }

            try {
                _activeStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (err) {
                // Progressive fallback — try without specific device / facing
                if (opts.deviceId || opts.facingMode) {
                    const fallback = { video: true };
                    if (opts.audio) {
                        fallback.audio = true;
                    }
                    _activeStream = await navigator.mediaDevices.getUserMedia(fallback);
                } else {
                    throw err;
                }
            }

            return _activeStream;
        }

        /**
         * Switch to a different camera while keeping the stream concept alive.
         * @param {string} deviceId
         * @returns {Promise<MediaStream>}
         */
        async function switchCamera(deviceId) {
            const hadAudio = _activeStream
                ? _activeStream.getAudioTracks().length > 0
                : false;
            return openCamera({ deviceId, audio: hadAudio });
        }

        /**
         * Capture a still image from a video element.
         *
         * @param {HTMLVideoElement} videoEl
         * @param {object} [opts]
         * @param {number} [opts.quality] — JPEG quality 0-1 (default 0.85)
         * @param {string} [opts.format] — "image/jpeg" | "image/png" (default jpeg)
         * @param {number} [opts.maxDimension] — resize if larger
         * @returns {Promise<Blob>}
         */
        async function captureImage(videoEl, opts = {}) {
            const format = opts.format || "image/jpeg";
            const quality = opts.quality ?? 0.85;

            let sw = videoEl.videoWidth;
            let sh = videoEl.videoHeight;

            // Resize if needed
            if (opts.maxDimension && (sw > opts.maxDimension || sh > opts.maxDimension)) {
                const ratio = Math.min(opts.maxDimension / sw, opts.maxDimension / sh);
                sw = Math.round(sw * ratio);
                sh = Math.round(sh * ratio);
            }

            // Try ImageCapture API first (higher res, Chromium only)
            if (typeof ImageCapture !== "undefined" && _activeStream) {
                try {
                    const track = _activeStream.getVideoTracks()[0];
                    const imageCapture = new ImageCapture(track);
                    const bitmap = await imageCapture.grabFrame();
                    const canvas = new OffscreenCanvas(sw, sh);
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(bitmap, 0, 0, sw, sh);
                    bitmap.close();
                    return await canvas.convertToBlob({ type: format, quality });
                } catch {
                    // Fall through to canvas method
                }
            }

            // Canvas fallback (universal)
            const canvas = document.createElement("canvas");
            canvas.width = sw;
            canvas.height = sh;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(videoEl, 0, 0, sw, sh);

            return new Promise((resolve) => {
                canvas.toBlob(resolve, format, quality);
            });
        }

        /**
         * Start recording video from the active stream.
         *
         * @param {MediaStream} stream
         * @param {object} [opts]
         * @param {number} [opts.maxDuration] — auto-stop after N seconds
         * @param {function} [opts.onTimeUpdate] — called every second with elapsed
         * @returns {{ stop: () => Promise<Blob>, recorder: MediaRecorder }}
         */
        function startRecording(stream, opts = {}) {
            const mimeType = _bestMimeType();
            const recorderOpts = mimeType ? { mimeType } : {};
            const recorder = new MediaRecorder(stream, recorderOpts);
            _activeRecorder = recorder;

            const chunks = [];
            let elapsed = 0;
            let timer = null;

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

            // Time tracking
            if (opts.onTimeUpdate) {
                timer = setInterval(() => {
                    elapsed++;
                    opts.onTimeUpdate(elapsed);
                    if (opts.maxDuration && elapsed >= opts.maxDuration) {
                        recorder.stop();
                    }
                }, 1000);
            } else if (opts.maxDuration) {
                timer = setTimeout(() => recorder.stop(), opts.maxDuration * 1000);
            }

            const stopPromise = new Promise((resolve) => {
                recorder.onstop = () => {
                    if (timer) {
                        clearInterval(timer);
                        clearTimeout(timer);
                    }
                    _activeRecorder = null;
                    const blob = new Blob(chunks, {
                        type: recorder.mimeType || "video/webm",
                    });
                    resolve(blob);
                };
            });

            recorder.start(1000); // Collect data every second

            return {
                stop: () => {
                    if (recorder.state !== "inactive") {
                        recorder.stop();
                    }
                    return stopPromise;
                },
                recorder,
            };
        }

        /**
         * Stop all active streams and recorders. Safe to call multiple times.
         */
        function stopAll() {
            if (_activeRecorder && _activeRecorder.state !== "inactive") {
                try {
                    _activeRecorder.stop();
                } catch {
                    // Ignore — already stopped
                }
                _activeRecorder = null;
            }
            if (_activeStream) {
                _activeStream.getTracks().forEach((track) => track.stop());
                _activeStream = null;
            }
        }

        return {
            enumerateDevices,
            openCamera,
            switchCamera,
            captureImage,
            startRecording,
            stopAll,
        };
    },
};

registry.category("services").add("media_capture.media", mediaService);
