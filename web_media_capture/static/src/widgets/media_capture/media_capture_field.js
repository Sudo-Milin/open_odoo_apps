/** @odoo-module **/

import { Component, useState, useRef } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { useX2ManyCrud } from "@web/views/fields/relational_utils";
import { CameraPreview } from "../../components/camera_preview/camera_preview";
import { MediaThumbnail } from "../../components/media_thumbnail/media_thumbnail";
import { PermissionPrompt } from "../../components/permission_prompt/permission_prompt";

/**
 * MediaCaptureField — The primary capture widget.
 *
 * Usage:
 *   <field name="attachment_ids" widget="media_capture"
 *          options="{'photo': true, 'video': true, 'multiple': true}"/>
 *
 * Works on any Many2many field pointing to ir.attachment.
 */
export class MediaCaptureField extends Component {
    static template = "web_media_capture.MediaCaptureField";
    static components = { CameraPreview, MediaThumbnail, PermissionPrompt };
    static props = {
        ...standardFieldProps,
        photo: { type: Boolean, optional: true },
        video: { type: Boolean, optional: true },
        multiple: { type: Boolean, optional: true },
        required: { type: Boolean, optional: true },
        maxFiles: { type: Number, optional: true },
        maxDuration: { type: Number, optional: true },
        maxFileSize: { type: Number, optional: true },
        maxDimension: { type: Number, optional: true },
        imageQuality: { type: Number, optional: true },
        gps: { type: Boolean, optional: true },
        watermark: { type: Boolean, optional: true },
    };

    setup() {
        this.uploadService = useService("media_capture.upload");
        this.permissionService = useService("media_capture.permission");
        this.compressionService = useService("media_capture.compression");
        this.notification = useService("notification");
        this.fileInputRef = useRef("fileInput");

        const type = this.props.record.fields[this.props.name].type;
        if (type === "many2many") {
            this.operations = useX2ManyCrud(() => this.props.record.data[this.props.name], true);
        }

        this.state = useState({
            /** "idle"|"permission"|"camera"|"uploading"|"file_fallback" */
            mode: "idle",
            permissionStatus: "prompt",
            uploadProgress: 0,
            isDragging: false,
        });
    }

    // ----------------------------------------------------------------
    // Computed
    // ----------------------------------------------------------------

    get attachments() {
        const type = this.props.record.fields[this.props.name].type;
        if (type === "binary") {
            const value = this.props.record.data[this.props.name];
            if (!value) return [];
            let mimetype = "image/png"; // default
            if (typeof value === "string") {
                if (value.startsWith("AAAAF") || value.startsWith("GkXfo")) {
                    mimetype = "video/webm";
                } else if (value.startsWith("AAAAI") || value.startsWith("ftyp")) {
                    mimetype = "video/mp4";
                }
            }
            const url = this.props.record.resId
                ? `/web/image?model=${this.props.record.resModel}&id=${this.props.record.resId}&field=${this.props.name}&unique=${this.props.record.data.write_date || ''}`
                : `data:${mimetype};base64,${value}`;
            return [{
                id: "binary_value",
                name: this.props.record.data.display_name || "File",
                mimetype: mimetype,
                url: url,
                file_size: 0,
            }];
        }

        const value = this.props.record.data[this.props.name];
        if (!value) return [];
        // value is an ORM many2many: { currentIds, records }
        if (value.records) {
            return value.records.map((rec) => ({
                id: rec.data.id || rec.resId,
                name: rec.data.name || rec.data.display_name || `Attachment ${rec.resId}`,
                mimetype: rec.data.mimetype || "application/octet-stream",
                file_size: rec.data.file_size || 0,
                create_date: rec.data.create_date || "",
            }));
        }
        // Fallback: raw ids
        if (value.currentIds) {
            return value.currentIds.map((id) => ({
                id,
                name: `Attachment ${id}`,
                mimetype: "application/octet-stream",
                file_size: 0,
            }));
        }
        return [];
    }

    get isReadonly() {
        return this.props.readonly;
    }

    get canAddMore() {
        const type = this.props.record.fields[this.props.name].type;
        if (type === "binary") {
            return this.attachments.length === 0;
        }
        const max = this.props.maxFiles ?? 10;
        return this.props.multiple !== false
            ? this.attachments.length < max
            : this.attachments.length === 0;
    }

    get showCamera() {
        return this.state.mode === "camera";
    }

    get showPermissionPrompt() {
        return this.state.mode === "permission";
    }

    get isUploading() {
        return this.state.mode === "uploading";
    }

    // ----------------------------------------------------------------
    // Camera flow
    // ----------------------------------------------------------------

    async onOpenCamera() {
        // Check permission first
        const status = await this.permissionService.checkCamera();
        if (status === "granted") {
            this.state.mode = "camera";
        } else {
            this.state.permissionStatus = status;
            this.state.mode = "permission";
        }
    }

    onPermissionGranted() {
        this.state.mode = "camera";
    }

    onPermissionFallback() {
        this.state.mode = "file_fallback";
        // Trigger file input
        setTimeout(() => this.fileInputRef.el?.click(), 0);
    }

    onCloseCamera() {
        this.state.mode = "idle";
    }

    async onCapture(blob) {
        await this._processAndUpload(blob);
    }

    async onRecordingComplete(blob) {
        await this._processAndUpload(blob, true);
    }

    // ----------------------------------------------------------------
    // File upload flow
    // ----------------------------------------------------------------

    onClickUpload() {
        this.fileInputRef.el?.click();
    }

    async onFileSelected(ev) {
        const files = ev.target.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            const blob = new Blob([file], { type: file.type });
            await this._processAndUpload(blob, file.type.startsWith("video/"));
        }

        // Reset the input so the same file can be selected again
        ev.target.value = "";
        this.state.mode = "idle";
    }

    // ----------------------------------------------------------------
    // Drag & drop
    // ----------------------------------------------------------------

    onDragOver(ev) {
        ev.preventDefault();
        this.state.isDragging = true;
    }

    onDragLeave() {
        this.state.isDragging = false;
    }

    async onDrop(ev) {
        ev.preventDefault();
        this.state.isDragging = false;

        const files = ev.dataTransfer?.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            const blob = new Blob([file], { type: file.type });
            await this._processAndUpload(blob, file.type.startsWith("video/"));
        }
    }

    // ----------------------------------------------------------------
    // Delete
    // ----------------------------------------------------------------

    async onDeleteAttachment(attachmentId) {
        const record = this.props.record;
        const type = record.fields[this.props.name].type;
        if (type === "binary") {
            await record.update({ [this.props.name]: false });
            return;
        }
        const attRecord = this.props.record.data[this.props.name].records.find(
            (r) => (r.resId || r.data.id) === attachmentId
        );
        if (attRecord) {
            this.operations.removeRecord(attRecord);
        }
    }

    // ----------------------------------------------------------------
    // Internal
    // ----------------------------------------------------------------

    _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(",")[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    _getCurrentIds() {
        const value = this.props.record.data[this.props.name];
        if (!value) return [];
        if (value.currentIds) return [...value.currentIds];
        if (value.records) return value.records.map((r) => r.resId || r.data.id);
        return [];
    }

    async _processAndUpload(blob, isVideo = false) {
        if (!this.canAddMore) {
            this.notification.add(
                `Maximum of ${this.props.maxFiles ?? 10} files reached.`,
                { type: "warning" }
            );
            return;
        }

        this.state.mode = "uploading";

        try {
            let processedBlob = blob;

            // Compress images (skip videos — too expensive client-side)
            if (!isVideo && blob.type.startsWith("image/")) {
                processedBlob = await this.compressionService.compressImage(blob, {
                    maxDimension: this.props.maxDimension ?? 1920,
                    quality: this.props.imageQuality ?? 0.85,
                });
            }

            // Check file size limit
            const maxSizeMB = this.props.maxFileSize ?? 125;
            if (processedBlob.size > maxSizeMB * 1024 * 1024) {
                this.notification.add(
                    `File too large (${(processedBlob.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${maxSizeMB} MB.`,
                    { type: "danger" }
                );
                this.state.mode = "idle";
                return;
            }

            const type = this.props.record.fields[this.props.name].type;
            if (type === "binary") {
                const base64Data = await this._blobToBase64(processedBlob);
                await this.props.record.update({
                    [this.props.name]: base64Data,
                });
            } else {
                // Upload Many2many attachment
                const result = await this.uploadService.upload(processedBlob, {
                    res_model: this.props.record.resModel,
                    res_id: this.props.record.resId,
                });

                // Add to relation using saveRecord
                await this.operations.saveRecord([result.id]);
            }
        } catch (err) {
            console.error("[MediaCapture] Upload failed:", err);
            this.notification.add(`Upload failed: ${err.message}`, {
                type: "danger",
            });
        }

        this.state.mode = this.state.mode === "uploading" ? "idle" : this.state.mode;
    }
}

// ----------------------------------------------------------------
// Widget registration
// ----------------------------------------------------------------

export const mediaCaptureField = {
    component: MediaCaptureField,
    supportedTypes: ["many2many", "binary"],
    relatedFields: [
        { name: "name", type: "char" },
        { name: "mimetype", type: "char" },
        { name: "file_size", type: "integer" },
    ],
    extractProps: ({ attrs, options }) => ({
        photo: options?.photo !== false,
        video: options?.video !== false,
        multiple: options?.multiple ?? true,
        required: options?.required ?? false,
        maxFiles: options?.max_files ?? 10,
        maxDuration: options?.max_duration ?? 60,
        maxFileSize: options?.max_file_size ?? 125,
        maxDimension: options?.max_dimension ?? 1920,
        imageQuality: options?.image_quality ?? 0.85,
        gps: options?.gps ?? false,
        watermark: options?.watermark ?? false,
    }),
};

registry.category("fields").add("media_capture", mediaCaptureField);
