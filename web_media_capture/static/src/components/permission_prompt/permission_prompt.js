/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

/**
 * PermissionPrompt — Shown when camera access is not yet granted.
 *
 * Displays contextual messaging and actions depending on the current
 * permission state (prompt, denied, unavailable).
 */
export class PermissionPrompt extends Component {
    static template = "web_media_capture.PermissionPrompt";
    static props = {
        /** Current permission status: "prompt"|"denied"|"unavailable" */
        status: { type: String },
        /** Called when user grants permission */
        onGranted: { type: Function, optional: true },
        /** Called when user chooses the file upload fallback */
        onFallback: { type: Function, optional: true },
    };

    setup() {
        this.permissionService = useService("media_capture.permission");
        this.state = useState({
            requesting: false,
        });
    }

    // ----------------------------------------------------------------
    // Computed
    // ----------------------------------------------------------------

    get isPrompt() {
        return this.props.status === "prompt";
    }

    get isDenied() {
        return this.props.status === "denied";
    }

    get isUnavailable() {
        return this.props.status === "unavailable";
    }

    get title() {
        if (this.isDenied) return "Camera Access Denied";
        if (this.isUnavailable) return "Camera Unavailable";
        return "Camera Permission Required";
    }

    get message() {
        if (this.isDenied) {
            return "Camera access was denied. Please enable it in your browser settings, then reload this page.";
        }
        if (this.isUnavailable) {
            return "No camera detected, or this page is not served over HTTPS. You can upload files instead.";
        }
        return "This feature needs access to your camera to capture photos and videos.";
    }

    // ----------------------------------------------------------------
    // Actions
    // ----------------------------------------------------------------

    async onRequestPermission() {
        this.state.requesting = true;
        const result = await this.permissionService.requestCamera();
        this.state.requesting = false;

        if (result === "granted") {
            this.props.onGranted?.();
        }
    }

    onUploadFallback() {
        this.props.onFallback?.();
    }
}
