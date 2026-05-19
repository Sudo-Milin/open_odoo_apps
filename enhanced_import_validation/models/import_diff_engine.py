# Part of Enhanced Import Validation. See LICENSE file for full copyright and licensing details.

from odoo import models, api

class ImportDiffEngine(models.AbstractModel):
    _name = "import.diff.engine"
    _description = "Engine for computing field-level diffs during import preview"

    @api.model
    def compute_diff(self, record, incoming_values):
        """
        Computes the exact field differences for a given record.
        
        :param record: The existing record (as an object).
        :param incoming_values: dict of {field_name: new_value} that would be written.
        :return: dict with structure:
            {
                "changed_fields": ["phone", "email"],
                "old_values": {"phone": "123", "email": "old@test.com"},
                "new_values": {"phone": "999", "email": "new@test.com"}
            }
        """
        if not record or not incoming_values:
            return {"changed_fields": [], "old_values": {}, "new_values": {}}

        changed_fields = []
        old_values = {}
        new_values = {}

        for field_name, new_val in incoming_values.items():
            if field_name not in record._fields:
                continue
                
            field_def = record._fields[field_name]
            
            # Extract current value from the record
            current_val = record[field_name]
            
            # Format relations / types to be comparable
            formatted_old = self._format_value(current_val, field_def)
            formatted_new = self._format_incoming_value(new_val, field_def, current_val)
            
            # We don't consider it changed if both are empty/falsy
            if not formatted_old and not formatted_new:
                continue
                
            if formatted_old != formatted_new:
                changed_fields.append(field_name)
                old_values[field_name] = formatted_old
                new_values[field_name] = formatted_new

        return {
            "changed_fields": changed_fields,
            "old_values": old_values,
            "new_values": new_values
        }
        
    def _format_value(self, value, field_def):
        if not value:
            return False
            
        if field_def.type in ['many2one']:
            # Return display name for diff
            return value.display_name if value else False
        elif field_def.type in ['one2many', 'many2many']:
            return [v.display_name for v in value] if value else []
        elif field_def.type == 'selection':
            return dict(field_def.selection).get(value, value)
            
        return value
        
    def _format_incoming_value(self, new_val, field_def, current_record_val):
        """ Format the raw incoming value (often ID or ID list) to something human readable for diffing """
        if not new_val:
            return False
            
        if field_def.type == 'many2one':
            # incoming is likely an ID, we need to get the name
            if isinstance(new_val, int):
                # Try to get the name
                comodel = self.env[field_def.comodel_name]
                rec = comodel.browse(new_val)
                return rec.display_name if rec.exists() else new_val
        elif field_def.type in ['many2many', 'one2many']:
            # This is complex because incoming might be a command list [(6, 0, [ids...]), ...]
            return "Command Update (list)" # Simplification for Phase 2 diffs
        elif field_def.type == 'selection':
            return dict(field_def.selection).get(new_val, new_val)
            
        return new_val
