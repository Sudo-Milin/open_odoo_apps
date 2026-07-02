import base64
import json
import logging

from odoo import http
from odoo.http import request, content_disposition

_logger = logging.getLogger(__name__)

# Models portal users may attach media to (extend via _get_portal_models)
PORTAL_ALLOWED_MODELS = {
    "sale.order",
    "purchase.order",
    "helpdesk.ticket",
    "project.task",
}


class MediaCaptureController(http.Controller):
    """HTTP endpoints for the web_media_capture module."""

    # ------------------------------------------------------------------
    # Configuration endpoint
    # ------------------------------------------------------------------

    @http.route(
        "/web_media_capture/config",
        type="jsonrpc",
        auth="user",
        methods=["POST"],
    )
    def get_config(self):
        """Return media capture configuration parameters.

        Called once by the frontend PermissionService / UploadService to
        read system defaults.
        """
        ICP = request.env["ir.config_parameter"].sudo()
        return {
            "max_file_size": int(ICP.get_param(
                "web_media_capture.max_file_size", 125
            )),
            "max_duration": int(ICP.get_param(
                "web_media_capture.max_duration", 60
            )),
            "image_quality": int(ICP.get_param(
                "web_media_capture.image_quality", 85
            )),
            "max_dimension": int(ICP.get_param(
                "web_media_capture.max_dimension", 1920
            )),
            "allowed_mimetypes": ICP.get_param(
                "web_media_capture.allowed_mimetypes",
                "image/jpeg,image/png,image/webp,video/mp4,video/webm",
            ).split(","),
        }

    # ------------------------------------------------------------------
    # File upload endpoint (for large files — multipart form)
    # ------------------------------------------------------------------

    @http.route(
        "/web_media_capture/upload",
        type="http",
        auth="user",
        methods=["POST"],
        csrf=True,
    )
    def upload_media(self, file, res_model=None, res_id=None, **kwargs):
        """Upload a media file and create an ir.attachment.

        Used by the frontend UploadService for files > 5 MB where base64
        via JSON-RPC would be too memory-intensive.

        :param file: the uploaded file (werkzeug FileStorage)
        :param res_model: optional model name to link the attachment to
        :param res_id: optional record id to link the attachment to
        :returns: JSON with ``{id, name, mimetype, file_size}``
        """
        # --- Validate MIME type ---
        ICP = request.env["ir.config_parameter"].sudo()
        allowed_raw = ICP.get_param(
            "web_media_capture.allowed_mimetypes",
            "image/jpeg,image/png,image/webp,video/mp4,video/webm",
        )
        allowed = [m.strip() for m in allowed_raw.split(",")]
        mimetype = file.content_type or "application/octet-stream"
        if mimetype not in allowed:
            return request.make_json_response(
                {"error": f"MIME type '{mimetype}' is not allowed."},
                status=400,
            )

        # --- Validate file size ---
        max_size_mb = int(ICP.get_param("web_media_capture.max_file_size", 125))
        file_data = file.read()
        file_size = len(file_data)
        if file_size > max_size_mb * 1024 * 1024:
            return request.make_json_response(
                {"error": f"File exceeds maximum size of {max_size_mb} MB."},
                status=400,
            )

        # --- Create attachment ---
        vals = {
            "name": file.filename,
            "datas": base64.b64encode(file_data).decode("utf-8"),
            "mimetype": mimetype,
            "type": "binary",
        }
        if res_model:
            vals["res_model"] = res_model
        if res_id:
            vals["res_id"] = int(res_id)

        attachment = request.env["ir.attachment"].create(vals)

        return request.make_json_response({
            "id": attachment.id,
            "name": attachment.name,
            "mimetype": attachment.mimetype,
            "file_size": file_size,
        })

    # ------------------------------------------------------------------
    # Portal upload endpoint
    # ------------------------------------------------------------------

    @http.route(
        "/web_media_capture/portal/upload",
        type="http",
        auth="public",
        methods=["POST"],
        csrf=True,
    )
    def portal_upload_media(
        self, file, res_model=None, res_id=None, access_token=None, **kwargs
    ):
        """Portal-safe upload endpoint with access-token validation.

        Portal users can only attach to models in the allowlist and must
        provide a valid access_token for the target record.
        """
        if not access_token:
            return request.make_json_response(
                {"error": "Access token is required."}, status=403
            )

        # Validate model is in the portal allowlist
        if res_model and res_model not in PORTAL_ALLOWED_MODELS:
            return request.make_json_response(
                {"error": f"Model '{res_model}' is not available for portal uploads."},
                status=403,
            )

        # Validate access token against the target record
        if res_model and res_id:
            record = request.env[res_model].sudo().browse(int(res_id))
            if not record.exists():
                return request.make_json_response(
                    {"error": "Record not found."}, status=404
                )
            if hasattr(record, "access_token"):
                if record.access_token != access_token:
                    return request.make_json_response(
                        {"error": "Invalid access token."}, status=403
                    )
            else:
                return request.make_json_response(
                    {"error": "Model does not support access tokens."},
                    status=403,
                )

        # Reuse internal upload logic with sudo
        ICP = request.env["ir.config_parameter"].sudo()
        allowed_raw = ICP.get_param(
            "web_media_capture.allowed_mimetypes",
            "image/jpeg,image/png,image/webp,video/mp4,video/webm",
        )
        allowed = [m.strip().lower() for m in allowed_raw.split(",")]

        max_size_mb = int(ICP.get_param("web_media_capture.max_file_size", 125))
        file_data = file.read()
        file_size = len(file_data)
        if file_size > max_size_mb * 1024 * 1024:
            return request.make_json_response(
                {"error": f"File exceeds maximum size of {max_size_mb} MB."},
                status=400,
            )

        # Parse mimetype and guess from binary content
        from odoo.tools.mimetypes import guess_mimetype
        content_mimetype = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
        guessed_mimetype = guess_mimetype(file_data).split(";")[0].strip().lower()

        is_allowed = content_mimetype in allowed or guessed_mimetype in allowed

        # WebM recorded video is often guessed as video/x-matroska.
        if not is_allowed and "video/webm" in allowed:
            if content_mimetype == "video/x-matroska" or guessed_mimetype == "video/x-matroska":
                is_allowed = True

        if not is_allowed:
            return request.make_json_response(
                {"error": f"MIME type '{content_mimetype}' is not allowed."},
                status=400,
            )

        # Determine target mimetype to save
        target_mimetype = content_mimetype
        if content_mimetype == "video/x-matroska" and "video/webm" in allowed:
            target_mimetype = "video/webm"
        elif guessed_mimetype == "video/x-matroska" and "video/webm" in allowed:
            target_mimetype = "video/webm"

        vals = {
            "name": file.filename,
            "datas": base64.b64encode(file_data).decode("utf-8"),
            "mimetype": target_mimetype,
            "type": "binary",
        }
        if res_model:
            vals["res_model"] = res_model
        if res_id:
            vals["res_id"] = int(res_id)

        attachment = request.env["ir.attachment"].sudo().create(vals)

        return request.make_json_response({
            "id": attachment.id,
            "name": attachment.name,
            "mimetype": attachment.mimetype,
            "file_size": file_size,
        })
