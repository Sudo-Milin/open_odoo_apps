# Part of Enhanced Import Validation. See LICENSE file for full copyright and licensing details.

from odoo import models, api

class ImportDuplicateDetector(models.AbstractModel):
    _name = "import.duplicate.detector"
    _description = "Engine for detecting duplicates during import preview"

    @api.model
    def find_duplicate_candidates(self, model_name, incoming_values, duplicate_fields):
        """
        Finds existing records in the database that match the incoming values
        on the specified duplicate fields.

        :param model_name: Name of the model being imported (e.g. 'res.partner')
        :param incoming_values: dict of {field_name: new_value}
        :param duplicate_fields: list of field names to check for exact matches
        :return: Recordset of potential duplicates or empty recordset
        """
        if not duplicate_fields or not incoming_values or not model_name:
            return self.env[model_name].browse()

        domain = []
        for field in duplicate_fields:
            if field in incoming_values and incoming_values[field]:
                domain.append((field, '=', incoming_values[field]))
                
        if not domain:
            return self.env[model_name].browse()
            
        # We only check for OR matches if there are multiple fields
        # But if they provide multiple fields, it usually means ALL must match or ANY?
        # Let's use OR for duplicate detection: if ANY of the fields match exactly.
        if len(domain) > 1:
            or_domain = ['|'] * (len(domain) - 1) + domain
            domain = or_domain

        return self.env[model_name].search(domain)
