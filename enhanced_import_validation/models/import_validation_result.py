# Part of Enhanced Import Validation. See LICENSE file for full copyright and licensing details.

import csv
import io
import json
import base64
import logging

from odoo import api, fields, models

_logger = logging.getLogger(__name__)


class ImportValidationResult(models.Model):
    _name = 'import.validation.result'
    _description = 'Import Validation Result'
    _order = 'create_date desc'

    name = fields.Char(
        'Import Name',
        required=True,
        help='Auto-generated name describing the import attempt.',
    )
    res_model = fields.Char(
        'Model',
        required=True,
        index=True,
        help='Technical name of the model that was being imported.',
    )
    model_name = fields.Char(
        'Model Label',
        compute='_compute_model_name',
        store=True,
        help='Human-readable name of the model.',
    )
    import_date = fields.Datetime(
        'Import Date',
        default=fields.Datetime.now,
        readonly=True,
    )
    user_id = fields.Many2one(
        'res.users',
        'Imported By',
        default=lambda self: self.env.user,
        readonly=True,
    )
    file_name = fields.Char('File Name')
    total_rows = fields.Integer('Total Rows')
    success_count = fields.Integer('Successful Rows')
    error_count = fields.Integer('Failed Rows')
    state = fields.Selection(
        [
            ('failed', 'All Failed'),
            ('partial', 'Partial Success'),
        ],
        string='Status',
        default='failed',
    )
    error_data = fields.Text(
        'Error Data (JSON)',
        help='Serialized list of enriched error dictionaries.',
    )
    error_report = fields.Binary(
        'Error Report',
        attachment=True,
        readonly=True,
    )
    error_report_filename = fields.Char(
        'Report Filename',
        readonly=True,
    )

    @api.depends('res_model')
    def _compute_model_name(self):
        for record in self:
            if record.res_model:
                try:
                    ir_model = self.env['ir.model']._get(record.res_model)
                    record.model_name = ir_model.name if ir_model else record.res_model
                except Exception:
                    record.model_name = record.res_model
            else:
                record.model_name = ''

    def _generate_csv_report(self, errors):
        """Generate a CSV error report from a list of enriched error dicts.

        :param list errors: List of enriched error dicts from ImportErrorParser
        :returns: base64-encoded CSV content
        :rtype: str
        """
        output = io.StringIO()
        writer = csv.writer(output)

        # Header row
        writer.writerow([
            'Row',
            'Field (Technical)',
            'Field (Label)',
            'Error Type',
            'Error Message',
            'Suggestions',
            'Original Message',
        ])

        for error in errors:
            row_from = ''
            row_to = ''
            rows = error.get('rows', {})
            if isinstance(rows, dict):
                row_from = rows.get('from', '')
                row_to = rows.get('to', '')

            # Display row numbers as 1-indexed for user friendliness
            if row_from != '' and row_to != '':
                if row_from == row_to:
                    row_display = str(int(row_from) + 1)
                else:
                    row_display = f"{int(row_from) + 1}-{int(row_to) + 1}"
            elif row_from != '':
                row_display = str(int(row_from) + 1)
            else:
                row_display = ''

            suggestions = error.get('suggestions', [])
            suggestions_text = ' | '.join(suggestions) if suggestions else ''

            writer.writerow([
                row_display,
                error.get('field', ''),
                error.get('field_label', ''),
                error.get('error_type', 'unknown'),
                error.get('message', ''),
                suggestions_text,
                error.get('original_message', ''),
            ])

        csv_content = output.getvalue()
        output.close()
        return base64.b64encode(csv_content.encode('utf-8-sig'))

    @api.model
    def create_from_import(self, res_model, file_name, total_rows, success_count,
                           enriched_errors):
        """Create a validation result record and generate the CSV error report.

        :param str res_model: Technical model name
        :param str file_name: Original import file name
        :param int total_rows: Total number of data rows in the file
        :param int success_count: Number of successfully imported rows
        :param list enriched_errors: List of enriched error dicts
        :returns: created record
        """
        error_count = len(enriched_errors)

        # Determine state
        state = 'failed'
        if success_count > 0:
            state = 'partial'

        # Generate human-readable name
        model_label = res_model
        try:
            ir_model = self.env['ir.model']._get(res_model)
            if ir_model:
                model_label = ir_model.name
        except Exception:
            pass

        name = f"Import {model_label} — {error_count} error(s)"
        if file_name:
            name = f"{file_name} → {model_label} — {error_count} error(s)"

        # Generate CSV report
        report_data = self._generate_csv_report(enriched_errors)
        report_filename = f"import_errors_{res_model}_{fields.Datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

        # Serialize errors for storage (strip non-serializable objects)
        safe_errors = []
        for err in enriched_errors:
            safe_err = {}
            for key, val in err.items():
                try:
                    json.dumps(val)
                    safe_err[key] = val
                except (TypeError, ValueError):
                    safe_err[key] = str(val)
            safe_errors.append(safe_err)

        return self.create({
            'name': name,
            'res_model': res_model,
            'file_name': file_name or '',
            'total_rows': total_rows,
            'success_count': success_count,
            'error_count': error_count,
            'state': state,
            'error_data': json.dumps(safe_errors, indent=2, ensure_ascii=False),
            'error_report': report_data,
            'error_report_filename': report_filename,
        })
