# Part of Enhanced Import Validation. See LICENSE file for full copyright and licensing details.

import json
from odoo import models, fields, api

class ImportPreviewSession(models.TransientModel):
    _name = "import.preview.session"
    _description = "Import Preview Session"

    name = fields.Char(default="Import Preview")
    base_import_id = fields.Many2one('base_import.import', string="Import Record", required=True, ondelete='cascade')
    res_model = fields.Char(related="base_import_id.res_model")
    
    creates_count = fields.Integer("Creates", default=0)
    updates_count = fields.Integer("Updates", default=0)
    errors_count = fields.Integer("Errors", default=0)
    warnings_count = fields.Integer("Warnings", default=0)
    duplicates_count = fields.Integer("Duplicates", default=0)
    no_change_count = fields.Integer("No Change", default=0)
    
    preview_data = fields.Text("Preview JSON Data", help="Stores the serialized JSON of preview rows.")
    
    # Store dynamic fields chosen for duplicate detection
    duplicate_match_fields = fields.Char("Duplicate Match Fields (Comma Separated)", help="Fields to use for duplicate detection, separated by commas.")

    @api.model
    def create_preview(self, import_record, rows_data, stats):
        """ Creates a preview session from the dry-run results. """
        return self.create({
            'base_import_id': import_record.id,
            'creates_count': stats.get('creates', 0),
            'updates_count': stats.get('updates', 0),
            'errors_count': stats.get('errors', 0),
            'warnings_count': stats.get('warnings', 0),
            'duplicates_count': stats.get('duplicates', 0),
            'no_change_count': stats.get('no_change', 0),
            'preview_data': json.dumps(rows_data),
        })

    def action_confirm_import(self):
        """ Proceed with the actual import without the preview flag. """
        # We will implement this after testing the preview wizard
        pass

