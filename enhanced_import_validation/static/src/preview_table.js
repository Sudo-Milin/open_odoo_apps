/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";

import { useService } from "@web/core/utils/hooks";

export class ImportPreviewTable extends Component {
    static template = "enhanced_import_validation.PreviewTable";
    static props = {
        ...standardFieldProps,
    };

    setup() {
        this.orm = useService("orm");
        
        // Parse existing fallback values if any
        let initialFallbacks = {};
        const fallbackJsonStr = this.props.record.data.fallback_values_json;
        if (fallbackJsonStr) {
            try {
                initialFallbacks = JSON.parse(fallbackJsonStr);
            } catch (e) {
                console.warn("Failed to parse initial fallback values");
            }
        }
        
        this.state = useState({
            filter: 'all', // 'all', 'error', 'create', 'update'
            fallbackValues: initialFallbacks,
        });
    }

    get rows() {
        const value = this.props.record.data[this.props.name];
        if (!value) return [];
        try {
            return JSON.parse(value);
        } catch (e) {
            console.error("Failed to parse preview_data JSON:", e);
            return [];
        }
    }
    
    get filteredRows() {
        if (this.state.filter === 'all') {
            return this.rows;
        }
        return this.rows.filter(r => r.status.toLowerCase() === this.state.filter);
    }
    
    setFilter(filterName) {
        this.state.filter = filterName;
    }
    
    async setFallbackValue(field, failedValue, replacementValue) {
        if (!this.state.fallbackValues[field]) {
            this.state.fallbackValues[field] = {};
        }
        
        if (replacementValue.trim() === '') {
            delete this.state.fallbackValues[field][failedValue];
        } else {
            this.state.fallbackValues[field][failedValue] = replacementValue;
        }
        
        // Sync to the backend record so the wizard confirm action can pick it up
        await this.orm.call(this.props.record.resModel, "write", [
            [this.props.record.resId], 
            { fallback_values_json: JSON.stringify(this.state.fallbackValues) }
        ]);
        
        // Update the form view record data so other fields/UI might know
        this.props.record.update({ fallback_values_json: JSON.stringify(this.state.fallbackValues) });
    }
}

export const importPreviewTable = {
    component: ImportPreviewTable,
};

registry.category("fields").add("import_preview_table", importPreviewTable);
