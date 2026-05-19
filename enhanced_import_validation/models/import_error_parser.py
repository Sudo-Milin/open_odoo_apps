# Part of Enhanced Import Validation. See LICENSE file for full copyright and licensing details.

import logging
import re

_logger = logging.getLogger(__name__)

# ============================================================================
# Error type constants
# ============================================================================
ERROR_MISSING_RELATION = 'missing_relation'
ERROR_DUPLICATE_KEY = 'duplicate_key'
ERROR_INVALID_SELECTION = 'invalid_selection'
ERROR_REQUIRED_FIELD = 'required_field'
ERROR_DATE_FORMAT = 'date_format'
ERROR_ACCESS_DENIED = 'access_denied'
ERROR_TYPE_MISMATCH = 'type_mismatch'
ERROR_UNKNOWN = 'unknown'


class ImportErrorParser:
    """Classifies raw import error messages into structured, actionable diagnostics.

    This is a pure Python class (not an Odoo model) intentionally designed
    to be pluggable. Community modules can subclass and register additional
    handlers via ``_handlers``.

    Usage::

        parser = ImportErrorParser(env, model_name='res.partner')
        enriched = parser.parse(raw_error_dict)
    """

    def __init__(self, env=None, model_name=None):
        self.env = env
        self.model_name = model_name
        self._field_labels = {}
        self._selection_values = {}
        if env and model_name:
            self._load_field_metadata()

    # ------------------------------------------------------------------
    # Field metadata helpers
    # ------------------------------------------------------------------
    def _load_field_metadata(self):
        """Pre-load field labels and selection values for the target model."""
        try:
            model = self.env[self.model_name]
            fields_info = model.fields_get(
                attributes=['string', 'type', 'selection', 'required', 'relation']
            )
            for fname, finfo in fields_info.items():
                self._field_labels[fname] = finfo.get('string', fname)
                if finfo.get('type') == 'selection' and finfo.get('selection'):
                    self._selection_values[fname] = finfo['selection']
        except Exception:
            _logger.debug("Could not load field metadata for %s", self.model_name, exc_info=True)

    def get_field_label(self, field_name):
        """Return human-readable field label, falling back to the technical name."""
        if not field_name:
            return ''
        # Handle dotted paths like 'partner_id/name' or 'partner_id'
        base_field = field_name.split('/')[0] if '/' in field_name else field_name
        return self._field_labels.get(base_field, field_name)

    def get_selection_options(self, field_name):
        """Return list of (key, label) tuples for a selection field."""
        return self._selection_values.get(field_name, [])

    # ------------------------------------------------------------------
    # Main parse entry point
    # ------------------------------------------------------------------
    def parse(self, error_info):
        """Parse a raw error dict from Odoo's ``model.load()`` and return
        an enriched copy with additional diagnostic keys.

        :param dict error_info: Raw error dict with keys like
            ``type``, ``message``, ``field``, ``rows``, ``record``, ``moreinfo``
        :returns: dict with additional keys:
            ``error_type``, ``field_label``, ``suggestions``,
            ``original_message``, ``enhanced_message``
        """
        if not isinstance(error_info, dict):
            return error_info

        message = error_info.get('message', '')
        field = error_info.get('field', '')
        field_label = self.get_field_label(field) if field else ''

        # Try each handler in priority order
        for handler in self._get_handlers():
            result = handler(message, field, field_label, error_info)
            if result:
                result.setdefault('original_message', message)
                result.setdefault('field_label', field_label)
                # Merge back into the error dict
                enriched = dict(error_info)
                enriched.update(result)
                # Replace the message with enhanced version
                if result.get('enhanced_message'):
                    enriched['message'] = result['enhanced_message']
                return enriched

        # Fallback: unknown error with field label enrichment
        enriched = dict(error_info)
        enriched.update({
            'error_type': ERROR_UNKNOWN,
            'field_label': field_label,
            'suggestions': [],
            'original_message': message,
        })
        return enriched

    def _get_handlers(self):
        """Return ordered list of handler methods. Override to add custom handlers."""
        return [
            self._handle_missing_relation,
            self._handle_duplicate_key,
            self._handle_invalid_selection,
            self._handle_required_field,
            self._handle_date_format,
            self._handle_access_denied,
            self._handle_type_mismatch,
        ]

    # ------------------------------------------------------------------
    # Handler: Missing Relation (M2O / M2M not found)
    # ------------------------------------------------------------------
    # Patterns from Odoo ORM ir_fields.py and models.py:
    #   "No matching record found for name '...' in field '...'"
    #   "No matching record found for the name(s) '...'"
    _RE_MISSING_RELATION = re.compile(
        r"[Nn]o matching record found|"
        r"[Nn]ame_search|"
        r"does not exist|"
        r"[Vv]alue .+ does not exist",
        re.IGNORECASE,
    )

    def _handle_missing_relation(self, message, field, field_label, error_info):
        if not self._RE_MISSING_RELATION.search(message):
            return None

        # Try to extract the failing value from the message
        value_match = re.search(r"['\"]([^'\"]+)['\"]", message)
        value = value_match.group(1) if value_match else '(unknown)'

        display_field = field_label or field or 'related field'
        enhanced = (
            f'"{value}" not found for {display_field}.'
        )

        suggestions = [
            f'Import the missing {display_field} record first, then retry.',
            'Use the "External ID" column instead of a name for more reliable matching.',
            'Check if the record is archived — archived records are excluded from import lookups.',
        ]

        return {
            'error_type': ERROR_MISSING_RELATION,
            'enhanced_message': enhanced,
            'suggestions': suggestions,
            'failed_value': value,
        }

    # ------------------------------------------------------------------
    # Handler: Duplicate Key (UniqueViolation)
    # ------------------------------------------------------------------
    _RE_DUPLICATE_KEY = re.compile(
        r"duplicate key value|"
        r"unique[_ ]?constraint|"
        r"already exists|"
        r"UNIQUE constraint failed|"
        r"UniqueViolation",
        re.IGNORECASE,
    )

    def _handle_duplicate_key(self, message, field, field_label, error_info):
        if not self._RE_DUPLICATE_KEY.search(message):
            return None

        # Try to extract the constraint field/value from the message
        detail_match = re.search(r"Key \(([^)]+)\)=\(([^)]+)\)", message)
        if detail_match:
            constraint_field = detail_match.group(1)
            constraint_value = detail_match.group(2)
            constraint_label = self.get_field_label(constraint_field) or constraint_field
            enhanced = (
                f'A record already exists with {constraint_label} = "{constraint_value}". '
                f'Duplicate detected.'
            )
        else:
            display_field = field_label or field or 'this field'
            enhanced = (
                f'A duplicate record was detected for {display_field}. '
                f'A record with the same value already exists.'
            )

        suggestions = [
            'Check your data for duplicate entries.',
            'If you want to update existing records, include the "External ID" or "Database ID" column.',
            'Remove the duplicate row from your import file.',
        ]

        return {
            'error_type': ERROR_DUPLICATE_KEY,
            'enhanced_message': enhanced,
            'suggestions': suggestions,
        }

    # ------------------------------------------------------------------
    # Handler: Invalid Selection Value
    # ------------------------------------------------------------------
    _RE_INVALID_SELECTION = re.compile(
        r"[Ww]rong value for|"
        r"[Vv]alue .+ not found in selection|"
        r"is not a valid value for selection",
        re.IGNORECASE,
    )

    def _handle_invalid_selection(self, message, field, field_label, error_info):
        if not self._RE_INVALID_SELECTION.search(message):
            return None

        display_field = field_label or field or 'selection field'

        # Extract the invalid value
        value_match = re.search(r"['\"]([^'\"]+)['\"]", message)
        invalid_value = value_match.group(1) if value_match else '(unknown)'

        # Build list of allowed values
        allowed = self.get_selection_options(field) if field else []
        if allowed:
            allowed_display = ', '.join(f'"{label}" ({key})' for key, label in allowed)
            enhanced = (
                f'Invalid value "{invalid_value}" for {display_field}. '
                f'Allowed values: {allowed_display}'
            )
        else:
            enhanced = (
                f'Invalid value "{invalid_value}" for {display_field}. '
                f'Please check the allowed values for this field.'
            )

        suggestions = [
            'Use one of the allowed selection values listed above.',
            'Selection values are case-sensitive — check exact spelling.',
            'You can use the "Test Import" button to validate before importing.',
        ]

        # Put allowed values into moreinfo for the UI's "See possible values" link
        moreinfo = [f"{label} ({key})" for key, label in allowed] if allowed else []

        result = {
            'error_type': ERROR_INVALID_SELECTION,
            'enhanced_message': enhanced,
            'suggestions': suggestions,
            'failed_value': invalid_value,
        }
        if moreinfo:
            result['moreinfo'] = moreinfo
        return result

    # ------------------------------------------------------------------
    # Handler: Required Field Missing
    # ------------------------------------------------------------------
    _RE_REQUIRED_FIELD = re.compile(
        r"[Mm]issing required|"
        r"[Rr]equired field|"
        r"null value in column|"
        r"NOT NULL|"
        r"cannot be empty|"
        r"is required",
        re.IGNORECASE,
    )

    def _handle_required_field(self, message, field, field_label, error_info):
        if not self._RE_REQUIRED_FIELD.search(message):
            return None

        display_field = field_label or field or 'a required field'

        # Try to extract the field name from constraint messages
        col_match = re.search(r'column "([^"]+)"', message)
        if col_match and not field:
            extracted_field = col_match.group(1)
            display_field = self.get_field_label(extracted_field) or extracted_field

        enhanced = (
            f'{display_field} is required and cannot be empty. '
            f'Please provide a value for every row.'
        )

        suggestions = [
            f'Ensure the "{display_field}" column is present and filled in your import file.',
            'Empty cells in required columns will cause import failure.',
            'If the field should have a default value, set it in Odoo before importing.',
        ]

        return {
            'error_type': ERROR_REQUIRED_FIELD,
            'enhanced_message': enhanced,
            'suggestions': suggestions,
        }

    # ------------------------------------------------------------------
    # Handler: Date/Datetime Format Errors
    # ------------------------------------------------------------------
    _RE_DATE_FORMAT = re.compile(
        r"time data .+ does not match|"
        r"[Ii]nvalid date|"
        r"[Ii]ncorrect date|"
        r"[Ee]rror [Pp]arsing [Dd]ate|"
        r"unconverted data remains|"
        r"does not match format",
        re.IGNORECASE,
    )

    def _handle_date_format(self, message, field, field_label, error_info):
        if not self._RE_DATE_FORMAT.search(message):
            return None

        display_field = field_label or field or 'date field'

        # Try to extract the invalid value
        value_match = re.search(r"time data ['\"]?([^'\"]+?)['\"]? does not match", message)
        if not value_match:
            value_match = re.search(r"['\"]([^'\"]+)['\"]", message)
        invalid_value = value_match.group(1) if value_match else '(unknown)'

        enhanced = (
            f'Invalid date/time format in {display_field}: "{invalid_value}". '
            f'Expected format: YYYY-MM-DD (dates) or YYYY-MM-DD HH:MM:SS (datetimes).'
        )

        suggestions = [
            'Use the format YYYY-MM-DD for dates (e.g. 2025-01-31).',
            'Use the format YYYY-MM-DD HH:MM:SS for datetimes (e.g. 2025-01-31 14:30:00).',
            'Check the "Date Format" option in the import settings to match your file format.',
            'Ensure all date cells contain valid calendar dates (e.g. no month 13 or day 32).',
        ]

        return {
            'error_type': ERROR_DATE_FORMAT,
            'enhanced_message': enhanced,
            'suggestions': suggestions,
            'failed_value': invalid_value,
        }

    # ------------------------------------------------------------------
    # Handler: Access Rights Errors
    # ------------------------------------------------------------------
    _RE_ACCESS_DENIED = re.compile(
        r"[Aa]ccess[Ee]rror|"
        r"not allowed|"
        r"[Pp]ermission|"
        r"do not have .+ rights|"
        r"access.+denied|"
        r"not have the access rights",
        re.IGNORECASE,
    )

    def _handle_access_denied(self, message, field, field_label, error_info):
        if not self._RE_ACCESS_DENIED.search(message):
            return None

        model_label = self.model_name or 'the target model'
        if self.env and self.model_name:
            try:
                model_label = self.env['ir.model']._get(self.model_name).name or self.model_name
            except Exception:
                pass

        enhanced = (
            f'You do not have permission to create/modify records in {model_label}. '
            f'Contact your administrator.'
        )

        suggestions = [
            'Ask your system administrator to grant import permissions.',
            'Check that you have Create access on the target model.',
            f'Model: {self.model_name}' if self.model_name else '',
        ]
        suggestions = [s for s in suggestions if s]

        return {
            'error_type': ERROR_ACCESS_DENIED,
            'enhanced_message': enhanced,
            'suggestions': suggestions,
        }

    # ------------------------------------------------------------------
    # Handler: Type Mismatch (int, float, etc.)
    # ------------------------------------------------------------------
    _RE_TYPE_MISMATCH = re.compile(
        r"invalid literal|"
        r"could not convert|"
        r"[Ii]ncorrect values|"
        r"[Ee]xpected .+ got|"
        r"is not a number|"
        r"ValueError|"
        r"[Cc]annot convert",
        re.IGNORECASE,
    )

    def _handle_type_mismatch(self, message, field, field_label, error_info):
        if not self._RE_TYPE_MISMATCH.search(message):
            return None

        display_field = field_label or field or 'field'

        # Try to extract the failing value
        value_match = re.search(r"['\"]([^'\"]+)['\"]", message)
        invalid_value = value_match.group(1) if value_match else ''

        if invalid_value:
            enhanced = (
                f'Invalid value "{invalid_value}" for {display_field}. '
                f'The value does not match the expected data type.'
            )
        else:
            enhanced = (
                f'Invalid data type for {display_field}. '
                f'The value does not match the expected format.'
            )

        suggestions = [
            'Check that numeric columns contain only numbers.',
            'Remove currency symbols, percentage signs, or text from numeric fields.',
            'Verify that decimal separators match your import settings (comma vs. period).',
        ]

        return {
            'error_type': ERROR_TYPE_MISMATCH,
            'enhanced_message': enhanced,
            'suggestions': suggestions,
        }
