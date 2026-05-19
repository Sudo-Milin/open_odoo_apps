# Part of Enhanced Import Validation. See LICENSE file for full copyright and licensing details.

import base64
import json
import logging

from odoo import http
from odoo.http import request, content_disposition

_logger = logging.getLogger(__name__)


class EnhancedImportController(http.Controller):

    @http.route(
        '/enhanced_import/download_report/<int:result_id>',
        type='http',
        auth='user',
        methods=['GET'],
    )
    def download_error_report(self, result_id, **kwargs):
        """Download the CSV error report for a given import validation result.

        :param int result_id: ID of the import.validation.result record
        :returns: HTTP response with CSV file download
        """
        result = request.env['import.validation.result'].sudo().browse(result_id)
        if not result.exists():
            return request.not_found()

        # Security: only the user who created it or admins can download
        if result.user_id.id != request.env.user.id and not request.env.user._is_admin():
            return request.not_found()

        if not result.error_report:
            return request.not_found()

        csv_content = base64.b64decode(result.error_report)
        filename = result.error_report_filename or 'import_errors.csv'

        headers = [
            ('Content-Type', 'text/csv; charset=utf-8'),
            ('Content-Disposition', content_disposition(filename)),
            ('Content-Length', len(csv_content)),
        ]
        return request.make_response(csv_content, headers=headers)

    @http.route(
        '/enhanced_import/error_summary/<int:result_id>',
        type='json',
        auth='user',
        methods=['POST'],
    )
    def get_error_summary(self, result_id, **kwargs):
        """Return a JSON summary of the import validation result.

        Useful for the frontend to display error details without
        requiring a full page reload.

        :param int result_id: ID of the import.validation.result record
        :returns: dict with error summary
        """
        result = request.env['import.validation.result'].sudo().browse(result_id)
        if not result.exists():
            return {'error': 'Not found'}

        # Security check
        if result.user_id.id != request.env.user.id and not request.env.user._is_admin():
            return {'error': 'Access denied'}

        errors = []
        if result.error_data:
            try:
                errors = json.loads(result.error_data)
            except (json.JSONDecodeError, ValueError):
                pass

        return {
            'id': result.id,
            'name': result.name,
            'res_model': result.res_model,
            'model_name': result.model_name,
            'file_name': result.file_name,
            'total_rows': result.total_rows,
            'success_count': result.success_count,
            'error_count': result.error_count,
            'state': result.state,
            'errors': errors,
            'download_url': f'/enhanced_import/download_report/{result.id}',
        }
