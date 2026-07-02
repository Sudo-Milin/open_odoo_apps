/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { useX2ManyCrud } from "@web/views/fields/relational_utils";
import { MediaThumbnail } from "../../components/media_thumbnail/media_thumbnail";

/**
 * MediaGalleryField — Read-optimized gallery view for attachments.
 *
 * Usage:
 *   <field name="attachment_ids" widget="media_gallery"/>
 *
 * Features:
 * - Masonry-style grid layout
 * - Lightbox with prev/next navigation
 * - Fullscreen mode
 * - Lazy loading for large sets
 */
export class MediaGalleryField extends Component {
    static template = "web_media_capture.MediaGalleryField";
    static components = { MediaThumbnail };
    static props = {
        ...standardFieldProps,
    };

    setup() {
        this.notification = useService("notification");

        this.state = useState({
            lightboxOpen: false,
            lightboxIndex: 0,
        });

        this.operations = useX2ManyCrud(() => this.props.record.data[this.props.name], true);
    }

    // ----------------------------------------------------------------
    // Computed
    // ----------------------------------------------------------------

    get attachments() {
        const value = this.props.record.data[this.props.name];
        if (!value) return [];
        if (value.records) {
            return value.records.map((rec) => ({
                id: rec.data.id || rec.resId,
                name: rec.data.name || rec.data.display_name || `Attachment ${rec.resId}`,
                mimetype: rec.data.mimetype || "application/octet-stream",
                file_size: rec.data.file_size || 0,
                create_date: rec.data.create_date || "",
            }));
        }
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

    get currentLightboxAttachment() {
        return this.attachments[this.state.lightboxIndex] || null;
    }

    get lightboxUrl() {
        const att = this.currentLightboxAttachment;
        if (!att) return "";
        if (att.mimetype.startsWith("image/")) {
            return `/web/image/${att.id}`;
        }
        return `/web/content/${att.id}`;
    }

    get lightboxIsVideo() {
        return this.currentLightboxAttachment?.mimetype?.startsWith("video/") || false;
    }

    get hasNext() {
        return this.state.lightboxIndex < this.attachments.length - 1;
    }

    get hasPrev() {
        return this.state.lightboxIndex > 0;
    }

    // ----------------------------------------------------------------
    // Actions
    // ----------------------------------------------------------------

    onClickThumbnail(attachment) {
        const index = this.attachments.findIndex((a) => a.id === attachment.id);
        this.state.lightboxIndex = index >= 0 ? index : 0;
        this.state.lightboxOpen = true;
    }

    onCloseLightbox() {
        this.state.lightboxOpen = false;
    }

    onPrev() {
        if (this.hasPrev) {
            this.state.lightboxIndex--;
        }
    }

    onNext() {
        if (this.hasNext) {
            this.state.lightboxIndex++;
        }
    }

    onLightboxKeydown(ev) {
        if (ev.key === "Escape") this.onCloseLightbox();
        if (ev.key === "ArrowLeft") this.onPrev();
        if (ev.key === "ArrowRight") this.onNext();
    }

    async onDeleteAttachment(attachmentId) {
        if (this.isReadonly) return;
        const attRecord = this.props.record.data[this.props.name].records.find(
            (r) => (r.resId || r.data.id) === attachmentId
        );
        if (attRecord) {
            this.operations.removeRecord(attRecord);
        }
    }
}

// ----------------------------------------------------------------
// Widget registration
// ----------------------------------------------------------------

export const mediaGalleryField = {
    component: MediaGalleryField,
    supportedTypes: ["many2many"],
    extractProps: () => ({}),
};

registry.category("fields").add("media_gallery", mediaGalleryField);
