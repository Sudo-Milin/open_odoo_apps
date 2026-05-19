{
    'name': 'Enhanced Import Validation',
    'version': '19.0.1.0.0',
    'summary': 'Better error reporting for CSV/XLSX imports',
    'description': """
Enhanced Import Validation & Error Reporting
=============================================

Enhances Odoo's native import engine with:

* Row-level error tracking with exact row numbers
* Classified error messages (missing relations, duplicates, invalid selections, etc.)
* Human-readable field labels instead of technical names
* Actionable suggestions for each error
* Downloadable CSV error reports

This module wraps the existing import logic — it never replaces
the ORM or base_import internals.
""",
    'author': 'Milin Prajapati',
    'category': 'Hidden/Tools',
    'depends': ['base_import'],
    'data': [
        'security/ir.model.access.csv',
        'wizard/import_preview_wizard_views.xml',
        'views/import_validation_result_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'enhanced_import_validation/static/src/**/*.js',
            'enhanced_import_validation/static/src/**/*.xml',
        ],
    },
    'installable': True,
    'auto_install': False,
    'license': 'LGPL-3',
}
