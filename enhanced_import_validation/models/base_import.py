# Part of Enhanced Import Validation. See LICENSE file for full copyright and licensing details.

import logging

from odoo import models
from odoo.tools.translate import _

from .import_error_parser import ImportErrorParser

_logger = logging.getLogger(__name__)


class BaseImportExtended(models.TransientModel):
    """Extends base_import.import to enrich error messages with
    row-level tracking, classified error types, actionable suggestions,
    and downloadable error reports.

    Design principle: wrap the existing import flow, never replace it.
    The ORM's ``load()`` already handles batching, per-record fallback,
    and savepoints. We enrich the messages it produces.
    """
    _inherit = 'base_import.import'

    def _convert_import_data(self, fields, options):
        """ Override to apply custom inline mappings from the preview table """
        input_file_data, import_fields = super()._convert_import_data(fields, options)
        
        inline_mapping = options.get('inline_mapping', {})
        if inline_mapping:
            for record_index, records in enumerate(input_file_data):
                for column_index, value in enumerate(records):
                    # import_fields contains the field name (e.g. 'country_id') or False
                    field = import_fields[column_index]
                    if field in inline_mapping:
                        if value in inline_mapping[field]:
                            # Apply the mapped value
                            input_file_data[record_index][column_index] = inline_mapping[field][value]
                            
        return input_file_data, import_fields

    def execute_import(self, fields, columns, options, dryrun=False):
        """Override to enrich import results with structured error diagnostics.

        Flow:
        1. Call the parent ``execute_import`` (which internally calls
           ``_convert_import_data``, ``_parse_import_data``,
           ``_handle_multi_mapping``, ``_handle_fallback_values``,
           and finally ``model.load()``).
        2. Post-process the returned messages through ``ImportErrorParser``.
        3. If errors exist, create an ``import.validation.result`` record
           and inject a download link into the messages.
        4. Return the standard import result format (backward-compatible).
        """
        # --- Step 1: Run the standard import ---
        import_result = super().execute_import(fields, columns, options, dryrun=dryrun)

        # --- Step 2: Enrich error messages ---
        messages = import_result.get('messages', [])
        if not messages:
            return import_result

        parser = ImportErrorParser(env=self.env, model_name=self.res_model)
        enriched_messages = []
        enriched_errors = []  # Only errors (not warnings/info)

        for msg in messages:
            if not isinstance(msg, dict):
                enriched_messages.append(msg)
                continue

            enriched = parser.parse(msg)
            enriched_messages.append(enriched)

            if enriched.get('type') == 'error':
                enriched_errors.append(enriched)

        import_result['messages'] = enriched_messages

        # --- Step 3: Create validation result and inject download link ---
        if enriched_errors and not dryrun:
            try:
                # Estimate total rows from the data
                total_rows = self._estimate_total_rows(options)
                success_count = len(import_result.get('ids', []) or [])

                result_record = self.env['import.validation.result'].sudo().create_from_import(
                    res_model=self.res_model,
                    file_name=self.file_name or '',
                    total_rows=total_rows,
                    success_count=success_count,
                    enriched_errors=enriched_errors,
                )

                # Inject download link into messages
                download_url = f'/enhanced_import/download_report/{result_record.id}'
                import_result['error_report_url'] = download_url
                import_result['error_report_id'] = result_record.id

                # Add a summary message at the top
                summary_msg = {
                    'type': 'error',
                    'message': _(
                        "%(error_count)d error(s) detected. "
                        "Download the detailed error report for row-by-row diagnostics.",
                        error_count=len(enriched_errors),
                    ),
                    'error_type': 'summary',
                    'download_url': download_url,
                }
                import_result['messages'].insert(0, summary_msg)

            except Exception:
                _logger.warning(
                    "Failed to create import validation result",
                    exc_info=True,
                )

        # Also create validation result for dry-run so users can review
        if enriched_errors and dryrun:
            try:
                total_rows = self._estimate_total_rows(options)
                result_record = self.env['import.validation.result'].sudo().create_from_import(
                    res_model=self.res_model,
                    file_name=self.file_name or '',
                    total_rows=total_rows,
                    success_count=0,
                    enriched_errors=enriched_errors,
                )

                download_url = f'/enhanced_import/download_report/{result_record.id}'
                import_result['error_report_url'] = download_url
                import_result['error_report_id'] = result_record.id

                summary_msg = {
                    'type': 'error',
                    'message': _(
                        "Test import found %(error_count)d error(s). "
                        "Download the detailed error report for row-by-row diagnostics.",
                        error_count=len(enriched_errors),
                    ),
                    'error_type': 'summary',
                    'download_url': download_url,
                }
                import_result['messages'].insert(0, summary_msg)

            except Exception:
                _logger.warning(
                    "Failed to create import validation result for dry run",
                    exc_info=True,
                )

        return import_result

    def _estimate_total_rows(self, options):
        """Estimate total data rows in the import file."""
        try:
            _file_length, rows = self._read_file(options)
            total = len(rows)
            if options.get('has_headers') and total > 0:
                total -= 1
            skip = options.get('skip', 0)
            return max(total - skip, 0)
        except Exception:
            return 0

    def action_preview_import(self, fields, columns, options):
        """ Executes a dry-run import in a savepoint, captures changes, and rolls back. 
            Returns an action to open the Preview Wizard.
        """
        self.ensure_one()
        
        # 1. Setup savepoint
        import_savepoint = self.env.cr.savepoint(flush=False)
        
        # 2. Parse data
        try:
            input_file_data, import_fields = self._convert_import_data(fields, options)
            input_file_data = self._parse_import_data(input_file_data, import_fields, options)
        except Exception as error:
            import_savepoint.close(rollback=True)
            return {'type': 'ir.actions.client', 'tag': 'display_notification', 'params': {'message': str(error), 'type': 'danger'}}

        import_fields, merged_data = self.with_context(import_options=options)._handle_multi_mapping(import_fields, input_file_data)
        if options.get('fallback_values'):
            merged_data = self._handle_fallback_values(import_fields, merged_data, options['fallback_values'])

        # 3. Duplicate Detection Prep
        duplicate_match_fields = options.get('duplicate_match_fields', [])
        
        # 4. Load inside savepoint
        name_create_enabled_fields = options.pop('name_create_enabled_fields', {})
        import_limit = options.pop('limit', None)
        
        preview_context = {
            'import_file': True,
            'name_create_enabled_fields': name_create_enabled_fields,
            'import_set_empty_fields': options.get('import_set_empty_fields', []),
            'import_skip_records': options.get('import_skip_records', []),
            '_import_limit': import_limit,
            'import_preview': True,
            'tracking_disable': True,
            'mail_create_nolog': True,
            'mail_notrack': True,
        }
        
        # We need to know BEFORE load what the existing DB state is to compute diffs.
        # But Odoo's load() returns ids of created/updated records.
        # To get the diff, we have to intercept before it writes, or read the records 
        # before rollback. Since Odoo load() modifies the records directly, 
        # we can just track the IDs returned.
        # Wait, if we want Before/After, we need to know what the values *were* before.
        # The easiest way is to read the records before `load` but we don't know which IDs
        # until `load` resolves the external IDs.
        
        # Let's run load()
        model = self.env[self.res_model].with_context(**preview_context)
        import_result = model.load(import_fields, merged_data)
        
        messages = import_result.get('messages', [])
        
        # Enrich messages with parser
        from .import_error_parser import ImportErrorParser
        parser = ImportErrorParser(self.env, self.res_model)
        enriched_messages = [parser.parse(msg) for msg in messages]
        
        # We'll just build a basic preview data structure for now
        stats = {
            'creates': 0,
            'updates': 0,
            'errors': 0,
            'warnings': 0,
            'duplicates': 0,
            'no_change': 0,
        }
        
        rows_data = []
        for i, row in enumerate(merged_data):
            row_errors = [m for m in enriched_messages if m.get('record') == i]
            status = 'CREATE'
            if row_errors:
                status = 'ERROR'
                stats['errors'] += 1
            else:
                stats['creates'] += 1
                
            # Create a dict of column -> raw value for display
            raw_values = {}
            if i < len(input_file_data):
                raw_row = input_file_data[i]
                for col_idx, col_name in enumerate(columns):
                    if col_idx < len(raw_row):
                        raw_values[col_name] = raw_row[col_idx]
            
            rows_data.append({
                'row': i,
                'status': status,
                'errors': row_errors,
                'raw_values': raw_values
            })
            
        import_savepoint.close(rollback=True)
        self.pool.clear_all_caches()
        self.pool.reset_changes()

        # 5. Create Session
        session = self.env['import.preview.session'].create_preview(self, rows_data, stats)
        
        # 6. Create wizard and return action
        wizard = self.env['import.preview.wizard'].create({'session_id': session.id})
        
        return {
            'name': 'Import Preview',
            'type': 'ir.actions.act_window',
            'res_model': 'import.preview.wizard',
            'view_mode': 'form',
            'views': [[False, 'form']],
            'res_id': wizard.id,
            'target': 'new',
        }
