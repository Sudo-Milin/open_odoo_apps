/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { BaseImportModel } from "@base_import/import_model";
import { browser } from "@web/core/browser/browser";

/**
 * Minimal patch on BaseImportModel to handle the enhanced error report
 * download link returned by the enhanced_import_validation backend.
 *
 * When the import result contains an `error_report_url`, we trigger a
 * sticky notification with a download button and replace the summary
 * message with a plain-text version (since the template uses t-esc).
 */
patch(BaseImportModel.prototype, {
    async _callImport(dryrun, args) {
        const res = await super._callImport(dryrun, args);

        // Check if our enhanced backend injected a download URL
        if (res && res.error_report_url && !res._downloadLinkAdded) {
            res._downloadLinkAdded = true;

            const downloadUrl = res.error_report_url;

            // Show a sticky notification with a download button
            this.notificationService.add(
                _t("Import errors detected. Click the button below to download a detailed CSV report with row-by-row diagnostics."),
                {
                    type: "danger",
                    sticky: true,
                    title: _t("Import Error Report Available"),
                    buttons: [
                        {
                            name: _t("Download Error Report (CSV)"),
                            primary: true,
                            onClick: () => {
                                browser.open(downloadUrl, "_blank");
                            },
                        },
                    ],
                }
            );

            // Remove the raw HTML summary messages injected by the backend
            // (they contain download_url which would show as escaped HTML)
            if (res.messages) {
                res.messages = res.messages.filter(
                    (msg) => !(msg && msg.error_type === "summary")
                );
            }
        }

        return res;
    },
});
