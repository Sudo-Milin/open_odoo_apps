/** @odoo-module **/

import { Component, useState } from "@odoo/owl";

/**
 * MediaThumbnail — Displays a single attachment as a thumbnail card.
 *
 * Shows image thumbnails with lightbox, video posters with play overlay,
 * and a delete button when in edit mode.
 */
export class MediaThumbnail extends Component {
    static template = "web_media_capture.MediaThumbnail";
    static props = {
        /** Attachment record data: { id, name, mimetype, file_size, create_date, ... } */
        attachment: { type: Object },
        /** Whether the field is in readonly mode */
        readonly: { type: Boolean, optional: true },
        /** Called with attachment id when delete is clicked */
        onDelete: { type: Function, optional: true },
        /** Optional custom click handler to override default lightbox */
        onClick: { type: Function, optional: true },
    };

    setup() {
        this.state = useState({
            previewOpen: false,
        });
    }

    // ----------------------------------------------------------------
    // Computed
    // ----------------------------------------------------------------

    get isImage() {
        return (this.props.attachment.mimetype || "").startsWith("image/");
    }

    get isVideo() {
        return (this.props.attachment.mimetype || "").startsWith("video/");
    }

    get thumbnailUrl() {
        const att = this.props.attachment;
        if (att.url) {
            return att.url;
        }
        const token = att.access_token ? `?access_token=${att.access_token}` : "";
        if (this.isImage) {
            return `/web/image/${att.id}/256x256${token}`;
        }
        // For video: use a generic poster or the first frame
        return `/web/image/${att.id}${token}`;
    }

    get videoUrl() {
        const att = this.props.attachment;
        if (att.url) {
            return att.url;
        }
        const token = att.access_token ? `?access_token=${att.access_token}` : "";
        return `/web/content/${att.id}${token}`;
    }

    get downloadUrl() {
        const att = this.props.attachment;
        const token = att.access_token ? `&access_token=${att.access_token}` : "";
        return att.url || `/web/content/${att.id}?download=true${token}`;
    }

    get fileSizeLabel() {
        const size = this.props.attachment.file_size || 0;
        if (size === 0) return "";
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    // ----------------------------------------------------------------
    // Actions
    // ----------------------------------------------------------------

    onClickThumbnail(ev) {
        if (this.props.onClick) {
            ev.stopPropagation();
            this.props.onClick(this.props.attachment);
        } else {
            this.state.previewOpen = true;
        }
    }

    onClosePreview() {
        this.state.previewOpen = false;
    }

    onLightboxKeydown(ev) {
        if (ev.key === "Escape") {
            ev.stopPropagation();
            this.onClosePreview();
        }
    }

    onClickDelete(ev) {
        ev.stopPropagation();
        this.props.onDelete?.(this.props.attachment.id);
    }
}
