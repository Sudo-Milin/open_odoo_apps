import base64
import mimetypes

from odoo import api, fields, models


class MediaCaptureMixin(models.AbstractModel):
    """Abstract mixin that any model can inherit to get media capture fields.

    Usage::

        class StockPicking(models.Model):
            _inherit = ["stock.picking", "media.capture.mixin"]

    This adds a ``media_attachment_ids`` Many2many field that works with the
    ``media_capture``, ``media_gallery`` and ``media_timeline`` OWL widgets.

    Developers can also skip the mixin entirely and just add their own
    Many2many field to ``ir.attachment`` — the widgets work on *any*
    Many2many field pointing to ``ir.attachment``.
    """

    _name = "media.capture.mixin"
    _description = "Media Capture Mixin"

    media_attachment_ids = fields.Many2many(
        comodel_name="ir.attachment",
        string="Media Attachments",
        help="Photos and videos captured via the media capture widget.",
    )

    def action_open_media_gallery(self):
        """Open a dialog showing all media attachments for this record."""
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "name": "Media Gallery",
            "res_model": "ir.attachment",
            "view_mode": "kanban,list",
            "domain": [("id", "in", self.media_attachment_ids.ids)],
            "target": "new",
            "context": {
                "default_res_model": self._name,
                "default_res_id": self.id,
            },
        }

    def _get_media_attachments_data(self):
        """Return serialisable attachment data for the frontend.

        Returns a list of dicts with id, name, mimetype, file_size,
        create_date, thumbnail_url, and download_url.
        """
        self.ensure_one()
        result = []
        for att in self.media_attachment_ids:
            result.append({
                "id": att.id,
                "name": att.name,
                "mimetype": att.mimetype,
                "file_size": att.file_size,
                "create_date": fields.Datetime.to_string(att.create_date),
                "create_uid": att.create_uid.name if att.create_uid else "",
                "thumbnail_url": f"/web/image/{att.id}/256x256",
                "download_url": f"/web/content/{att.id}?download=true",
            })
        return result


class Base(models.AbstractModel):
    _inherit = "base"

    @api.model_create_multi
    def create(self, vals_list):
        records = super(Base, self).create(vals_list)
        # Find many2many fields pointing to ir.attachment
        attachment_fields = [
            fname for fname, field in self._fields.items()
            if field.type == "many2many" and field.comodel_name == "ir.attachment"
        ]
        if attachment_fields:
            for record in records:
                for fname in attachment_fields:
                    attachments = record[fname]
                    if attachments:
                        # Find attachments that do not have res_model and res_id set correctly
                        to_update = attachments.filtered(
                            lambda a: not a.res_model or a.res_model != record._name or a.res_id != record.id
                        )
                        if to_update:
                            to_update.sudo().write({
                                "res_model": record._name,
                                "res_id": record.id,
                            })
        return records

    def write(self, vals):
        res = super(Base, self).write(vals)
        attachment_fields = [
            fname for fname, field in self._fields.items()
            if field.type == "many2many" and field.comodel_name == "ir.attachment"
        ]
        if attachment_fields:
            for record in self:
                for fname in attachment_fields:
                    if fname in vals:
                        attachments = record[fname]
                        if attachments:
                            to_update = attachments.filtered(
                                lambda a: not a.res_model or a.res_model != record._name or a.res_id != record.id
                            )
                            if to_update:
                                to_update.sudo().write({
                                    "res_model": record._name,
                                    "res_id": record.id,
                                })
        return res
