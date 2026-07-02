/** @odoo-module **/

import { Component, useState, useRef, onMounted, onWillUnmount } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

/**
 * CameraPreview — Live camera viewfinder component.
 *
 * Shows a video feed from the user's camera with controls for:
 * - Photo capture (shutter button)
 * - Video recording (hold / toggle)
 * - Camera switching (front/rear)
 */
export class CameraPreview extends Component {
    static template = "web_media_capture.CameraPreview";
    static props = {
        /** Whether to enable photo capture */
        photo: { type: Boolean, optional: true },
        /** Whether to enable video recording */
        video: { type: Boolean, optional: true },
        /** Max video duration in seconds */
        maxDuration: { type: Number, optional: true },
        /** Image quality (0-1) */
        imageQuality: { type: Number, optional: true },
        /** Max image dimension */
        maxDimension: { type: Number, optional: true },
        /** Called with Blob when image is captured */
        onCapture: { type: Function, optional: true },
        /** Called with Blob when video recording finishes */
        onRecordingComplete: { type: Function, optional: true },
        /** Called when user closes the camera */
        onClose: { type: Function, optional: true },
    };

    setup() {
        this.mediaService = useService("media_capture.media");
        this.videoRef = useRef("video");

        this.state = useState({
            isReady: false,
            isRecording: false,
            recordingTime: 0,
            devices: [],
            currentDeviceIndex: 0,
            flashActive: false,
            isMirrored: false,
        });

        this._stream = null;
        this._recordingHandle = null;

        onMounted(() => this._init());
        onWillUnmount(() => this._cleanup());
    }

    // ----------------------------------------------------------------
    // Lifecycle
    // ----------------------------------------------------------------

    async _init() {
        try {
            this._stream = await this.mediaService.openCamera();
            if (this.videoRef.el) {
                this.videoRef.el.srcObject = this._stream;
            }
            this.state.isReady = true;

            // Enumerate devices for camera switch button
            const { videoInputs } = await this.mediaService.enumerateDevices();
            this.state.devices = videoInputs;

            // Sync device index and mirror setting based on the active stream
            this._updateCameraMetadata();
        } catch (err) {
            console.error("[CameraPreview] Failed to open camera:", err);
        }
    }

    _cleanup() {
        if (this._recordingHandle) {
            this._recordingHandle.stop();
            this._recordingHandle = null;
        }
        this.mediaService.stopAll();
        this._stream = null;
    }

    /**
     * Inspect active video track settings and device labels to determine:
     * 1. The correct index of the active camera in the devices list.
     * 2. Whether the active camera is user-facing (requires mirroring).
     */
    _updateCameraMetadata() {
        if (!this._stream) return;
        const videoTracks = this._stream.getVideoTracks();
        if (!videoTracks.length) return;

        const track = videoTracks[0];
        const settings = track.getSettings?.() || {};
        const activeDeviceId = settings.deviceId;

        // 1. Sync the currentDeviceIndex based on active deviceId
        if (activeDeviceId && this.state.devices.length) {
            const idx = this.state.devices.findIndex(
                (d) => d.deviceId === activeDeviceId
            );
            if (idx !== -1) {
                this.state.currentDeviceIndex = idx;
            }
        }

        // 2. Detect if front-facing (user) or back-facing (environment)
        let facingMode = settings.facingMode;

        // If facingMode not returned in settings, fallback to checking the device label
        const currentDevice = this.state.devices[this.state.currentDeviceIndex];
        if (!facingMode && currentDevice && currentDevice.label) {
            const label = currentDevice.label.toLowerCase();
            if (
                label.includes("front") ||
                label.includes("user") ||
                label.includes("selfie") ||
                label.includes("webcam")
            ) {
                facingMode = "user";
            } else if (
                label.includes("back") ||
                label.includes("rear") ||
                label.includes("environment")
            ) {
                facingMode = "environment";
            }
        }

        // Default fallback if we cannot detect: desktop is user-facing, mobile is environment-facing
        if (!facingMode) {
            const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            facingMode = isMobile ? "environment" : "user";
        }

        this.state.isMirrored = facingMode === "user";
    }

    // ----------------------------------------------------------------
    // Computed
    // ----------------------------------------------------------------

    get hasMultipleCameras() {
        return this.state.devices.length > 1;
    }

    get formattedTime() {
        const m = Math.floor(this.state.recordingTime / 60);
        const s = this.state.recordingTime % 60;
        return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    get showPhotoButton() {
        return this.props.photo !== false && !this.state.isRecording;
    }

    get showVideoButton() {
        return this.props.video !== false;
    }

    // ----------------------------------------------------------------
    // Actions
    // ----------------------------------------------------------------

    async onCapturePhoto() {
        if (!this.videoRef.el || !this.state.isReady) return;

        // Flash animation
        this.state.flashActive = true;
        setTimeout(() => (this.state.flashActive = false), 200);

        const blob = await this.mediaService.captureImage(this.videoRef.el, {
            quality: this.props.imageQuality ?? 0.85,
            maxDimension: this.props.maxDimension ?? 1920,
        });
        this.props.onCapture?.(blob);
    }

    async onToggleRecording() {
        if (this.state.isRecording) {
            // Stop recording
            if (this._recordingHandle) {
                const blob = await this._recordingHandle.stop();
                this._recordingHandle = null;
                this.state.isRecording = false;
                this.state.recordingTime = 0;
                this.props.onRecordingComplete?.(blob);
            }
        } else {
            // Start recording
            if (!this._stream) return;
            this.state.isRecording = true;
            this.state.recordingTime = 0;

            this._recordingHandle = this.mediaService.startRecording(this._stream, {
                maxDuration: this.props.maxDuration ?? 60,
                onTimeUpdate: (elapsed) => {
                    this.state.recordingTime = elapsed;
                },
            });

            // Auto-stop handler
            this._recordingHandle.stop.then?.((blob) => {
                if (this.state.isRecording) {
                    this.state.isRecording = false;
                    this.state.recordingTime = 0;
                    this._recordingHandle = null;
                    this.props.onRecordingComplete?.(blob);
                }
            });
        }
    }

    async onSwitchCamera() {
        const devices = this.state.devices;
        if (devices.length < 2) return;

        this.state.currentDeviceIndex =
            (this.state.currentDeviceIndex + 1) % devices.length;
        const deviceId = devices[this.state.currentDeviceIndex].deviceId;

        try {
            this._stream = await this.mediaService.switchCamera(deviceId);
            if (this.videoRef.el) {
                this.videoRef.el.srcObject = this._stream;
            }
            this._updateCameraMetadata();
        } catch (err) {
            console.error("[CameraPreview] Failed to switch camera:", err);
        }
    }

    onClose() {
        this._cleanup();
        this.props.onClose?.();
    }
}
