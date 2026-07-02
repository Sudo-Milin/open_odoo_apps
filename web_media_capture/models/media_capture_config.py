from odoo import api, fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = "res.config.settings"

    media_capture_max_file_size = fields.Integer(
        string="Max File Size (MB)",
        default=125,
        config_parameter="web_media_capture.max_file_size",
        help="Maximum allowed file size for media uploads in megabytes.",
    )
    media_capture_max_duration = fields.Integer(
        string="Max Video Duration (s)",
        default=60,
        config_parameter="web_media_capture.max_duration",
        help="Maximum video recording duration in seconds.",
    )
    media_capture_image_quality = fields.Integer(
        string="Image Quality (%)",
        default=85,
        config_parameter="web_media_capture.image_quality",
        help="JPEG compression quality (0–100). Higher means better quality but larger files.",
    )
    media_capture_max_dimension = fields.Integer(
        string="Max Image Dimension (px)",
        default=1920,
        config_parameter="web_media_capture.max_dimension",
        help="Images wider or taller than this are resized down before upload.",
    )
    media_capture_allowed_mimetypes = fields.Char(
        string="Allowed MIME Types",
        default="image/jpeg,image/png,image/webp,video/mp4,video/webm",
        config_parameter="web_media_capture.allowed_mimetypes",
        help="Comma-separated list of allowed MIME types for media uploads.",
    )
