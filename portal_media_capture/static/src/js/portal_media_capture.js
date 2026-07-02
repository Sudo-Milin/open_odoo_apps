/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { rpc } from "@web/core/network/rpc";
import { useService } from "@web/core/utils/hooks";
import { CameraPreview } from "@web_media_capture/components/camera_preview/camera_preview";
import { PermissionPrompt } from "@web_media_capture/components/permission_prompt/permission_prompt";
import { MediaThumbnail } from "@web_media_capture/components/media_thumbnail/media_thumbnail";
import { App } from "@odoo/owl";
import { getTemplate } from "@web/core/templates";
import { appTranslateFn } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";

export class PortalMediaCapture extends Component {
    static template = "portal_media_capture.PortalMediaCapture";
    static components = { CameraPreview, PermissionPrompt, MediaThumbnail };
    static props = {
        resModel: { type: String },
        resId: { type: Number },
        accessToken: { type: String },
    };

    setup() {
        this.compressionService = useService("media_capture.compression");
        this.permissionService = useService("media_capture.permission");
        this.notification = useService("notification");

        this.state = useState({
            attachments: [],
            uploadingFiles: [], // list of { id, name, progress }
            cameraOpen: false,
            previewAttachment: null, // attachment active in lightbox
        });

        onWillStart(async () => {
            await this.loadAttachments();
        });
    }

    async loadAttachments() {
        try {
            const res = await rpc("/portal_media_capture/attachments", {
                res_model: this.props.resModel,
                res_id: this.props.resId,
                access_token: this.props.accessToken,
            });
            if (res && res.attachments) {
                this.state.attachments = res.attachments;
            } else if (res && res.error) {
                console.error("[PortalMediaCapture] Error loading attachments:", res.error);
            }
        } catch (err) {
            console.error("[PortalMediaCapture] Failed to load attachments:", err);
        }
    }

    async onCapturePhoto(blob) {
        this.state.cameraOpen = false;
        await this.uploadBlob(blob, "captured_photo.jpg");
    }

    async onRecordingComplete(blob) {
        this.state.cameraOpen = false;
        await this.uploadBlob(blob, "captured_video.webm");
    }

    async openCamera() {
        // On non-secure contexts (HTTP), getUserMedia is unavailable.
        // Fall back to the native file picker with capture attribute.
        if (!navigator.mediaDevices?.getUserMedia) {
            this._openNativeCapture();
            return;
        }

        try {
            const status = await this.permissionService.checkCamera();
            if (status === "granted") {
                this.state.cameraOpen = true;
            } else if (status === "prompt") {
                const granted = await this.permissionService.requestCamera();
                if (granted === "granted") {
                    this.state.cameraOpen = true;
                } else {
                    // Permission denied — fall back to native capture
                    this._openNativeCapture();
                }
            } else {
                // "denied" or "unavailable" — use native capture
                this._openNativeCapture();
            }
        } catch (err) {
            console.warn("[PortalMediaCapture] Camera check failed, using native capture:", err);
            this._openNativeCapture();
        }
    }

    /**
     * Open the device's native camera via a temporary file input with capture attribute.
     * This works on mobile even on HTTP contexts.
     */
    _openNativeCapture() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*,video/*";
        input.capture = "environment"; // Use rear camera by default
        input.addEventListener("change", async (ev) => {
            const file = ev.target.files?.[0];
            if (file) {
                let blob = file;
                if (file.type.startsWith("image/")) {
                    try {
                        blob = await this.compressionService.compressImage(file, {
                            maxDimension: 1920,
                            quality: 1,
                        });
                    } catch (err) {
                        console.error("Compression failed, uploading original:", err);
                    }
                }
                await this.uploadBlob(blob, file.name);
            }
        });
        input.click();
    }

    closeCamera() {
        this.state.cameraOpen = false;
    }

    async onFileSelected(ev) {
        const files = ev.target.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            let blob = file;
            if (file.type.startsWith("image/")) {
                try {
                    // Compress image before uploading
                    blob = await this.compressionService.compressImage(file, {
                        maxDimension: 1920,
                        quality: 0.85,
                    });
                } catch (err) {
                    console.error("Compression failed, uploading original:", err);
                }
            }
            await this.uploadBlob(blob, file.name);
        }
        // Clear input value
        ev.target.value = "";
    }

    uploadBlob(blob, filename) {
        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            const uploadId = Math.random().toString(36).substring(2, 9);
            const uploadItem = {
                id: uploadId,
                name: filename,
                progress: 0,
            };

            this.state.uploadingFiles.push(uploadItem);

            xhr.upload.addEventListener("progress", (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    const idx = this.state.uploadingFiles.findIndex(item => item.id === uploadId);
                    if (idx !== -1) {
                        this.state.uploadingFiles[idx].progress = percent;
                    }
                }
            });

            xhr.addEventListener("load", () => {
                // Remove from uploading files
                this.state.uploadingFiles = this.state.uploadingFiles.filter(item => item.id !== uploadId);
                
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        if (response.error) {
                            this.notification.add(response.error, { type: "danger" });
                        } else {
                            this.state.attachments.push(response);
                        }
                    } catch (err) {
                        this.notification.add("Failed to parse upload response.", { type: "danger" });
                    }
                } else {
                    this.notification.add(`Upload failed with status ${xhr.status}`, { type: "danger" });
                }
                resolve();
            });

            xhr.addEventListener("error", () => {
                this.state.uploadingFiles = this.state.uploadingFiles.filter(item => item.id !== uploadId);
                this.notification.add("Upload failed due to connection error.", { type: "danger" });
                resolve();
            });

            const formData = new FormData();
            formData.append("file", blob, filename);
            formData.append("res_model", this.props.resModel);
            formData.append("res_id", String(this.props.resId));
            formData.append("access_token", this.props.accessToken);
            formData.append("csrf_token", odoo.csrf_token || "");

            xhr.open("POST", "/portal_media_capture/upload");
            xhr.send(formData);
        });
    }

    async onDeleteAttachment(attachmentId) {
        try {
            const res = await rpc("/portal_media_capture/delete", {
                attachment_id: attachmentId,
                res_model: this.props.resModel,
                res_id: this.props.resId,
                access_token: this.props.accessToken,
            });
            if (res && res.success) {
                // Close preview if the deleted attachment was currently open
                if (this.state.previewAttachment && this.state.previewAttachment.id === attachmentId) {
                    this.state.previewAttachment = null;
                }
                this.state.attachments = this.state.attachments.filter(att => att.id !== attachmentId);
            } else if (res && res.error) {
                this.notification.add(res.error, { type: "danger" });
            }
        } catch (err) {
            this.notification.add("Failed to delete attachment.", { type: "danger" });
        }
    }

    // Lightbox / Modal methods
    onClickThumbnail(attachment) {
        this.state.previewAttachment = attachment;
        // Focus lightbox for keyboard events
        setTimeout(() => {
            const lightbox = document.querySelector(".o_portal_mc_lightbox");
            if (lightbox) lightbox.focus();
        }, 50);
    }

    closeLightbox() {
        this.state.previewAttachment = null;
    }

    onPrevMedia() {
        if (!this.state.previewAttachment || this.state.attachments.length === 0) return;
        const currentId = this.state.previewAttachment.id;
        const idx = this.state.attachments.findIndex(att => att.id === currentId);
        if (idx > 0) {
            this.state.previewAttachment = this.state.attachments[idx - 1];
        } else {
            this.state.previewAttachment = this.state.attachments[this.state.attachments.length - 1];
        }
    }

    onNextMedia() {
        if (!this.state.previewAttachment || this.state.attachments.length === 0) return;
        const currentId = this.state.previewAttachment.id;
        const idx = this.state.attachments.findIndex(att => att.id === currentId);
        if (idx !== -1 && idx < this.state.attachments.length - 1) {
            this.state.previewAttachment = this.state.attachments[idx + 1];
        } else {
            this.state.previewAttachment = this.state.attachments[0];
        }
    }

    onLightboxKeydown(ev) {
        if (ev.key === "Escape") {
            ev.stopPropagation();
            this.closeLightbox();
        } else if (ev.key === "ArrowLeft") {
            ev.stopPropagation();
            this.onPrevMedia();
        } else if (ev.key === "ArrowRight") {
            ev.stopPropagation();
            this.onNextMedia();
        }
    }

    get isPreviewImage() {
        const att = this.state.previewAttachment;
        return att && (att.mimetype || "").startsWith("image/");
    }

    get isPreviewVideo() {
        const att = this.state.previewAttachment;
        return att && (att.mimetype || "").startsWith("video/");
    }

    get previewUrl() {
        const att = this.state.previewAttachment;
        if (!att) return "";
        if (att.url) return att.url;
        const token = att.access_token ? `?access_token=${att.access_token}` : "";
        if (this.isPreviewImage) {
            return `/web/image/${att.id}${token}`;
        }
        return `/web/content/${att.id}${token}`;
    }
}

export const portalMediaCaptureService = {
    dependencies: ["notification"],
    start(env, services) {
        const container = document.querySelector(".o_portal_media_capture_container");
        if (!container) return;

        const props = {
            resModel: container.getAttribute("data-res-model"),
            resId: parseInt(container.getAttribute("data-res-id")),
            accessToken: container.getAttribute("data-access-token"),
        };

        const app = new App(PortalMediaCapture, {
            env,
            getTemplate,
            props,
            translateFn: appTranslateFn,
            dev: env.debug,
        });
        app.mount(container);
    }
};

registry.category("services").add("portal_media_capture", portalMediaCaptureService);
