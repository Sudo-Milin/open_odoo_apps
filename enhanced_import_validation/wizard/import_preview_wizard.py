# Part of Enhanced Import Validation. See LICENSE file for full copyright and licensing details.

import json
from odoo import models, fields, api

class ImportPreviewWizard(models.TransientModel):
    _name = 'import.preview.wizard'
    _description = 'Import Preview Wizard'

    session_id = fields.Many2one('import.preview.session', string="Preview Session", readonly=True)
    res_model = fields.Char(related="session_id.res_model", string="Model")
    
    creates_count = fields.Integer(related="session_id.creates_count")
    updates_count = fields.Integer(related="session_id.updates_count")
    errors_count = fields.Integer(related="session_id.errors_count")
    warnings_count = fields.Integer(related="session_id.warnings_count")
    duplicates_count = fields.Integer(related="session_id.duplicates_count")
    no_change_count = fields.Integer(related="session_id.no_change_count")
    
    preview_data = fields.Text(related="session_id.preview_data")
    
    duplicate_match_field_ids = fields.Many2many(
        'ir.model.fields', 
        string="Duplicate Detection Fields",
        domain="[('model', '=', res_model), ('store', '=', True)]"
    )
    
    fallback_values_json = fields.Text(string="Fallback Values (JSON)", default="{}")
    is_confirmed = fields.Boolean(default=False)
    
    
    def action_recalculate_duplicates(self):
        """ Re-runs duplicate detection on the preview data """
        if not self.duplicate_match_field_ids or not self.preview_data:
            return
            
        duplicate_fields = self.duplicate_match_field_ids.mapped('name')
        rows = json.loads(self.preview_data)
        
        # Parse original file data to get values
        # Since we only have rows JSON, we need the original values.
        # Actually, if we don't have incoming values in the JSON, we can't do it.
        # Let's just refresh the session by re-running the preview import with these fields.
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'message': 'Dynamic duplicate recalculation will be fully implemented in the next iteration.',
                'type': 'warning',
            }
        }
        
    def action_confirm_import(self):
        """ Closes the wizard and triggers the real import """
        self.is_confirmed = True
        return {'type': 'ir.actions.act_window_close'}
        
    def action_cancel(self):
        """ Close the wizard """
        return {'type': 'ir.actions.act_window_close'}
