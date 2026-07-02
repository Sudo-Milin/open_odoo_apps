{  # noqa: B018
    "name": "Web Media Capture",
    "summary": "Universal camera, video and media capture framework for Odoo",
    "description": """
        Provides reusable OWL field widgets (media_capture, media_gallery,
        media_timeline) backed by browser MediaDevices APIs, with chunked
        uploads, image compression, and a clean service architecture.
    """,
    "category": "Technical",
    "version": "19.0.1.0.0",
    "depends": ["web", "base_setup"],
    "author": "Custom",
    "license": "LGPL-3",
    "data": [
        "security/ir.model.access.csv",
        "security/media_capture_security.xml",
        "views/res_config_settings_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "web_media_capture/static/src/scss/media_capture.scss",
            "web_media_capture/static/src/services/*.js",
            "web_media_capture/static/src/components/**/*.js",
            "web_media_capture/static/src/components/**/*.xml",
            "web_media_capture/static/src/widgets/**/*.js",
            "web_media_capture/static/src/widgets/**/*.xml",
        ],
        "web.assets_frontend": [
            "web_media_capture/static/src/scss/media_capture.scss",
            "web_media_capture/static/src/services/*.js",
            "web_media_capture/static/src/components/**/*.js",
            "web_media_capture/static/src/components/**/*.xml",
        ],
    },
    "installable": True,
    "application": False,
}
