/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { ImportAction } from "@base_import/import_action/import_action";
import { _t } from "@web/core/l10n/translation";

patch(ImportAction.prototype, {
    async handlePreviewImport() {
        const message = _t("Previewing Import...");
        this.model.block(message);

        try {
            const importOptions = this.model.formattedImportOptions;
            const columns = this.model.columns.map((e) => e.name.trim().toLowerCase());
            const fields = this.model.columns.map((e) => Boolean(e.fieldInfo) && e.fieldInfo.fieldPath);

            const action = await this.model.orm.call(
                "base_import.import",
                "action_preview_import",
                [this.model.id, fields, columns, importOptions],
                { context: this.model.context }
            );

            if (action) {
                this.actionService.doAction(action, {
                    onClose: async (closeInfos) => {
                        if (!action.res_id) return;
                        
                        try {
                            const wizardData = await this.model.orm.read(
                                "import.preview.wizard",
                                [action.res_id],
                                ["is_confirmed", "fallback_values_json"]
                            );
                            
                            
                            
                            if (wizardData && wizardData.length > 0) {
                                const wizard = wizardData[0];
                                if (wizard.is_confirmed) {
                                    // Apply fallback values
                                    const fallbackValues = JSON.parse(wizard.fallback_values_json || '{}');
                                    if (Object.keys(fallbackValues).length > 0) {
                                        // Odoo's setOption is hardcoded to only accept specific field options.
                                        // We must inject our custom option directly into importOptionsValues so the getter picks it up.
                                        if (!this.model.importOptionsValues.inline_mapping) {
                                            this.model.importOptionsValues.inline_mapping = { value: {} };
                                        }
                                        
                                        const currentInlineMapping = this.model.importOptionsValues.inline_mapping.value;
                                        for (const [field, mapping] of Object.entries(fallbackValues)) {
                                            if (!currentInlineMapping[field]) currentInlineMapping[field] = {};
                                            Object.assign(currentInlineMapping[field], mapping);
                                        }
                                        
                                        
                                    }
                                    
                                    // Trigger the real import
                                    await this.handleImport(false);
                                }
                            }
                        } catch (err) {
                            // Ignored or handle error quietly if needed
                        }
                    }
                });
            }
        } finally {
            this.model.unblock();
        }
    }
});
