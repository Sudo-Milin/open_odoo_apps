import base64
import logging

from odoo import http
from odoo.http import request
from odoo.tools.mimetypes import guess_mimetype

_logger = logging.getLogger(__name__)


class PortalMediaCaptureController(http.Controller):
    """HTTP endpoints for portal media capture operations."""

    def _validate_portal_access(self, res_model, res_id, access_token):
        """Validate that the request has access to the given record."""
        if not res_model or not res_id or not access_token:
            return None, "Missing record model, ID or access token."

        try:
            if res_model not in request.env:
                return None, "Invalid model."
            record = request.env[res_model].sudo().browse(int(res_id))
            if not record.exists():
                return None, "Record not found."
            if not hasattr(record, "access_token") or record.access_token != access_token:
                return None, "Invalid access token."
            return record, None
        except Exception as e:
            _logger.exception("Error validating portal access")
            return None, str(e)

    @http.route(
        "/portal_media_capture/attachments",
        type="jsonrpc",
        auth="public",
        methods=["POST"],
    )
    def get_portal_attachments(self, res_model, res_id, access_token, **kwargs):
        """Get the list of portal attachments linked to the record."""
        record, error = self._validate_portal_access(res_model, res_id, access_token)
        if error:
            return {"error": error}

        # Search for attachments linked to this model and record ID
        attachments_records = request.env["ir.attachment"].sudo().search([
            ("res_model", "=", res_model),
            ("res_id", "=", int(res_id)),
        ])

        attachments = []
        for att in attachments_records:
            if not att.access_token:
                att.generate_access_token()
            attachments.append({
                "id": att.id,
                "name": att.name,
                "mimetype": att.mimetype,
                "file_size": att.file_size,
                "access_token": att.access_token,
            })
        return {"attachments": attachments}

    @http.route(
        "/portal_media_capture/upload",
        type="http",
        auth="public",
        methods=["POST"],
        csrf=True,
    )
    def portal_upload(self, file, res_model, res_id, access_token, **kwargs):
        """Portal-safe upload for attachments."""
        record, error = self._validate_portal_access(res_model, res_id, access_token)
        if error:
            return request.make_json_response({"error": error}, status=403)

        # Validate MIME type and file size from system settings
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

        # Create attachment and link it to the record
        vals = {
            "name": file.filename,
            "datas": base64.b64encode(file_data).decode("utf-8"),
            "mimetype": target_mimetype,
            "type": "binary",
            "res_model": res_model,
            "res_id": int(res_id),
        }
        attachment = request.env["ir.attachment"].sudo().create(vals)
        attachment.generate_access_token()

        return request.make_json_response({
            "id": attachment.id,
            "name": attachment.name,
            "mimetype": attachment.mimetype,
            "file_size": file_size,
            "access_token": attachment.access_token,
        })

    @http.route(
        "/portal_media_capture/delete",
        type="jsonrpc",
        auth="public",
        methods=["POST"],
    )
    def portal_delete(self, attachment_id, res_model, res_id, access_token, **kwargs):
        """Unlink the attachment if it is linked to this record."""
        record, error = self._validate_portal_access(res_model, res_id, access_token)
        if error:
            return {"error": error}

        attachment = request.env["ir.attachment"].sudo().browse(int(attachment_id))
        if attachment.exists() and attachment.res_model == res_model and attachment.res_id == int(res_id):
            attachment.unlink()
            return {"success": True}

        return {"error": "Attachment not found or not linked to this record."}
