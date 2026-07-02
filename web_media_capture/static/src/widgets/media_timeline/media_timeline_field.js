/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { useX2ManyCrud } from "@web/views/fields/relational_utils";

/**
 * MediaTimelineField — Chronological timeline view for attachments.
 *
 * Usage:
 *   <field name="attachment_ids" widget="media_timeline"/>
 *
 * Features:
 * - Vertical timeline with date headers
 * - Thumbnail + filename + timestamp + uploader
 * - Groups by date
 * - Expandable detail view
 */
export class MediaTimelineField extends Component {
    static template = "web_media_capture.MediaTimelineField";
    static props = {
        ...standardFieldProps,
    };

    setup() {
        this.state = useState({
            expandedIds: new Set(),
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
                create_uid_name: rec.data.create_uid?.[1] || "",
            }));
        }
        if (value.currentIds) {
            return value.currentIds.map((id) => ({
                id,
                name: `Attachment ${id}`,
                mimetype: "application/octet-stream",
                file_size: 0,
                create_date: "",
                create_uid_name: "",
            }));
        }
        return [];
    }

    /**
     * Group attachments by date (YYYY-MM-DD).
     * Returns array of { date: string, label: string, items: attachment[] }
     */
    get groupedByDate() {
        const groups = {};
        for (const att of this.attachments) {
            const dateStr = att.create_date ? att.create_date.split(" ")[0] : "Unknown";
            if (!groups[dateStr]) {
                groups[dateStr] = {
                    date: dateStr,
                    label: this._formatDateLabel(dateStr),
                    items: [],
                };
            }
            groups[dateStr].items.push(att);
        }
        // Sort groups by date descending (newest first)
        return Object.values(groups).sort((a, b) => (a.date > b.date ? -1 : 1));
    }

    get isReadonly() {
        return this.props.readonly;
    }

    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------

    _formatDateLabel(dateStr) {
        if (dateStr === "Unknown") return "Unknown Date";
        try {
            const date = new Date(dateStr);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            const d = new Date(date);
            d.setHours(0, 0, 0, 0);

            if (d.getTime() === today.getTime()) return "Today";
            if (d.getTime() === yesterday.getTime()) return "Yesterday";
            return date.toLocaleDateString(undefined, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
            });
        } catch {
            return dateStr;
        }
    }

    _formatTime(dateStr) {
        if (!dateStr) return "";
        try {
            const date = new Date(dateStr.replace(" ", "T"));
            return date.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
            });
        } catch {
            return "";
        }
    }

    _fileSizeLabel(size) {
        if (!size) return "";
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    _isImage(mimetype) {
        return (mimetype || "").startsWith("image/");
    }

    _isVideo(mimetype) {
        return (mimetype || "").startsWith("video/");
    }

    _thumbnailUrl(att) {
        if (this._isImage(att.mimetype)) {
            return `/web/image/${att.id}/128x128`;
        }
        return "";
    }

    // ----------------------------------------------------------------
    // Actions
    // ----------------------------------------------------------------

    onToggleExpand(attId) {
        if (this.state.expandedIds.has(attId)) {
            this.state.expandedIds.delete(attId);
        } else {
            this.state.expandedIds.add(attId);
        }
    }

    isExpanded(attId) {
        return this.state.expandedIds.has(attId);
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

export const mediaTimelineField = {
    component: MediaTimelineField,
    supportedTypes: ["many2many"],
    extractProps: () => ({}),
};

registry.category("fields").add("media_timeline", mediaTimelineField);
