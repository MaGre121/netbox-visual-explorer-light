from netbox.plugins import PluginConfig


class VisualExplorerConfig(PluginConfig):
    name = "netbox_visual_explorer"
    verbose_name = "Visual Explorer"
    author = "Matthias Grebe"
    description = "Interaktive Netzpläne für Sites, Locations und Racks"
    version = "0.3.5b"
    base_url = "visual-explorer"
    min_version = "4.5.0"

    def ready(self):
        super().ready()
        from . import views  # Register the DCIM object tabs before URL resolution.


config = VisualExplorerConfig
